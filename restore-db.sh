#!/bin/bash
# PostgreSQL Restore Script for Docker Container

set -e  # Exit on error

# Load environment variables
source .env

CONTAINER_NAME="dev_postgres"
BACKUP_FILE=$1

# Check if backup file is provided
if [ -z "$BACKUP_FILE" ]; then
    echo "Usage: ./restore-db.sh <backup-file.sql.gz>"
    echo ""
    echo "Available backups:"
    ls -lh ./backups/backup_*.sql.gz 2>/dev/null || echo "No backups found"
    exit 1
fi

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo "ERROR: Backup file not found: $BACKUP_FILE"
    exit 1
fi

echo "[$(date)] WARNING: This will overwrite the current database!"
echo "[$(date)] Database: ${POSTGRES_DB}"
echo "[$(date)] Backup file: ${BACKUP_FILE}"
echo ""
read -p "Are you sure you want to continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Restore cancelled"
    exit 0
fi

echo "[$(date)] Starting database restore..."

# Restore from compressed backup
gunzip < "${BACKUP_FILE}" | docker exec -i ${CONTAINER_NAME} \
  psql -U ${POSTGRES_USER} -d ${POSTGRES_DB} --single-transaction

if [ $? -eq 0 ]; then
    echo "[$(date)] Restore successful!"
else
    echo "[$(date)] ERROR: Restore failed!" >&2
    exit 1
fi
