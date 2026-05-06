#!/bin/bash
# PostgreSQL Backup Script for Docker Container
# Run this via cron every 3 days: 0 2 */3 * * /path/to/backup-db.sh

set -e  # Exit on error

# Load environment variables
source .env

# Configuration
BACKUP_DIR="./backups"
CONTAINER_NAME="dev_postgres"
DATE=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_FILE="${BACKUP_DIR}/backup_${DATE}.sql.gz"
RETENTION_DAYS=21  # Keep last 21 days of backups (approximately 7 backups)

# Create backup directory if it doesn't exist
mkdir -p "${BACKUP_DIR}"

echo "[$(date)] Starting PostgreSQL backup..."

# Create compressed backup
docker exec -t ${CONTAINER_NAME} pg_dump -U ${POSTGRES_USER} -d ${POSTGRES_DB} \
  --verbose --clean --if-exists --no-owner \
  | gzip > "${BACKUP_FILE}"

# Check if backup was successful
if [ $? -eq 0 ]; then
    echo "[$(date)] Backup successful: ${BACKUP_FILE}"

    # Get backup size
    SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
    echo "[$(date)] Backup size: ${SIZE}"

    # Remove old backups (older than RETENTION_DAYS)
    find "${BACKUP_DIR}" -name "backup_*.sql.gz" -type f -mtime +${RETENTION_DAYS} -delete
    echo "[$(date)] Old backups cleaned up (older than ${RETENTION_DAYS} days)"

    # Optional: Upload to remote storage (uncomment and configure)
    # upload_to_remote "${BACKUP_FILE}"
else
    echo "[$(date)] ERROR: Backup failed!" >&2
    exit 1
fi

echo "[$(date)] Backup complete!"

# Optional: Upload to S3/Backblaze/etc
# upload_to_remote() {
#     local file=$1
#     echo "[$(date)] Uploading to remote storage..."
#
#     # Example for AWS S3:
#     # aws s3 cp "${file}" s3://your-backup-bucket/database/
#
#     # Example for Backblaze B2:
#     # b2 upload-file your-bucket-name "${file}" "database/$(basename ${file})"
#
#     echo "[$(date)] Remote upload complete"
# }
