# ADR-0003: Google Jules Cloud Backend Implementation Brief & Verification Plan

## Status
Accepted

## Target Implementer
**Google Jules** (Autonomous Cloud Backend Engineer)

## Context
Google Jules will execute backend implementation tasks directly in GitHub and Supabase. To eliminate ambiguity, hallucinations, or breaking architectural invariants, this brief defines the exact order of operations, logic specifications for Supabase Edge Functions, database migration sequencing, acceptance criteria, and automated test procedures.

---

## 1. Migration Execution Sequencing (Supabase PostgreSQL)

Jules must generate and execute the SQL migrations in the exact following chronological sequence:

```text
supabase/migrations/
├── 20260929000001_core_entities.sql
├── 20260929000002_sequences_and_functions.sql
└── 20260929000003_rls_and_triggers.sql
```

### Migration 1: `20260929000001_core_entities.sql`
- Create extensions: `uuid-ossp`, `pgcrypto`, `pg_trgm`.
- Create enum types:
  - `requisition_status`: `'LOGGED'`, `'PENDING_QUOTE'`, `'PO_PLACED'`, `'DELIVERED_TO_SITE'`, `'CLOSED'`, `'CANCELLED'`
  - `urgency_level`: `'ROUTINE'`, `'URGENT'`, `'CRITICAL_BREAKDOWN'`
- Create tables: `companies`, `sites`, `zones`, `requesters`, `requisitions`, `requisition_items`.
- Add unique constraint: `requisitions(whatsapp_message_id)`.
- Add index on `requisition_items(item_description gin_trgm_ops)`.

### Migration 2: `20260929000002_sequences_and_functions.sql`
- Create sequence: `requisition_ref_seq START 1001;`
- Create sequence: `po_number_seq START 10001;`
- Implement trigger function `generate_requisition_ref()` on `requisitions` BEFORE INSERT.
- Implement trigger function `assign_po_number()` on `requisitions` BEFORE UPDATE when status becomes `'PO_PLACED'`.
- Implement RPC function `check_7day_duplicates(p_site_id UUID, p_search_tokens TEXT[], p_exclude_requisition_id UUID)`.

### Migration 3: `20260929000003_rls_and_triggers.sql`
- Enable RLS on all public tables.
- Create security function `current_user_company_id()`.
- Add policies for tenant isolation on `companies`, `sites`, `zones`, `requesters`, `requisitions`, `requisition_items`.
- Create database webhook trigger to invoke `notify-field-manager` on `requisitions` status update.

---

## 2. Edge Function 1: `supabase/functions/whatsapp-webhook/index.ts`

### Purpose
Handles incoming webhooks from Meta Cloud API, verifies HMAC signature, downloads audio if present, transcribes via Whisper, extracts line items via LLM, persists to Supabase, and triggers confirmation.

### Step-by-Step Logic
1. **Handle GET Requests (Handshake)**:
   - Extract query parameters: `hub.mode`, `hub.verify_token`, `hub.challenge`.
   - Compare `hub.verify_token` against `Deno.env.get("WHATSAPP_VERIFY_TOKEN")`.
   - If matched, return status 200 with body `hub.challenge`. Else return status 403.
2. **Handle POST Requests (Webhook Processing)**:
   - Extract header `x-hub-signature-256`.
   - Read request body as `ArrayBuffer`.
   - Compute HMAC-SHA256 with key `Deno.env.get("WHATSAPP_APP_SECRET")`.
   - If signature does not match, return status 403 Forbidden.
3. **Parse Incoming Message Payload**:
   - Extract `from` (phone number), `id` (`whatsapp_message_id`), and `type` (`text` or `audio`).
   - If `id` already exists in `requisitions.whatsapp_message_id`, return status 200 immediately (Idempotency).
4. **Audio / Text Ingestion**:
   - If `text`: extract `body`.
   - If `audio`: fetch download URL from `https://graph.facebook.com/v19.0/{audio_id}`, download binary, stream to OpenAI Whisper API with domain prompt, and record audio transcript.
5. **AI Extraction**:
   - Call LLM API (OpenAI/Groq) using structured JSON output adhering to `StructuredRequisitionExtraction` schema.
6. **Lookup / Auto-Provision Requester**:
   - Query `requesters` by `phone_number`.
   - If not found, create new record in `requesters` assigned to default site.
7. **Duplicate Check**:
   - Invoke RPC `check_7day_duplicates` passing extracted item names.
8. **Persist Transaction**:
   - Insert `requisition` with status `'LOGGED'` and `is_duplicate_suspect`.
   - Insert child `requisition_items`.
9. **Dispatch Outbound WhatsApp Confirmation**:
   - Post message to Meta Cloud API endpoint `https://graph.facebook.com/v19.0/{phone_number_id}/messages`.
   - Return status 200 OK.

---

## 3. Edge Function 2: `supabase/functions/notify-field-manager/index.ts`

### Purpose
Listens for database `UPDATE` events on `requisitions.status` and dispatches automated WhatsApp status updates to the field requester.

### Step-by-Step Logic
1. Parse event payload from Supabase Database Webhook:
   - Extract `record` and `old_record`.
2. Check if `record.status !== old_record.status`.
   - If unchanged, return status 200 (No-op).
3. Query requester phone number and site name:
   - Join `requesters` on `record.requester_id`.
   - Join `sites` on `record.site_id`.
4. Construct notification copy based on new status:
   - `PENDING_QUOTE`: *"Procurement is actively sourcing quotes for your requisition {ref}."*
   - `PO_PLACED`: *"Purchase Order {po_number} has been placed with supplier {supplier_name} for requisition {ref}."*
   - `DELIVERED_TO_SITE`: *"Items for requisition {ref} (PO: {po_number}) have arrived on site. Please inspect and sign off."*
   - `CLOSED`: *"Requisition {ref} has been closed and matched to invoice. Thank you."*
   - `CANCELLED`: *"Requisition {ref} has been marked as cancelled: {notes}"*
5. Send message via Meta Cloud API using `fetch()`.
6. Return status 200 OK with delivery receipt log.

---

## 4. Acceptance Criteria & Automated Verification Checklist

Jules must verify the implementation against the following automated tests:

### Test Suite 1: Webhook Security & Idempotency
- [ ] Valid GET challenge handshake returns 200 with challenge text.
- [ ] Invalid GET challenge handshake returns 403 Forbidden.
- [ ] POST with missing or invalid `X-Hub-Signature-256` returns 403 Forbidden.
- [ ] POST with valid signature returns 200 OK.
- [ ] Sending identical `whatsapp_message_id` twice results in only one database entry.

### Test Suite 2: AI Parser & Database Insertions
- [ ] Text message: *"Need 10 pockets cement for packhouse line 2"* extracts `quantity: 10`, `unit: 'bags'`, `description: 'Cement 50kg Bags'`.
- [ ] Requisition reference code automatically generated as `REQ-YYMM-XXXX`.
- [ ] When status changes to `PO_PLACED`, `po_number` is populated as `PO-1XXXX`.
- [ ] Duplicate check flags a second order for the same item at the same site within 7 days.

### Test Suite 3: RLS Access Isolation
- [ ] Authenticated user from Company A cannot query requisitions belonging to Company B.
- [ ] Public anonymous queries to `requisitions` return empty data.
- [ ] Service role query succeeds across all tables.
