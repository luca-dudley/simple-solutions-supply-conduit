# Supply Conduit

> **Zero-Friction, Cross-Industry Field-to-Office Requisition and Procurement Engine**  
> Built under Simple Solutions' *"Build Once, Resell 10x"* paradigm.  
> Serving operational job sites, civil construction, cold-storage packhouses, commercial agricultural estates, and industrial warehouses across Southern Africa.

---

## 🏗 System Architecture & Monorepo Overview

```
supply-conduit/
├── .github/workflows/          # CI/CD: Automated lint, test, and container deployments
├── apps/
│   └── web/                    # Next.js 14+ (App Router) Backoffice Operations Portal
├── services/
│   └── ingestion/              # FastAPI Python 3.11+ Meta/Twilio WhatsApp & Whisper/LLM Parser
├── packages/
│   ├── supabase/               # PostgreSQL schema, migrations, RLS policies & Edge Functions
│   └── shared/                 # Canonical status constants, urgency enums, and DB types
└── tools/                      # Seed runners, test WhatsApp payload mocks, Sage Pastel CSV validator
```

### Core Subsystems:
1. **Field Webhook & AI Engine (`services/ingestion`)**:
   - Python 3.11+ / FastAPI microservice listening to incoming WhatsApp Meta Cloud API webhooks.
   - Verifies HMAC SHA-256 signatures (`X-Hub-Signature-256`).
   - Offloads audio voice notes to Whisper transcription.
   - Structured JSON item parsing with Pydantic (extracting items, quantities, urgency, site zones).
   - Real-time rolling 7-day duplicate check against recently logged requisitions.
2. **Office Backoffice Portal (`apps/web`)**:
   - Next.js 14+ (App Router) with TypeScript, Tailwind CSS, Lucide Icons, and Supabase SSR.
   - Real-time Kanban pipeline: `LOGGED` ➔ `PENDING_QUOTE` ➔ `PO_PLACED` ➔ `DELIVERED_TO_SITE` ➔ `CLOSED`.
   - Visual badges for urgent/critical breakdowns & rolling 7-day duplicate requisitions.
   - Single-click Sage Pastel Partner/Evolution CSV and PDF Purchase Order generation.
3. **Database & Storage (`packages/supabase`)**:
   - PostgreSQL schema with multi-tenant company isolation via Row-Level Security (RLS).
   - Automated PO reference generator sequence (`PO-YYYYMM-XXXX`).
   - Deno Edge Function (`dispatch-status-ping`) dispatching automated WhatsApp updates back to site requesters upon status change.
4. **Tooling & Operational Scripts (`tools`)**:
   - Root-level CLI utilities for seeding dummy mock sites/items and validating Sage Pastel CSV column schemas.

---

## 🚀 Quickstart & Local Development

### 1. Prerequisites
- Docker & Docker Compose
- Node.js 18+ & npm/pnpm
- Python 3.11+
- Supabase CLI (`npm install -g supabase`)

### 2. Environment Configuration
Copy the template `.env.example` files:
```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
cp services/ingestion/.env.example services/ingestion/.env
```

### 3. Start Database (Supabase)
```bash
cd packages/supabase
supabase start
supabase db reset # Applies migrations and seed data
```

### 4. Run the Ingestion Microservice (FastAPI)
```bash
cd services/ingestion
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
API Documentation will be available at: [http://localhost:8000/docs](http://localhost:8000/docs)

### 5. Run the Office Backoffice Web App (Next.js)
```bash
cd apps/web
npm install
npm run dev
```
Access the Kanban board at: [http://localhost:3000](http://localhost:3000)

### 6. Deploy Supabase Edge Functions
Automated deployments use repository-scoped credentials from `.env` to prevent cross-account session contamination:

1. Ensure `SUPABASE_ACCESS_TOKEN` is configured in `.env` (generate from [Supabase Account Tokens](https://supabase.com/dashboard/account/tokens)).
2. Deploy functions using the automated deployment script:
```bash
# Deploy default webhook handler (whatsapp-webhook)
./scripts/deploy-functions.sh

# Deploy a specific edge function
./scripts/deploy-functions.sh notify-field-manager

# Deploy all edge functions in supabase/functions/
./scripts/deploy-functions.sh --all

# Synchronize secrets from .env before deploying
./scripts/deploy-functions.sh --all --sync-secrets
```

---

## 🧪 Testing Checklist & Verification

- **Simulate WhatsApp Inbound Webhook**:
  ```bash
  curl -X POST http://localhost:8000/api/v1/whatsapp/webhook \
    -H "Content-Type: application/json" \
    -d @tools/test-whatsapp-payload.json
  ```
- **Run Python Ingestion Unit & Security Tests**:
  ```bash
  cd services/ingestion
  pytest
  ```
- **Validate Sage Pastel Export Format**:
  ```bash
  python3 tools/validate-pastel-csv.py test_export.csv
  ```
- **Run Seed Data Script**:
  ```bash
  python3 tools/seed-runner.py
  ```
