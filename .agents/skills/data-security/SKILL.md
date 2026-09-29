---
name: data-security
description: Hardening checklists, multi-tenant data isolation, secret management, and webhook cryptographic validation.
---

# Data Security & Compliance Skill

## 1. Multi-Tenant Data Isolation (Row-Level Security)
Every PostgreSQL table containing client or operational data must have RLS enabled:
- `companies`, `sites`, `zones`, `requesters`, `requisitions`, `requisition_items`.
- Policies must verify `company_id = current_user_company_id()`.
- Service Role keys must only be used by backend workers (`services/ingestion`) and edge functions, **never** bundled in frontend bundles.

---

## 2. Webhook Cryptographic Validation
- All inbound Meta Cloud API payloads must pass HMAC-SHA256 signature verification (`X-Hub-Signature-256`) against `WHATSAPP_APP_SECRET`.
- Endpoints must reject mismatched signatures with HTTP `403 Forbidden` prior to executing downstream JSON parsing or LLM workloads.

---

## 3. Secret Management & Storage
- No credentials or `.env` files should ever be tracked in Git.
- Ensure all API keys (`WHATSAPP_API_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `LLM_API_KEY`) are fetched via environment variables or Supabase secrets vault.
- S3 / Supabase Storage buckets storing part photos and voice note recordings must restrict write access to authenticated site requesters or ingestion workers.

---

## 4. Input Sanitation & Export Safety
- When generating Sage Pastel CSV files (`apps/web/src/lib/exporters/pastel.ts`), sanitize string cells starting with `=`, `+`, `-`, or `@` to neutralize CSV formula injection attacks in Microsoft Excel.
