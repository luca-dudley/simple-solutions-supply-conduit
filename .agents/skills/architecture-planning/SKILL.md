---
name: architecture-planning
description: Conventions for ADR numbering, component diagrams, architectural boundaries, and interface declarations.
---

# Architecture Planning Skill

## 1. Architectural Decision Records (ADRs)
All fundamental architectural choices, third-party provider additions, schema refactors, or communication patterns must be captured as an ADR under `docs/architecture/decisions/`.

### File Naming Convention
`ADR-<3-digit-number>-<slug>.md` (e.g., `ADR-001-meta-cloud-api-webhook-ingestion.md`).

### ADR Template Format
```markdown
# ADR-00X: [Title]

## Status
[Proposed | Accepted | Superseded | Deprecated]

## Context
What problem are we solving? What are the field-specific operational constraints (e.g. low bandwidth in rural Ceres, rough audio conditions on site, Sage Pastel format peculiarities)?

## Decision
What is the proposed technical solution, package, or architecture pattern?

## Consequences
- **Positive:** Benefits, developer ergonomics, throughput gains.
- **Negative / Trade-offs:** Operational complexity, cold start latency, billing impacts.
```

---

## 2. Component & Interface Conventions
1. **Shared Package Boundary (`packages/shared`)**:
   - Enums and status types must be defined first in `packages/shared/src/constants/`.
   - Never duplicate status strings across frontend and backend.
2. **FastAPI Microservice (`services/ingestion`)**:
   - All I/O models must use Pydantic v2.
   - Long-running audio and LLM calls must run as background tasks or async jobs.
3. **Next.js Backoffice Portal (`apps/web`)**:
   - Use Next.js App Router server components where data is static/read-only.
   - Use Client Components for real-time Kanban boards and interactive modals.
