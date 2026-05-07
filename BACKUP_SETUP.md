# PostgreSQL Backup Setup Guide

## What Changed in docker-compose.yml

### 1. **Resource Limits** (CRITICAL for 4GB VPS)
```yaml
deploy:
  resources:
    limits:
      memory: 2G      # Max PostgreSQL can use
      cpus: '1.0'     # Max 1 CPU core
```
This prevents PostgreSQL from consuming all resources and crashing your app.

### 2. **Health Checks**
Docker can now detect if PostgreSQL is actually responsive, not just running.

### 3. **Performance Tuning**
Optimized for your 4GB RAM / 2 CPU / SSD setup:
- `shared_buffers=512MB` - Main memory cache
- `effective_cache_size=1GB` - Hint to query planner
- `max_connections=50` - Reduced from default 100
- `random_page_cost=1.1` - Optimized for SSD
- `effective_io_concurrency=200` - Good for SSDs

### 4. **Backup Volume**
```yaml
volumes:
  - ./backups:/backups
```
Backups are now stored on the host filesystem, not inside the container.

### 5. **Security Note**
```yaml
ports:
  - "${POSTGRES_OUTPUT_PORT}:${POSTGRES_PORT}"
```
**For production VPS:** Comment this out! Your app should connect via Docker network, not localhost.

---

## Backup Strategy Setup

### Step 1: Create Backup Directory
```bash
mkdir -p backups
chmod 700 backups  # Only owner can access
```

### Step 2: Make Scripts Executable
```bash
chmod +x backup-db.sh restore-db.sh
```

### Step 3: Test Manual Backup
```bash
./backup-db.sh
```

You should see:
```
Starting PostgreSQL backup...
Backup successful: ./backups/backup_2026-05-06_14-30-00.sql.gz
Backup size: 2.3M
```

### Step 4: Setup Automated Backups Every 3 Days (Cron)

On your VPS, add to crontab:
```bash
crontab -e
```

Add this line (runs every 3 days at 2 AM):
```
0 2 */3 * * cd /path/to/your/app && ./backup-db.sh >> /var/log/db-backup.log 2>&1
```

**Replace `/path/to/your/app`** with actual path!

**Cron schedule breakdown:**
- `0 2` = At 2:00 AM
- `*/3` = Every 3 days
- `* *` = Every month, any day of week

### Step 5: Setup Remote Backup Upload (IMPORTANT!)

Local backups aren't enough - if VPS dies, you lose everything.

#### Option A: AWS S3 (Cheap, Reliable)
1. Install AWS CLI:
```bash
apt install awscli
aws configure
```

2. Uncomment the S3 upload section in `backup-db.sh`:
```bash
# Example for AWS S3:
aws s3 cp "${file}" s3://your-backup-bucket/database/
```

#### Option B: Backblaze B2 (Cheaper than S3)
1. Install B2 CLI:
```bash
pip install b2
b2 authorize-account
```

2. Uncomment the B2 upload section in `backup-db.sh`

#### Option C: Simple SFTP/rsync to Another Server
```bash
rsync -avz ./backups/ user@backup-server:/backup/billing-db/
```

---

## How to Restore a Backup

### List Available Backups
```bash
ls -lh ./backups/
```

### Restore from Backup
```bash
./restore-db.sh ./backups/backup_2026-05-06_14-30-00.sql.gz
```

---

## Migration from AWS RDS to Local PostgreSQL

### Step 1: Backup Current RDS Database
```bash
# From your local machine or VPS
pg_dump -h your-rds-endpoint.amazonaws.com \
  -U your_user -d your_db \
  --verbose --clean --if-exists --no-owner \
  | gzip > rds_migration_backup.sql.gz
```

### Step 2: Start New Local PostgreSQL
```bash
docker compose up -d postgres
docker compose logs -f postgres  # Wait for "database system is ready"
```

### Step 3: Restore RDS Backup to Local
```bash
gunzip < rds_migration_backup.sql.gz | docker exec -i dev_postgres \
  psql -U ${POSTGRES_USER} -d ${POSTGRES_DB}
```

### Step 4: Update Application Connection String

Change from:
```
DATABASE_URL=postgresql://user:pass@your-rds.amazonaws.com:5432/db
```

To (if using Docker network):
```
DATABASE_URL=postgresql://user:pass@postgres:5432/db
```

Or (if using host network):
```
DATABASE_URL=postgresql://user:pass@localhost:5432/db
```

### Step 5: Test Application
```bash
# Restart your app
docker compose restart

# Check logs
docker compose logs -f
```

### Step 6: Verify Performance
Your queries should now be <100ms instead of 3-4 seconds!

---

## Monitoring & Maintenance

### Check Database Size
```bash
docker exec dev_postgres psql -U ${POSTGRES_USER} -d ${POSTGRES_DB} \
  -c "SELECT pg_size_pretty(pg_database_size('${POSTGRES_DB}'));"
```

### Check Connection Count
```bash
docker exec dev_postgres psql -U ${POSTGRES_USER} -d ${POSTGRES_DB} \
  -c "SELECT count(*) FROM pg_stat_activity;"
```

### Check Backup Size
```bash
du -sh ./backups/
```

### View PostgreSQL Logs
```bash
docker compose logs -f postgres
```

---

## Security Checklist

- [ ] Backups directory has restricted permissions (700)
- [ ] `.env` file contains strong passwords
- [ ] PostgreSQL port NOT exposed to public (comment out ports in docker-compose.yml)
- [ ] Backups uploaded to remote storage
- [ ] Cron job for daily backups is running
- [ ] Test restore procedure at least once

---

## Troubleshooting

### Backup Script Fails
```bash
# Check if container is running
docker ps | grep postgres

# Check logs
docker compose logs postgres

# Test manual backup
docker exec dev_postgres pg_dump -U ${POSTGRES_USER} -d ${POSTGRES_DB} > test.sql
```

### Out of Memory Errors
Reduce PostgreSQL limits in docker-compose.yml:
```yaml
deploy:
  resources:
    limits:
      memory: 1.5G  # Reduce from 2G
```

### Slow Queries
Monitor with:
```bash
docker exec dev_postgres psql -U ${POSTGRES_USER} -d ${POSTGRES_DB} \
  -c "SELECT query, calls, total_time FROM pg_stat_statements ORDER BY total_time DESC LIMIT 10;"
```

---

## Cost Comparison

**AWS RDS Free Tier:**
- After 12 months: ~$15-30/month
- Limited to t3.micro (2GB RAM)
- Network latency

**Self-Hosted on VPS:**
- No additional cost
- Uses existing VPS resources
- Local = fast
- You manage backups

**Recommendation:** Start with self-hosted. If you grow beyond 4GB VPS capacity, then consider managed PostgreSQL (DigitalOcean Managed DB, AWS RDS, etc).
