# ADR-001: Microservice Ingestion with FastAPI and Decoupled Next.js Backoffice

## Status
Accepted

## Context
Field requisitions originate on job sites across Southern Africa (Ceres packhouses, N2 civil roadworks, agricultural estates) via WhatsApp. Audio voice notes and quick text requisitions require real-time ingestion, cryptographic signature verification, voice transcription (Whisper), and structured LLM parsing. Meanwhile, backoffice staff require a responsive real-time Kanban board with Sage Pastel accounting export capabilities.

## Decision
We decouple the field ingestion microservice from the backoffice web application:
1. `services/ingestion` runs Python 3.11+ / FastAPI, leveraging native async capabilities, Pydantic v2 schemas, and official AI SDKs.
2. `apps/web` runs Next.js 14+ (App Router) with `@supabase/ssr` and Tailwind CSS.
3. Supabase (PostgreSQL with Row Level Security) serves as the persistent database and real-time state bus connecting both systems.

## Consequences
- **Positive:**
  - Ingestion workloads (heavy audio payloads and LLM timeouts) do not block or degrade backoffice web responsiveness.
  - Independent container scaling for ingestion under peak morning site requisition spikes.
  - Multi-tenant data isolation enforced uniformly at the PostgreSQL RLS level.
- **Trade-offs:**
  - Requires maintaining two runtimes (Python 3.11 and Node.js 20).
  - Types must be synchronized across Python (Pydantic) and TypeScript via `packages/shared`.
