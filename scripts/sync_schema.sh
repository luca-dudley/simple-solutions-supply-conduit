#!/usr/bin/env bash
# ==============================================================================
# scripts/sync_schema.sh
# Dumps the active Supabase PostgreSQL schema into .ai/SUPABASE_SCHEMA.md
# ==============================================================================

set -euo pipefail

OUTPUT_FILE=".ai/SUPABASE_SCHEMA.md"
MIGRATIONS_DIR="supabase/migrations"

echo "🔄 [SYNC-SCHEMA] Initiating Supabase schema synchronization..."

# Check if supabase CLI is available and local container is running
if command -v supabase &> /dev/null; then
    echo "🔍 Supabase CLI detected. Attempting db dump..."
    if supabase db dump --local -f /tmp/supabase_schema_dump.sql 2>/dev/null; then
        cat <<EOF > "$OUTPUT_FILE"
# Live Supabase Database Schema

> Auto-generated via \`scripts/sync_schema.sh\` from active Supabase environment.
> Generated at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

\`\`\`sql
$(cat /tmp/supabase_schema_dump.sql)
\`\`\`
EOF
        rm -f /tmp/supabase_schema_dump.sql
        echo "✅ [SYNC-SCHEMA] Schema successfully dumped into $OUTPUT_FILE"
        exit 0
    else
        echo "⚠️  Local Supabase instance not responding to CLI dump."
    fi
fi

# Fallback: Consolidate migration files if Supabase is offline
echo "ℹ️  Consolidating migration files from $MIGRATIONS_DIR..."
if [ -d "$MIGRATIONS_DIR" ]; then
    # Check if any .sql migrations exist
    shopt -s nullglob
    sql_files=("$MIGRATIONS_DIR"/*.sql)
    shopt -u nullglob

    if [ ${#sql_files[@]} -gt 0 ]; then
        cat <<EOF > "$OUTPUT_FILE"
# Supabase Database Schema (Migration Fallback)

> Consolidated from migration files in \`$MIGRATIONS_DIR/\`.
> Generated at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

EOF
        for migration in "${sql_files[@]}"; do
            if [ -f "$migration" ]; then
                echo -e "\n## $(basename "$migration")\n\`\`\`sql" >> "$OUTPUT_FILE"
                cat "$migration" >> "$OUTPUT_FILE"
                echo -e "\n\`\`\`" >> "$OUTPUT_FILE"
            fi
        done
        echo "✅ [SYNC-SCHEMA] Migration files consolidated into $OUTPUT_FILE"
    else
        echo "ℹ️  No migration files found in $MIGRATIONS_DIR yet (backend migrations pending execution by Google Jules)."
        if [ ! -f "$OUTPUT_FILE" ]; then
            cat <<EOF > "$OUTPUT_FILE"
# Supabase Database Schema

> No migrations executed yet in \`$MIGRATIONS_DIR/\`.
> Schema blueprint defined in \`docs/architecture/decisions/0001-database-contracts.md\`.
> Generated at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF
        fi
        echo "✅ [SYNC-SCHEMA] Schema documentation preserved at $OUTPUT_FILE"
    fi
else
    echo "❌ Error: $MIGRATIONS_DIR directory not found."
    exit 1
fi
