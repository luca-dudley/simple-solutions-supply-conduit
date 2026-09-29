# Agent Guidelines & Operational Rules

Welcome to the **Supply Conduit** repository. This document defines the protocol and operating rules for all autonomous AI agents and engineers working in this codebase.

---

## 1. Two-Agent Development Model

The repository operates on a specialized two-agent division of labor:
1. **AGY (Lead Architect & Future Frontend Builder)**:
   - Formulates the master system blueprint, data models, state machines, and interface contracts.
   - Authors Architectural Decision Records in `docs/architecture/decisions/`.
   - Responsible for designing and building the lightweight web portal (`portal/`).
2. **Google Jules (Cloud Backend Engineer)**:
   - Implements and executes cloud backend code directly in GitHub / Supabase.
   - Author of database migrations (`supabase/migrations/`).
   - Implementer of Edge Functions (`supabase/functions/whatsapp-webhook/`, `supabase/functions/notify-field-manager/`).
   - Follows the execution brief specified in `docs/architecture/decisions/0003-jules-backend-brief.md`.

---

## 2. Golden Rules for Agents

1. **Check PROJECT_BRAIN.md First**:
   - Before proposing changes, reading code randomly, or implementing features, inspect [PROJECT_BRAIN.md](file:///home/luca/dev/simple-solutions-supply-conduit/PROJECT_BRAIN.md). It is the single source of truth for repository structure, architecture constraints, and current operational state.

2. **Load Domain Skills**:
   - Reference the appropriate domain skill from `.agents/skills/` before performing work:
     - Planning / Refactoring: `.agents/skills/architecture-planning/SKILL.md`
     - Security / RLS / Secrets: `.agents/skills/data-security/SKILL.md`
     - Ending a Session: `.agents/skills/session-closeout/SKILL.md`

3. **Enforce Boundary Invariants**:
   - Backend logic belongs strictly to Supabase Edge Functions (`supabase/functions/`) or ingestion workers.
   - Never expose `SUPABASE_SERVICE_ROLE_KEY` to client-side code in `portal/`.
   - Root-level scripts must strictly live in `scripts/` or `tools/`.
   - Data contracts and status enums must strictly adhere to `docs/architecture/decisions/0001-database-contracts.md`.

4. **Session Closeout**:
   - Before ending a development session or handing off work, invoke `@closer` (or follow `.agents/skills/session-closeout/SKILL.md`):
     1. Run `./scripts/sync_schema.sh`
     2. Inspect `git diff`
     3. Update Section 6 of `PROJECT_BRAIN.md`
     4. Draft a conventional commit message.

---

## 3. Available Specialized Agents

- **Architect (`.agents/agents/architect/agent.md`)**: Systems design, ADR creation, component mapping, and phased planning.
- **Auditor (`.agents/agents/auditor/agent.md`)**: Security checks, cryptographic signature audit, RLS policy validation, and secret detection.
- **Closer (`.agents/agents/closer/agent.md`)**: Session wrap-up, schema synchronization, diff reviews, and changelog maintenance.
