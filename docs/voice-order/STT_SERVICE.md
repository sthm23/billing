# STT service — install on the VPS

Speech-to-text for the order assistant (DESIGN §6). Code: `billing/stt-service/` (`app.py`, `requirements.txt`).
Model: `AlexAnoshka/fast-whisper-uz-rubaistt-v2-medium-ct2` (int8, CPU), no hotwords — chosen in stage 0.

```
mobile ──► NestJS POST /order-assistant/transcribe ──► http://127.0.0.1:8090/transcribe (this service)
```

- Listens on **127.0.0.1 only** — never exposed through nginx; only NestJS calls it (`STT_URL`).
- One recognition at a time, up to 3 waiting (`STT_QUEUE_SIZE`), the rest get `429`.
- Audio is read into memory, recognized and dropped; nothing is written to disk; logs hold only durations
  and text length, never the text.

## 1. Check memory first

```bash
free -h
```

The service needs **~1.6 GB RAM loaded and ~2.1 GB peak while recognizing** (measured on Linux,
python:3.12, int8, 2 threads, 2026-11-24 — the earlier "~1 GB" was a Windows reading and the first
`MemoryMax=1.8G` got the service OOM-killed on the first dictation → 503). `beam_size=1` or
`MALLOC_ARENA_MAX=2` save only 50–70 MB. On the 4 GB VPS with NestJS + PostgreSQL + Docker (~1 GB without
STT), check the `available` column, not the cloud panel's "RAM 100%" (that is quota allocation).
`MemoryMax=2.4G` fits but is tight: add a swap file as a safety net, and plan the RAM upgrade (+2–4 GB,
DESIGN §6). OOM kill shows in `sudo journalctl -u sthm-stt` (`Failed with result 'oom-kill'`).

```bash
# 2 GB swap file (once)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 2. Install

**Script (recommended)** — does §2–3 below in one go, plus a sudo rule so `deploy.sh` can restart the service.
Run once as the user that owns `/var/www/billing` (the GitHub Actions deploy user):

```bash
sudo bash /var/www/billing/stt-service/install.sh     # waits until /health is ok (first start ~1.5 GB download)
```

By hand:

```bash
sudo apt install -y python3-venv python3-pip
cd /var/www/billing/stt-service            # comes with the billing git checkout
python3 -m venv /opt/sthm-stt/venv
/opt/sthm-stt/venv/bin/pip install -r requirements.txt
```

First start downloads the model (~1.5 GB `model.bin`; ~30–60 min on the VPS line) from Hugging Face into `HF_HOME`. To keep the cache with the service:
`/opt/sthm-stt/hf` (see the unit below).

## 3. systemd unit

`/etc/systemd/system/sthm-stt.service`:

```ini
[Unit]
Description=STHM order assistant speech-to-text
After=network.target

[Service]
User=www-data
WorkingDirectory=/var/www/billing/stt-service
Environment=HF_HOME=/opt/sthm-stt/hf
Environment=STT_THREADS=2
Environment=STT_QUEUE_SIZE=3
ExecStart=/opt/sthm-stt/venv/bin/uvicorn app:app --host 127.0.0.1 --port 8090 --workers 1
Restart=always
RestartSec=5
# Never starve NestJS / PostgreSQL on the shared VPS
MemoryMax=2.4G
CPUQuota=150%
Nice=10

[Install]
WantedBy=multi-user.target
```

Use the user that owns `/var/www/billing` instead of `www-data` if it differs, and
`sudo chown -R <user> /opt/sthm-stt`.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now sthm-stt
journalctl -u sthm-stt -f                 # wait for "model … loaded"
curl -s 127.0.0.1:8090/health             # {"status":"ok","model":"…"}
```

## 4. Backend

`billing/.env`: `STT_URL=http://127.0.0.1:8090` (this is also the default), then `pm2 restart billing-app`.
Without the service the backend answers `503` and the app offers «Повторить» / «Написать текстом».

The backend waits up to 90 s (`TRANSCRIBE_LIMITS.TIMEOUT_MS`), the app up to 100 s. Measured on the dev PC with
2 threads: any recording ≥ ~11 s (Whisper always runs a 30 s window), 9 s of speech → 16 s, 24 s → 19–21 s.

Decoding runs with `temperature=0` (no fallback), `condition_on_previous_text=False` and a token cap per window.
With the default temperature fallback a short or unclear recording (2.7 s) took 90–160 s — runaway repeats
re-decoded up to 6 times — and hit the backend timeout (503). Do not remove these without re-timing short clips.

## 5. Updates

Automatic: `deploy.sh` (GitHub Actions on push to `main`) runs `pip install` and
`sudo -n systemctl restart sthm-stt` when `stt-service/` changed in the pulled commits, then checks `/health`.
It never fails the backend deploy — it prints a warning (not installed / not answering). By hand:

```bash
/opt/sthm-stt/venv/bin/pip install -r /var/www/billing/stt-service/requirements.txt
sudo systemctl restart sthm-stt
```

Changing the model: set `Environment=STT_MODEL=…` in the unit, restart; re-run the stage 0 bake-off
(`billing/tools/stt-bench/`) before switching.

## 6. Voice samples bucket (stage 4)

Recordings of stores that gave consent (DESIGN §7) go to a **separate private bucket** — never the public
photo bucket.

1. Uztelecom panel → create bucket `sthm-voice` (prod) / `sthm-voice-dev` (dev). **No public access**, no
   public-read policy; the same access keys as the photo bucket must be allowed to Put / Get / Delete / List.
2. `billing/.env`: `VOICE_S3_BUCKET_NAME=sthm-voice`, `pm2 restart billing-app`. Unset → nothing is kept
   (the log warns once).
3. Check: turn on consent for a test store, dictate once → a `voice_samples` row and an object under
   `voice/<storeId>/`; turn consent off → both gone.

Retention (12 months) and clean-up of stores without consent run inside the backend daily — no cron.
Dataset for fine-tuning (on the server; the data stays in Uzbekistan):

```bash
cd /var/www/billing && npx tsx tools/voice-export/export.ts /opt/sthm-stt/dataset          # labeled only
npx tsx tools/voice-export/export.ts /opt/sthm-stt/dataset --all                            # + raw transcripts
```

## Local development

```bash
cd billing/stt-service
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt   # Windows; bin/ on Linux
.venv/Scripts/python -m uvicorn app:app --host 127.0.0.1 --port 8090
```
