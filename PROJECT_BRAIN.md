# PROJECT BRAIN: Supply Conduit

> **Single Source of Truth (SSOT)** for repository architecture, data models, runtime boundaries, and current operational state.  
> Last Synchronized: 2026-10-08

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
### [2026-10-05] - Production WhatsApp Webhook & Structured Gemini AI Extraction Implementation
- **Author**: Google Jules (Cloud Backend Engineer) & AGY
- **Milestones Completed**:
  - Authored shared TypeScript models and data contracts in [`supabase/functions/_shared/types.ts`](file:///home/luca/dev/simple-solutions-supply-conduit/supabase/functions/_shared/types.ts), defining core status enums (`UrgencyLevel`, `RequisitionStatus`), Meta Cloud API webhook payloads, Gemini structured extraction schemas, and multi-tenant database entities.
  - Implemented centralized Supabase service role client in [`supabase/functions/_shared/supabaseClient.ts`](file:///home/luca/dev/simple-solutions-supply-conduit/supabase/functions/_shared/supabaseClient.ts) with local and cloud environment resolution.
  - Built Meta Cloud API utilities in [`supabase/functions/_shared/whatsapp.ts`](file:///home/luca/dev/simple-solutions-supply-conduit/supabase/functions/_shared/whatsapp.ts), including HMAC-SHA256 signature verification (`X-Hub-Signature-256`), media downloading, and transactional outbound confirmation templates adhering to ADR-0002 Section 5.
  - Implemented structured parsing engine in [`supabase/functions/_shared/gemini.ts`](file:///home/luca/dev/simple-solutions-supply-conduit/supabase/functions/_shared/gemini.ts) with South African industrial terminology dictionary, Gemini 2.5 Flash invocation with automatic multi-model fallback (`gemini-3.5-flash`, `gemini-3.8-flash`), and offline heuristic parsing.
  - Implemented production webhook handler in [`supabase/functions/whatsapp-webhook/index.ts`](file:///home/luca/dev/simple-solutions-supply-conduit/supabase/functions/whatsapp-webhook/index.ts):
    - Handshake GET verification (`hub.mode`, `hub.verify_token`, `hub.challenge`).
    - Cryptographic HMAC-SHA256 signature verification.
    - Idempotency guard on `whatsapp_message_id`.
    - Auto-provisioning and site resolution for new requesters.
    - 7-day duplicate detection via RPC `check_7day_duplicates`.
    - Requisition header and line items persistence.
    - Automated outbound WhatsApp confirmation ping via Meta Cloud API v20.0.
  - Created automated test suite in [`supabase/functions/whatsapp-webhook/index_test.ts`](file:///home/luca/dev/simple-solutions-supply-conduit/supabase/functions/whatsapp-webhook/index_test.ts) covering GET handshake, HMAC security, idempotency, requester auto-provisioning, and 7-day duplicate detection (100% pass across all 5 test suites).
  - Implemented automated deployment script in [`scripts/deploy-functions.sh`](file:///home/luca/dev/simple-solutions-supply-conduit/scripts/deploy-functions.sh) with repo-scoped credential isolation (`SUPABASE_ACCESS_TOKEN`), `--project-ref` binding, dynamic target routing, and `--no-verify-jwt` flags.
  - Successfully verified live deployment of `whatsapp-webhook` directly to Supabase cloud and validated active Meta GET handshake challenge resolution.
  - Documented deployment workflows in [`README.md`](file:///home/luca/dev/simple-solutions-supply-conduit/README.md) and created template in [`.env.example`](file:///home/luca/dev/simple-solutions-supply-conduit/.env.example).
  - Executed `./scripts/sync_schema.sh` to synchronize `.ai/SUPABASE_SCHEMA.md`.
### [2026-10-05] - Lightweight Operational Tracker, Conversational Tracking & Delivery Alert Dispatch
- **Author**: AGY & Google Jules
- **Milestones Completed**:
  - **Visual & Kanban Board Refactor (`portal/`)**:
    - Transitioned entire portal UI (`portal/requisitions.html` and `portal/index.html`) from dark cyberpunk to a crisp, trustworthy light industrial theme (clean white canvas, slate-50/100 column backgrounds, crisp slate-800 typography, and clean status badges).
    - Header cleanup: Removed tenant switcher dropdown and "Export Pastel Batch" button, keeping brand logo, live realtime sync indicator, quick filters (site, urgency, unassigned, duplicates), search bar, and user profile avatar / sign out.
    - Native HTML5 Drag-and-Drop: Implemented drag-and-drop across all 5 operational columns (`LOGGED`, `PENDING_QUOTE`, `PO_PLACED`, `DELIVERED_TO_SITE`, `CLOSED`) with visual feedback (`is-dragging`, `drag-over`).
    - Multi-Card Columns: Enabled clean independent vertical scrolling (`overflow-y-auto`) for columns with stacked cards.
    - Completed Column Retention Rule: Configured `CLOSED` column to render only requisitions completed within the last 14 days by default, adding a `#showArchivedClosedToggle` toggle to view older archived tickets.
  - **Inspection Modal Simplification**:
    - Purged ERP and accounting clutter: Removed `PART #`, `PASTEL CODE`, `UNIT PRICE`, `TOTAL`, tax / VAT calculations, and Pastel batch export triggers.
    - Streamlined line items table to: Description, Quantity, and Unit of Measure, plus raw WhatsApp voice note / text transcript preview.
    - Replaced accounting inputs with practical operational inputs: Assigned Supplier Name (`supplier_name`), Supplier Invoice / PO Ref # (`po_number`), and Internal Operations Note (`notes`), persisted via a dedicated "Save Details" button.
  - **Conversational WhatsApp Ingestion & Keyword Tracking (`supabase/functions/whatsapp-webhook/`)**:
    - Updated instant order logging reply to the exact prompt template:
      `✅ *Requisition Logged: [REF_CODE]*\n\n• [Extracted Items]\n📍 Site: [Site Name]\n⏱ Status: *Logged / In Review*\n\nReply *STATUS* anytime to check active orders.`
    - Keyword tracking inquiry handler: Recognizes `STATUS`, `TRACK`, and requisition reference patterns (`REQ-...`). Queries open requisitions for the requester without invoking Gemini or creating duplicate tickets, returning active stage summaries.
    - Automated Delivery Alert: Integrated automated outbound WhatsApp delivery ping upon status transition to `DELIVERED_TO_SITE` (`notify-field-manager` and `whatsapp-webhook`), messaging the requester that orders are ready at the site office.
  - **Verification & Deployment**:
    - Expanded test suite in `supabase/functions/whatsapp-webhook/index_test.ts` to 7 test suites (10 steps), verifying GET handshake, HMAC verification, idempotency, auto-provisioning, 7-day duplicate detection, keyword tracking (`STATUS` & `REQ-...`), and delivery alert dispatch (100% pass rate).
    - Synchronized secrets and deployed both functions (`whatsapp-webhook`, `notify-field-manager`) to remote Supabase via `./scripts/deploy-functions.sh --all --sync-secrets`.
    - Synchronized schema documentation via `./scripts/sync_schema.sh`.
- **Current Operational State**: Complete end-to-end operational procurement conduit live with light industrial dashboard, HTML5 drag-and-drop, WhatsApp order intake, conversational tracking, and automated delivery notifications.

### [2026-10-05] - Multi-Facility Enterprise Architecture, Gemini 3.8 Flash & False Duplicate Elimination
- **Author**: AGY & Google Jules
- **Milestones Completed**:
  - **Gemini 3.8 Flash Configuration & Structured Hierarchy Extraction**:
    - Set primary default model to `gemini-3.8-flash` in `supabase/functions/_shared/gemini.ts` with rapid failover to `gemini-flash-latest` and `gemini-3.7-flash` (bounded by 4000ms `AbortSignal.timeout`) and offline heuristic parsing fallback.
    - Updated system prompt `SOUTH_AFRICAN_INDUSTRIAL_PROMPT` and `GEMINI_RESPONSE_SCHEMA` to extract macro sites (`site_name`), functional zones (`zone_name`), and granular asset locations (`location_detail`).
  - **Dynamic Multi-Tier Location Hierarchy ("Find-or-Create" Sites & Zones)**:
    - Added `location_detail TEXT` column to `public.requisitions` in migration `20261005000001_multi_facility_and_duplicate_tightening.sql`.
    - Implemented `findOrCreateLocation` in `supabase/functions/whatsapp-webhook/index.ts` to automatically match or provision `public.sites` and `public.zones` scoped under tenant `company_id`.
    - Implemented unified multi-tier location formatter across WhatsApp confirmation pings, status tracking replies, Kanban card views, and inspection modals: `[Site Name] • [Zone Name] ([Location Detail])` or `[Site Name] • [Zone Name / Detail]`.
  - **Automatic Requester Profile Resolution**:
    - Parsed `contacts[0].profile.name` from incoming Meta WhatsApp webhook payloads to update placeholder names in `public.requesters` to actual user profile names.
    - Updated existing phone `+27605468176` to `'Luca Dudley'`.
  - **Tightened 7-Day Duplicate Order Detection (False Positive Elimination)**:
    - Updated RPC `check_7day_duplicates` and `extractDuplicateSearchTokens` to exclude generic hardware stop-words (`pvc`, `steel`, `plastic`, `fitting`, `joint`, `roll`, `tape`, `meter`, `pipe`, `plug`, `unit`, `box`, `standard`, etc.) and tokens under 4 characters.
    - Prevented spurious duplicate collisions between unrelated parts (e.g. PVC ball valve vs PVC elbow or HDPE pipe).
    - Cleared prior false duplicate flag on live requisition `REQ-2610-1015`.
  - **High-Readability Outbound WhatsApp Card Templates & Formatting Helpers**:
    - Implemented clean quantity tag helper `formatQuantityItem`: outputs clean multiplication tags (`1x`, `3x`), capitalizes non-standard units (e.g. `3x PTFE Thread Seal Tape (Rolls)`), and purges generic unit terms (`unit`, `units`, `each`, `pcs`) to eliminate plural bugs.
    - Implemented clean multi-tier location helper `formatLocation`: middle dot joining with deduplication and empty/null segment filtering.
    - Standardized outbound message layouts:
      - **Template A (Order Confirmation Receipt)**: `📋 ORDER LOGGED • [REF_CODE]`, item list with multiplication tags, location, urgency, status, optional 7-day duplicate warning right above `────────────────` divider, and tracking tip.
      - **Template B (Active Orders Tracking)**: `📦 YOUR ACTIVE ORDERS ([Count])`, itemized cards per order with clean stages, location, and indented `- [Qty]x [Item]` bullets.
      - **Template C (Delivery Arrival Alert)**: `🚚 ORDER ARRIVED • [REF_CODE]`, site delivery confirmation, line items, and `📍 Collection: [Clean Formatted Location] (Site Office)`.
  - **Verification & Deployment**:
    - Expanded test suite in `supabase/functions/whatsapp-webhook/index_test.ts` to 11 automated test suites (13 steps), validating all quantity, location, and card template formats with a 100% pass rate.
    - Deployed updated edge functions (`whatsapp-webhook`, `notify-field-manager`) via `./scripts/deploy-functions.sh --all`.
    - Synchronized live PostgreSQL schema into `.ai/SUPABASE_SCHEMA.md` via `./scripts/sync_schema.sh`.
- **Current Operational State**: Multi-facility enterprise hierarchy and high-readability industrial card templates live; automatic requester profile resolution and zero-false-positive duplicate detection active; edge functions and dashboard verified in production.

### [2026-10-08] - ADR-0005 Phase 1 & Phase 2: Tenant Isolation, Fail-Closed RLS & Webhook Whitelisting
- **Author**: Google Jules & AGY
- **Milestones Completed**:
  - **Phase 1: Database Migration & Fail-Closed RLS (`supabase/migrations/20261006000001_tenant_isolation_and_profiles.sql`)**:
    - Extended `public.companies` with 6-character unique uppercase onboarding code `company_code` (e.g. `APEX01`) and unique uppercase index `idx_companies_company_code_upper`.
    - Created `public.user_role` enum (`admin`, `buyer`, `dispatcher`, `viewer`).
    - Implemented `public.user_profiles` multi-tenant table linked 1:1 with `auth.users(id)` and `public.companies(id)`, indexed by `(user_id, company_id)` and `company_id`.
    - Added partial unique index `uq_requesters_active_phone` on `public.requesters(phone_number) WHERE is_active = true` to enforce single active tenant phone routing.
    - Updated `current_user_company_id()` security definer function to resolve tenant ID directly from `public.user_profiles` via `auth.uid()`, with fallback to `app_metadata`.
    - Hardened all Row-Level Security policies across `companies`, `sites`, `zones`, `requesters`, `requisitions`, `requisition_items`, and `user_profiles` to fail closed (purged all prototype `IS NULL` clauses).
    - Synchronized live remote PostgreSQL schema into [`.ai/SUPABASE_SCHEMA.md`](file:///home/luca/dev/simple-solutions-supply-conduit/.ai/SUPABASE_SCHEMA.md) via `./scripts/sync_schema.sh`.
  - **Phase 2: Inbound WhatsApp Multi-Tenant Whitelist & Auto-Enrollment (`supabase/functions/whatsapp-webhook/index.ts`)**:
    - Replaced default company auto-provisioning with strict 3-way whitelist decision matrix:
      1. **Active Whitelisted Requester**: Scopes requisition strictly to `requester.company_id` and `default_site_id`.
      2. **Deactivated Requester (`is_active = false`)**: Blocks ticket creation and dispatches account inactive notice.
      3. **Unknown Number**: Checks for valid 6-character `company_code` (`^[A-Z0-9]{6}$`). If matched, auto-enrolls requester into tenant and dispatches welcome receipt; otherwise sends unknown number guide receipt without creating records or invoking Gemini.
    - Deployed updated `whatsapp-webhook` edge function to production Supabase cloud (`wtaewaeqmcqrwradlncj`).
  - **Verification**:
    - Expanded automated test suite in [`supabase/functions/whatsapp-webhook/index_test.ts`](file:///home/luca/dev/simple-solutions-supply-conduit/supabase/functions/whatsapp-webhook/index_test.ts) to 11 test suites (16 steps), achieving a **100% pass rate** (0 failures).
- **Current Operational State**: Phase 1 and Phase 2 live; database migrations applied and WhatsApp webhook whitelisting active.

### [2026-10-08] - ADR-0005 Phase 3 & Phase 4: Client Auth, Session Guards & Team Whitelist UI
- **Author**: AGY (Lead Systems Architect & Frontend Builder)
- **Milestones Completed**:
  - **Phase 3: Client Authentication & Session Guards (`portal/`)**:
    - Completely retired `#demoBypassBtn` from [`portal/index.html`](file:///home/luca/dev/simple-solutions-supply-conduit/portal/index.html).
    - Wired authentication form strictly to `supabase.auth.signInWithPassword({ email, password })`.
    - Integrated multi-tenant profile verification on sign in: verifies `public.user_profiles` linked to authenticated UID and confirms `is_active === true`; fails closed and immediately signs out unassociated or inactive accounts.
    - Implemented immediate `enforceSessionGuard()` in [`portal/assets/js/kanban.js`](file:///home/luca/dev/simple-solutions-supply-conduit/portal/assets/js/kanban.js) before rendering DOM components. Redirects unauthenticated traffic immediately to `index.html`.
    - Bound `supabase.auth.onAuthStateChange` to reactively redirect on `SIGNED_OUT` or token expiry.
    - Completely purged hardcoded `AppConfig.COMPANY_ID` constants across all queries and realtime subscriptions—relies 100% on fail-closed PostgreSQL Row-Level Security policies.
    - Added user identity badge in [`portal/requisitions.html`](file:///home/luca/dev/simple-solutions-supply-conduit/portal/requisitions.html) top navigation, displaying user name, role badge (`admin`/`buyer`), tenant company name, and onboarding `company_code` alongside a functional Logout button.
  - **Phase 4: Field Team & Whitelist Management UI (`portal/`)**:
    - Added **"Field Team"** button and live active foremen count badge in top navigation.
    - Built **Team Management Modal** (`#teamModal`): displays tenant onboarding code (`APEX01`), search filter (name, phone, role), site filter, and status filter (All, Active, Inactive).
    - Implemented one-click status toggle with real-time optimistic feedback to deactivate or reactivate foremen in `public.requesters`.
    - Built **Add Requester Form Modal** (`#addRequesterModal`) with automatic E.164 phone normalization (`0821234567` -> `+27821234567`), role designation, and dynamic site selection.
    - Built **Batch CSV Import Tool** (`#batchImportModal`):
      - "Download CSV Template" button generating formatted template with sample rows.
      - File picker with client-side formula injection neutralization (stripping leading `=`, `+`, `-`, `@`).
      - Validation engine with row-by-row syntax feedback chips prior to database execution.
      - Bulk insert commit directly into `public.requesters` scoped to active tenant.
  - **Security & Edge Configuration**:
    - Authored and committed [`portal/_headers`](file:///home/luca/dev/simple-solutions-supply-conduit/portal/_headers) with production Content Security Policy, frame options (`DENY`), and permission policy headers per ADR-0005 Section 6.3.
  - **Verification**:
    - Validated all JavaScript syntax with `node -c` (0 syntax errors).
    - Executed live end-to-end integration tests verifying auth session, user profile resolution, site isolation, requester provisioning, deactivation, and reactivation under RLS.
- **Current Operational State**: Phases 1 through 4 of ADR-0005 complete, verified, and operational. Ready for Phase 5 (Cloudflare Pages deployment and production custom domain binding).




