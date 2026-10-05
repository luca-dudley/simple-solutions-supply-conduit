#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Supply Conduit - Edge Functions Automated Deployment Script
# Safely deploys Supabase Edge Functions using repo-scoped credentials from .env
# to avoid session cross-contamination across multiple Supabase accounts.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="$REPO_ROOT/.env"

# 1. Safety & Env Checks: Verify .env exists
if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ Error: .env file not found at: $ENV_FILE" >&2
  echo "" >&2
  echo "Setup Instructions:" >&2
  echo "1. Create a .env file in the repository root:" >&2
  echo "   cp .env.example .env" >&2
  echo "2. Add your project credentials and SUPABASE_ACCESS_TOKEN." >&2
  echo "3. Re-run this script." >&2
  exit 1
fi

# 2. Safely export non-commented environment variables from .env
while IFS= read -r line || [[ -n "$line" ]]; do
  trimmed="$(echo "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  
  # Skip blank lines and comments
  if [[ -z "$trimmed" || "$trimmed" == \#* ]]; then
    continue
  fi

  # Match valid identifier assignments KEY=VALUE
  if [[ "$trimmed" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    key="${BASH_REMATCH[1]}"
    val="${BASH_REMATCH[2]}"
    
    # Strip optional surrounding quotes
    val="${val%\"}"
    val="${val#\"}"
    val="${val%\'}"
    val="${val#\'}"
    
    export "$key"="$val"
  fi
done < "$ENV_FILE"

# 3. Validate that SUPABASE_ACCESS_TOKEN is present
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "❌ Error: SUPABASE_ACCESS_TOKEN is missing or empty in .env" >&2
  echo "" >&2
  echo "Setup Instructions:" >&2
  echo "1. Generate a Personal Access Token in your Supabase Account Dashboard:" >&2
  echo "   👉 https://supabase.com/dashboard/account/tokens" >&2
  echo "2. Add the token to your .env file:" >&2
  echo "   SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxxxxxxxxxxxxxx" >&2
  echo "3. Re-run this deployment script." >&2
  exit 1
fi

# 4. Resolve Target Project Reference
PROJECT_REF="${SUPABASE_PROJECT_REF:-${SUPABASE_PROJECT_ID:-}}"
if [[ -z "$PROJECT_REF" && -n "${SUPABASE_URL:-}" ]]; then
  PROJECT_REF="$(echo "$SUPABASE_URL" | sed -E 's|https?://([^.]+)\.supabase\.co.*|\1|')"
fi
if [[ -z "$PROJECT_REF" ]]; then
  PROJECT_REF="wtaewaeqmcqrwradlncj"
fi

# 5. Argument Parsing (supports --sync-secrets as first, only, or secondary flag)
SYNC_SECRETS=false
TARGET="whatsapp-webhook"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      echo "Usage: ./scripts/deploy-functions.sh [FUNCTION_NAME | --all] [--sync-secrets]"
      echo ""
      echo "Arguments:"
      echo "  FUNCTION_NAME    Specific edge function name in supabase/functions/ (default: whatsapp-webhook)"
      echo "  --all            Deploy all edge functions in supabase/functions/"
      echo ""
      echo "Options:"
      echo "  --sync-secrets   Synchronize repository secrets from .env prior to deployment"
      echo ""
      echo "Examples:"
      echo "  ./scripts/deploy-functions.sh                       # Deploys whatsapp-webhook"
      echo "  ./scripts/deploy-functions.sh --sync-secrets        # Syncs .env secrets & deploys whatsapp-webhook"
      echo "  ./scripts/deploy-functions.sh notify-field-manager  # Deploys notify-field-manager"
      echo "  ./scripts/deploy-functions.sh --all                 # Deploys all edge functions"
      echo "  ./scripts/deploy-functions.sh --sync-secrets --all  # Syncs .env secrets & deploys all"
      exit 0
      ;;
    --sync-secrets)
      SYNC_SECRETS=true
      shift
      ;;
    --all|all)
      TARGET="--all"
      shift
      ;;
    *)
      TARGET="$1"
      shift
      ;;
  esac
done

echo "=================================================================="
echo "  Supply Conduit - Automated Edge Function Deployment"
echo "=================================================================="
echo " Project Ref  : $PROJECT_REF"
echo " Target       : $TARGET"
echo " Sync Secrets : $SYNC_SECRETS"
echo " Auth Scoping : SUPABASE_ACCESS_TOKEN loaded from .env"
echo " JWT Verify   : Disabled (--no-verify-jwt)"
echo "=================================================================="

# Check if secrets synchronization was requested
if [[ "$SYNC_SECRETS" == "true" ]]; then
  echo "==> Synchronizing secrets from .env..."
  npx supabase secrets set --env-file "$ENV_FILE" --project-ref "$PROJECT_REF"
fi

# 6. Execute Deployment via Supabase CLI
if [[ "$TARGET" == "--all" || "$TARGET" == "all" ]]; then
  echo "==> Deploying ALL edge functions in supabase/functions/..."
  npx supabase functions deploy --project-ref "$PROJECT_REF" --no-verify-jwt
else
  echo "==> Deploying edge function '$TARGET'..."
  npx supabase functions deploy "$TARGET" --project-ref "$PROJECT_REF" --no-verify-jwt
fi

echo ""
echo "=================================================================="
echo "✅ Deployment completed successfully for: $TARGET"
if [[ "$TARGET" != "--all" && "$TARGET" != "all" ]]; then
  echo "   Endpoint: https://${PROJECT_REF}.supabase.co/functions/v1/${TARGET}"
fi
echo "=================================================================="
