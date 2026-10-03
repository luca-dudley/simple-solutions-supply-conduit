# PROJECT BRAIN: Supply Conduit

> **Single Source of Truth (SSOT)** for repository architecture, data models, runtime boundaries, and current operational state.  
> Last Synchronized: 2026-10-03

---

## Section 1: System Overview & Core Purpose

**Supply Conduit** (formerly FieldFetch) is a zero-friction, cross-industry field-to-office requisition and procurement engine developed under Simple Solutions' *"Build Once, Resell 10x"* product paradigm.

It serves Southern African operational job sites, civil construction contracts, cold-storage packhouses, commercial agricultural estates, and industrial logistics yards. Site foremen and technicians communicate requisitions via informal WhatsApp voice notes and text messages. The system verifies authenticity, transcribes the voice notes (Whisper), extracts line items using structured LLMs, detects 7-day duplicates, and streams requisitions into a real-time backoffice Kanban pipeline. From there, buyers generate official purchase orders and export Sage Pastel-compatible batch CSVs.

### Two-Agent Development Model
- **AGY (Lead Architect & Frontend Builder)**: Authors system blueprints, database contracts, state machine definitions, and implements the lightweight web portal (`portal/`).
- **Google Jules (Cloud Backend Engineer)**: Implements database migrations, Edge Functions (`supabase/functions/`), webhook verification, and automated dispatch routines in Supabase/GitHub.

---

## Section 2: Codebase & Directory Map

```text
supply-conduit/
├── .agents/                    # Autonomous AI agent configurations & skills
│   ├── agents/                 # architect, auditor, closer
│   └── skills/                 # architecture-planning, data-security, session-closeout
├── .ai/
│   └── SUPABASE_SCHEMA.md      # Auto-synchronized PostgreSQL live schema
├── docs/                       # Architectural blueprints, ADRs, specifications
│   ├── architecture/
│   │   ├── decisions/          # Architectural Decision Records
│   │   │   ├── 0001-database-contracts.md      # Multi-tenant schema, state machine & contracts
│   │   │   ├── 0002-whatsapp-ai-pipeline.md    # Webhook, Whisper audio & LLM parsing
│   │   │   ├── 0003-jules-backend-brief.md     # Google Jules execution checklist & tests
│   │   │   └── 0004-portal-ui-plan.md          # Lightweight portal Kanban & Pastel export
│   │   └── system-map.md       # Component maps, workflows, and boundary rules
│   └── specifications/         # Functional specs & feature roadmap
├── portal/                     # Lightweight static web portal workspace (auth, Kanban board, Pastel export)
├── supabase/                   # Supabase backend execution workspace (assigned to Google Jules)
│   ├── migrations/             # SQL migrations for PostgreSQL schema, RLS, functions
│   └── functions/              # Deno Edge Functions (whatsapp-webhook, notify-field-manager)
├── scripts/                    # sync_schema.sh and operational maintenance utilities
├── tools/                      # Operational CLI scripts (seed-runner, validate-pastel-csv)
├── AGENTS.md                   # Agent guidelines, rules, and two-agent collaboration model
└── PROJECT_BRAIN.md            # This document (Single Source of Truth)
```

---

## Section 3: Architectural Boundaries & Constraints

1. **Agent Role Invariants**:
   - AGY is the System Architect and Frontend Developer. AGY creates blueprints and static portal code.
   - Google Jules is the Cloud Backend Developer. Jules implements and executes migrations and Supabase Edge Functions.
2. **Access Control & Multi-Tenancy**:
   - Multi-tenant data isolation strictly enforced via `company_id` and PostgreSQL Row-Level Security (RLS).
   - `portal/` connects via `@supabase/supabase-js` using standard user auth (JWT).
   - `SUPABASE_SERVICE_ROLE_KEY` is strictly confined to Edge Functions and backend workers, never bundled client-side.
3. **Data Contracts**:
   - Requisition status state machine: `LOGGED` -> `PENDING_QUOTE` -> `PO_PLACED` -> `DELIVERED_TO_SITE` -> `CLOSED` (plus `CANCELLED`).
   - PO Numbers: Generated as `PO-{10000 + seq}` upon entering `PO_PLACED`.
   - 7-Day Duplicate Detection: Executed on the database via fuzzy token matching across a rolling 7-day window.
4. **Export Formatting**:
   - Sage Pastel CSV export adheres strictly to the 9-column spec defined in `0004-portal-ui-plan.md` and verified by `tools/validate-pastel-csv.py`.

