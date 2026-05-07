# VPS Setup Guide - PostgreSQL Migration

Complete guide to set up Docker on your VPS and migrate from AWS RDS to local PostgreSQL.

---

## Prerequisites

- VPS with Ubuntu/Debian (2 CPU, 4GB RAM, 40GB SSD)
- SSH access to your VPS
- Current AWS RDS PostgreSQL connection details

---

## Step 1: Install Docker on VPS

SSH into your VPS:
```bash
ssh your-username@your-vps-ip
```

### Install Docker Engine
```bash
# Update package index
sudo apt update

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Verify Docker is installed
docker --version
```

### Install Docker Compose Plugin
```bash
sudo apt install docker-compose-plugin -y

# Verify Docker Compose is installed
docker compose version
```

### Add Your User to Docker Group (Important!)
This allows you to run Docker commands without `sudo`:

```bash
# Add current user to docker group
sudo usermod -aG docker $USER

# Apply the new group membership (choose one):
# Option 1: Logout and login again
exit
ssh your-username@your-vps-ip

# Option 2: Or run this without logout
newgrp docker

# Verify it works (should NOT require sudo)
docker ps
```

**Why this matters:** Without this, you'd need to run every Docker command with `sudo`, which is annoying and can cause permission issues with files.

---

## Step 2: Deploy Your Application to VPS

### Option A: Using Git (Recommended)
```bash
# On VPS: Clone your repository
cd ~
git clone https://github.com/your-username/billing.git
cd billing

# Copy environment variables
cp .env.example .env
nano .env  # Edit with your production values
```

### Option B: Using rsync from Local Machine
```bash
# From your LOCAL Windows machine (Git Bash):
rsync -avz --exclude 'node_modules' --exclude '.git' --exclude 'dist' \
  /c/myFiles/practice/billing/ your-username@your-vps-ip:~/billing/

# Then SSH to VPS
ssh your-username@your-vps-ip
cd ~/billing

# Setup .env file
nano .env  # Add your production environment variables
```

---

## Step 3: Configure Environment Variables

Edit your `.env` file on VPS:
```bash
nano .env
```

**Important:** Update the database connection:
```env
# PostgreSQL Configuration (for Docker container)
POSTGRES_DB=your_database_name
POSTGRES_USER=your_username
POSTGRES_PASSWORD=your_secure_password
POSTGRES_PORT=5432
POSTGRES_OUTPUT_PORT=5432

# Application Database URL (connect to Docker container)
# Use 'postgres' as hostname (Docker service name)
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}

# Other app settings...
```

---

## Step 4: Start PostgreSQL Container

```bash
# Make sure you're in your app directory
cd ~/billing

# Start only PostgreSQL (not the full app yet)
docker compose up -d postgres

# Check if it's running
docker compose ps

# Watch logs (Ctrl+C to exit)
docker compose logs -f postgres
```

**Expected output:**
```
[+] Running 2/2
 ✔ Network billing_default     Created
 ✔ Container dev_postgres      Started
```

**Check PostgreSQL is ready:**
```bash
docker compose logs postgres | grep "ready to accept connections"
```

You should see:
```
database system is ready to accept connections
```

---

## Step 5: Migrate Data from AWS RDS

### Backup from AWS RDS
```bash
# Install PostgreSQL client tools (if not installed)
sudo apt install postgresql-client -y

# Create backup from RDS
pg_dump -h your-rds-endpoint.rds.amazonaws.com \
  -U your_rds_user \
  -d your_rds_database \
  --no-owner --no-acl \
  > rds_migration_backup.sql

# Enter password when prompted
```

**Alternative:** If you have a backup on your local machine, upload it:
```bash
# From your local Windows machine:
scp /c/path/to/backup.sql your-username@your-vps-ip:~/billing/
```

### Restore to Docker PostgreSQL
```bash
# On VPS: Restore the backup
cat rds_migration_backup.sql | docker exec -i dev_postgres \
  psql -U ${POSTGRES_USER} -d ${POSTGRES_DB}

# Verify data was imported
docker exec -i dev_postgres psql -U ${POSTGRES_USER} -d ${POSTGRES_DB} \
  -c "\dt"  # List tables

docker exec -i dev_postgres psql -U ${POSTGRES_USER} -d ${POSTGRES_DB} \
  -c "SELECT COUNT(*) FROM your_main_table;"  # Check row count
```

---

## Step 6: Start Your Application

### If Your App is Also Dockerized
```bash
# Start all services (app + postgres)
docker compose up -d

# Check all containers are running
docker compose ps

# View logs
docker compose logs -f
```

