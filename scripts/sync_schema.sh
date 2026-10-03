#!/usr/bin/env bash
set -euo pipefail

TARGET_FILE=".ai/SUPABASE_SCHEMA.md"
TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M:%S UTC")

# 1. Load connection string from .env if present
if [ -f ".env" ]; then
  export $(grep -v '^#' .env | xargs)
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Error: DATABASE_URL is not set in your .env file."
  echo "Add: DATABASE_URL=\"postgresql://postgres:[PASSWORD]@db.ujhfkvoaaebdntuheyqo.supabase.co:5432/postgres\""
  exit 1
fi

echo "==> [1/2] Connecting directly to Supabase via pg_dump..."
mkdir -p .ai

# Start markdown file
cat <<HEADER > "$TARGET_FILE"
# Live Supabase Schema Manifest
> **Last Synchronized:** $TIMESTAMP
> **Source:** Remote Supabase Instance via pg_dump (Direct Connection)

---

## 1. Relational Database Schema & Policies (DDL)

\`\`\`sql
HEADER

# 2. Introspect schema (schema-only, public schema, clean layout)
pg_dump "$DATABASE_URL" \
  --schema-only \
  --schema=public \
  --no-owner \
  --no-privileges >> "$TARGET_FILE"

sed -i 's/"x-webhook-secret":"[^"]*"/"x-webhook-secret":"[REDACTED]"/g' "$TARGET_FILE"

cat <<FOOTER >> "$TARGET_FILE"
\`\`\`
FOOTER

echo "==> [2/2] Successfully dumped live schema into $TARGET_FILE!"