---

## Section 4: Data Models & External Integrations

### Primary Entities
- `companies`: Multi-tenant organization boundaries.
- `sites`: Physical job sites, civil contracts, packhouses, agricultural estates.
- `zones`: Specific operational quadrants (e.g., Chamber B, Pump Station 3).
- `requesters`: Field agents registered with mobile phone numbers.
- `requisitions`: Procurement header record holding status, urgency, media, and duplicate indicators.
- `requisition_items`: Line items extracted with quantity, unit of measure, part number, and unit price.

### External Touchpoints
- **Meta Cloud API (WhatsApp)**: Inbound webhooks, media downloads, and outbound transactional updates.
- **OpenAI Whisper / LLM API**: Audio transcription and structured JSON extraction.
- **Supabase Realtime & Auth**: WebSocket updates for the backoffice board and user session management.
- **Sage Pastel Partner / Evolution**: CSV batch purchase order ingestion.

---

## Section 5: Active Schema Status

The active database schema is documented and synchronized in:
👉 [`.ai/SUPABASE_SCHEMA.md`](file:///home/luca/dev/simple-solutions-supply-conduit/.ai/SUPABASE_SCHEMA.md)

Updated automatically via:
```bash
./scripts/sync_schema.sh
```

---

## Section 6: Changelog & Current State

### [2026-09-29] - Master Architectural Blueprints & Two-Agent Alignment
- **Author**: AGY (Lead Systems Architect)
- **Milestones Completed**:
  - Authored [`0001-database-contracts.md`](file:///home/luca/dev/simple-solutions-supply-conduit/docs/architecture/decisions/0001-database-contracts.md): Defined complete multi-tenant schema, requisition status state machine, PO number generation algorithm, 7-day duplicate detection RPC query, RLS policies, and shared JSON/TypeScript data contracts.
  - Authored [`0002-whatsapp-ai-pipeline.md`](file:///home/luca/dev/simple-solutions-supply-conduit/docs/architecture/decisions/0002-whatsapp-ai-pipeline.md): Designed Meta Cloud API handshake and HMAC-SHA256 signature verification, message idempotency (`whatsapp_message_id`), Whisper audio processing with regional vocabulary prompt, LLM parsing prompt strategy with confidence scoring, and automated field confirmation pings.
  - Authored [`0003-jules-backend-brief.md`](file:///home/luca/dev/simple-solutions-supply-conduit/docs/architecture/decisions/0003-jules-backend-brief.md): Formulated a precise implementation brief for Google Jules detailing migration sequencing, step-by-step logic for `whatsapp-webhook` and `notify-field-manager` Edge Functions, and automated test criteria.
  - Authored [`0004-portal-ui-plan.md`](file:///home/luca/dev/simple-solutions-supply-conduit/docs/architecture/decisions/0004-portal-ui-plan.md): Designed the lightweight static portal architecture (`portal/`), real-time Kanban subscription model (`postgres_changes`), duplicate order warnings, relief-admin triage workflow, and client-side Sage Pastel CSV export specification.
  - Updated [`AGENTS.md`](file:///home/luca/dev/simple-solutions-supply-conduit/AGENTS.md) and [`PROJECT_BRAIN.md`](file:///home/luca/dev/simple-solutions-supply-conduit/PROJECT_BRAIN.md) to formalize the two-agent development pipeline (AGY as Architect/Frontend Builder, Google Jules as Cloud Backend Engineer).
- **Current Operational State**: Architectural blueprints complete, reviewed, and finalized. Zero implementation code touched. System is fully prepped for Google Jules to execute backend cloud implementations.

### [2026-09-29] - Session Closeout & Schema Synchronization Audit
- **Author**: Closer Agent (@closer)
- **Milestones Completed**:
  - Executed `./scripts/sync_schema.sh` after aligning the migration directory path (`supabase/migrations/`) and gracefully handling the pre-migration state.
  - Verified `.ai/SUPABASE_SCHEMA.md` schema documentation status.
  - Added `.gitkeep` markers for empty directories in `supabase/migrations/` and `supabase/functions/` (`whatsapp-webhook`, `notify-field-manager`, `_shared`) to preserve workspace tree in Git.
  - Audited `git status` across all directories (`docs/`, `portal/`, `supabase/`, `scripts/`, `.agents/`, `.ai/`).
  - Drafted standardized Conventional Commit message for session handoff.
- **Current Operational State**: Master architectural blueprints and two-agent collaboration contracts finalized; repository ready for Google Jules cloud backend execution and subsequent AGY static frontend construction.

### [2026-10-02] - Foundational Database Migrations & Office Backoffice Portal Implementation
- **Author**: AGY (Lead Architect & Frontend Builder)
- **Milestones Completed**:
  - Implemented 3-step production database migrations in `supabase/migrations/`:
    - `20261002000001_core_entities.sql`: PostgreSQL extensions (`uuid-ossp`, `pgcrypto`, `pg_trgm`), enums (`requisition_status`, `urgency_level`), core multi-tenant tables (`companies`, `sites`, `zones`, `requesters`, `requisitions`, `requisition_items`), and GIN trigram indexes.
    - `20261002000002_sequences_and_functions.sql`: Sequences (`requisition_ref_seq`, `po_number_seq`), auto-generation triggers for reference codes (`REQ-YYMM-XXXX`) and PO numbers (`PO-1XXXX`), and 7-day duplicate detection RPC (`check_7day_duplicates`).
    - `20261002000003_rls_and_seed.sql`: Row-Level Security policies with multi-tenant isolation, Supabase Realtime publication configuration (`requisitions`, `requisition_items`), and initial seed data for immediate UI verification.
  - Successfully applied migrations to remote Supabase instance and verified triggers and RPCs via psql.
  - Synchronized active schema manifest into `.ai/SUPABASE_SCHEMA.md` using `./scripts/sync_schema.sh`.
  - Built full lightweight office portal (`portal/`):
    - `portal/index.html`: Dark industrial themed authentication card supporting Supabase Auth and rapid prototype demo session bypass.
    - `portal/requisitions.html`: Master backoffice board with top navbar, company selector, live realtime connection status indicator, relief-admin triage banner toggle, filter bar (site, urgency, unassigned, duplicates, text search), and 5-column Kanban pipeline (`LOGGED`, `PENDING_QUOTE`, `PO_PLACED`, `DELIVERED_TO_SITE`, `CLOSED`).
    - `portal/assets/js/kanban.js`: Supabase JS client integration, live WebSocket subscription (`postgres_changes`), optimistic UI updates, single-click state machine transitions, duplicate alert inspection, and triage workflows.
    - `portal/assets/js/pastel-export.js`: Client-side Sage Pastel CSV export matching the 9-column specification with formula injection neutralization, verified against `scripts/validate-pastel-csv.py`.
    - `portal/assets/js/config.js`: Centralized Supabase credentials and demo session management.
- **Current Operational State**: Database schema fully migrated and live. Office Backoffice Portal fully implemented and functional. System is ready for live WhatsApp webhook ingestion and Edge Function execution.

### [2026-10-03] - Session Closeout, Schema Synchronization & Portal Audit
- **Author**: Closer Agent (@closer)
- **Milestones Completed**:
  - Executed `./scripts/sync_schema.sh` to extract the full active database DDL from remote Supabase via `pg_dump`.
  - Refreshed [`.ai/SUPABASE_SCHEMA.md`](file:///home/luca/dev/simple-solutions-supply-conduit/.ai/SUPABASE_SCHEMA.md) with 719 lines of verified PostgreSQL DDL, covering core entities (`companies`, `sites`, `zones`, `requesters`, `requisitions`, `requisition_items`), enums (`requisition_status`, `urgency_level`), triggers (`generate_requisition_reference`, `assign_po_number`), and RPC function (`check_7day_duplicates`).
  - Conducted working tree audit (`git status -s`, `git diff --stat`), confirming all migration SQL files (`supabase/migrations/`), portal components (`portal/index.html`, `portal/requisitions.html`, `portal/assets/js/kanban.js`, `portal/assets/js/pastel-export.js`, `portal/assets/js/config.js`), and sync scripts are cleanly tracked with zero stray/temporary artifacts.
  - Verified security posture of client assets: `config.js` restricts exposed tokens strictly to Supabase public `anon` role with Row-Level Security policies active.
  - Formulated standardized Conventional Commit message for session preservation.
- **Current Operational State**: Production database migrations applied and live; web portal fully operational with real-time Kanban and Pastel CSV export; schema documentation fully synchronized. Next milestone: Jules backend implementation of `whatsapp-webhook` and `notify-field-manager` Edge Functions.