### If Your App Runs Directly (Node.js/NestJS)
```bash
# Install dependencies
npm install

# Run migrations (if any)
npm run migration:run

# Start application
npm run start:prod

# Or use PM2 for process management
npm install -g pm2
pm2 start npm --name "billing-app" -- run start:prod
pm2 save
pm2 startup  # Auto-start on server reboot
```

---

## Step 7: Test the Connection

### Check Database Connection
```bash
# From your app logs, verify it connected successfully
docker compose logs | grep -i "database"

# Or if app runs directly:
pm2 logs billing-app | grep -i "database"
```

### Test Response Time
```bash
# Check API response time
time curl http://localhost:3000/api/health

# Should be <100ms now (was 3-4 seconds with RDS!)
```

---

## Step 8: Setup Automated Backups

```bash
# Make backup scripts executable
chmod +x backup-db.sh restore-db.sh

# Test backup
./backup-db.sh

# Check backup was created
ls -lh backups/

# Setup cron job for automatic backups every 3 days
crontab -e
```

Add this line:
```
0 2 */3 * * cd /home/your-username/billing && ./backup-db.sh >> /var/log/db-backup.log 2>&1
```

**Save and exit** (Ctrl+X, then Y, then Enter)

Verify cron job:
```bash
crontab -l
```

---

## Step 9: Secure Your Database (IMPORTANT!)

### Remove Public Port Exposure
Edit `docker-compose.yml` and comment out the ports:
```yaml
postgres:
  # ports:
  #   - "${POSTGRES_OUTPUT_PORT}:${POSTGRES_PORT}"
```

Restart:
```bash
docker compose up -d postgres
```

Now PostgreSQL is only accessible from inside Docker network, not from internet.

### Setup Firewall
```bash
# Install UFW firewall
sudo apt install ufw -y

# Allow SSH (IMPORTANT - do this first!)
sudo ufw allow 22/tcp

# Allow your app port (e.g., 3000)
sudo ufw allow 3000/tcp

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

---

## Step 10: Monitor & Verify

### Check Docker Resource Usage
```bash
docker stats
```

You should see PostgreSQL using <2GB RAM (as configured).

### Check Disk Usage
```bash
df -h
du -sh ~/billing
```

### Check PostgreSQL Performance
```bash
# Connect to PostgreSQL
docker exec -it dev_postgres psql -U ${POSTGRES_USER} -d ${POSTGRES_DB}

# Check database size
SELECT pg_size_pretty(pg_database_size(current_database()));

# Check active connections
SELECT count(*) FROM pg_stat_activity;

# Exit
\q
```

---

## Troubleshooting

### Container Won't Start
```bash
# Check logs
docker compose logs postgres

# Check if port is already in use
sudo lsof -i :5432

# Remove old container and volume
docker compose down -v
docker compose up -d postgres
```

### App Can't Connect to Database
```bash
# Check if containers are on same network
docker network ls
docker network inspect billing_default

# Test connection from app container
docker compose exec your-app-service ping postgres

# Check environment variables
docker compose exec your-app-service env | grep DATABASE
```

### Out of Memory
```bash
# Check memory usage
free -h

# Restart services
docker compose restart

# Reduce PostgreSQL memory limits in docker-compose.yml
```

### Backup Script Permission Denied
```bash
# Fix permissions
chmod +x backup-db.sh restore-db.sh
chmod 700 backups/

# Check script ownership
ls -l backup-db.sh
```

---

## Performance Comparison

### Before (AWS RDS):
- Response time: 3-4 seconds
- Network latency: ~3 seconds
- Cost: $0 (free tier) → $15-30/month after

### After (Local Docker):
- Response time: <100ms
- Network latency: <1ms (localhost)
- Cost: $0 (uses VPS resources)

**You should see 30-40x faster database queries!**

---

## Maintenance Commands

### View all containers
```bash
docker compose ps
```

### View logs
```bash
docker compose logs -f postgres
```

### Restart PostgreSQL
```bash
docker compose restart postgres
```

### Stop everything
```bash
docker compose down
```

### Update PostgreSQL image
```bash
docker compose pull postgres
docker compose up -d postgres
```

### Clean up unused Docker resources
```bash
docker system prune -a
```

---

## Next Steps

1. ✅ Docker installed and configured
2. ✅ PostgreSQL running in Docker on VPS
3. ✅ Data migrated from AWS RDS
4. ✅ Application connected and tested
5. ✅ Automated backups configured
6. ✅ Security measures applied
7. ⏭️ Monitor for a few days
8. ⏭️ Decommission AWS RDS (save costs!)

---

## Important Notes

- **Backups:** The most critical part! Make sure remote backup upload is working (S3/Backblaze)
- **Security:** Never expose PostgreSQL port to internet in production
- **Monitoring:** Check logs regularly for first few days
- **Resources:** Keep an eye on memory/disk usage

Good luck with the migration! 🚀
