# Requisition Lifecycle & Feature Roadmap

## 1. Feature Specifications

### 1.1 Field Webhook & Voice Parsing
- Accepts standard Meta Cloud API WhatsApp webhooks.
- Validates SHA-256 HMAC signature using `WHATSAPP_APP_SECRET`.
- Downloads voice note binary and transcribes using OpenAI Whisper.
- Uses OpenAI / Groq LLM with Pydantic structured output to extract items, quantities, urgency, and site hints.

### 1.2 Rolling 7-Day Duplicate Detection
- Compares newly logged item descriptions against requisitions created at the same site within the past 7 days (`check_7day_duplicates` PostgreSQL RPC).
- Flags potential duplicates with an amber badge in the Kanban pipeline to prevent double-ordering.

### 1.3 Sage Pastel Partner / Evolution CSV Export
- Generates standard Pastel batch purchase order CSVs.
- Adheres to exact column structure:
  `RecordType,DocumentNumber,Date,SupplierCode,ItemCode,Description,Quantity,UnitPrice,TaxCode`
- Validated via `tools/validate-pastel-csv.py`.

---

## 2. Feature Roadmap

- [x] Phase 1: Repository scaffolding, database schema, Next.js portal, FastAPI ingestion engine, and AI agent framework.
- [ ] Phase 2: Live WhatsApp Business Account webhook verification and media download testing in staging.
- [ ] Phase 3: Fine-tuned South African civil & agricultural domain vocabulary prompt for Whisper audio transcription.
- [ ] Phase 4: Automated multi-quote supplier comparison and RFQ emailing directly from the backoffice portal.
- [ ] Phase 5: Direct bidirectional API integration with Sage Pastel Evolution and Xero accounting systems.
