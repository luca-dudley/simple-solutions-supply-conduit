# Supabase Database Schema (Migration Fallback)

> Consolidated from migration files in `packages/supabase/migrations/`.
> Generated at: 2026-09-29T12:46:34Z


## 00001_initial_schema.sql
```sql
-- ============================================================================
-- 00001_initial_schema.sql
-- Core entities: Companies, Sites, Zones, Requesters, Requisitions, Items
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums
CREATE TYPE requisition_status AS ENUM (
    'LOGGED',
    'PENDING_QUOTE',
    'PO_PLACED',
    'DELIVERED_TO_SITE',
    'CLOSED'
);

CREATE TYPE urgency_level AS ENUM (
    'ROUTINE',
    'URGENT',
    'CRITICAL_BREAKDOWN'
);

-- Companies (Tenants)
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Sites (Job sites, civil engineering contracts, packhouses, agricultural estates)
CREATE TABLE sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    location_description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE(company_id, code)
);

-- Zones (Specific operational quadrants, e.g. Packhouse Line 3, Workshop, Pump Station B)
CREATE TABLE zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Requesters (Site agents, foremen, mechanics sending WhatsApp voice/text notes)
CREATE TABLE requesters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    phone_number TEXT NOT NULL,
    name TEXT NOT NULL,
    role_title TEXT,
    default_site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE(company_id, phone_number)
);

-- Requisitions (Master procurement header record)
CREATE TABLE requisitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    reference_code TEXT NOT NULL,
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
    zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
    requester_id UUID NOT NULL REFERENCES requesters(id) ON DELETE RESTRICT,
    raw_message_text TEXT,
    audio_url TEXT,
    media_urls TEXT[] DEFAULT '{}',
    status requisition_status NOT NULL DEFAULT 'LOGGED',
    urgency urgency_level NOT NULL DEFAULT 'ROUTINE',
    is_duplicate_suspect BOOLEAN NOT NULL DEFAULT false,
    duplicate_of_id UUID REFERENCES requisitions(id) ON DELETE SET NULL,
    assigned_buyer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    po_number TEXT,
    supplier_name TEXT,
    total_estimated_zar NUMERIC(12, 2) DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Requisition Items (Extracted line items)
CREATE TABLE requisition_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requisition_id UUID NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
    item_description TEXT NOT NULL,
    quantity NUMERIC(10, 2) NOT NULL DEFAULT 1.0,
    unit_of_measure TEXT NOT NULL DEFAULT 'units',
    part_number TEXT,
    notes TEXT,
    pastel_item_code TEXT,
    unit_price_zar NUMERIC(12, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

```

## 00002_indexes_and_rules.sql
```sql
-- ============================================================================
-- 00002_indexes_and_rules.sql
-- Indexes, reference generator sequence, and 7-day duplicate detection engine
-- ============================================================================

-- Fast lookup indexes
CREATE INDEX idx_requisitions_company_status ON requisitions(company_id, status);
CREATE INDEX idx_requisitions_created_at ON requisitions(created_at DESC);
CREATE INDEX idx_requisitions_site_id ON requisitions(site_id);
CREATE INDEX idx_requisition_items_req_id ON requisition_items(requisition_id);
CREATE INDEX idx_requesters_phone ON requesters(phone_number);

-- Sequence for human-readable requisition codes: REQ-2409-0001
CREATE SEQUENCE IF NOT EXISTS requisition_ref_seq START 1001;

CREATE OR REPLACE FUNCTION generate_requisition_ref()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.reference_code IS NULL OR NEW.reference_code = '' THEN
        NEW.reference_code := 'REQ-' || to_char(NOW(), 'YYMM') || '-' || LPAD(nextval('requisition_ref_seq')::text, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_generate_requisition_ref
BEFORE INSERT ON requisitions
FOR EACH ROW
EXECUTE FUNCTION generate_requisition_ref();

-- Rolling 7-day duplicate detection function
-- Searches for similar item descriptions from the same site logged in the past 7 days
CREATE OR REPLACE FUNCTION check_7day_duplicates(
    p_site_id UUID,
    p_search_text TEXT,
    p_exclude_requisition_id UUID DEFAULT NULL
)
RETURNS TABLE (
    suspect_requisition_id UUID,
    reference_code TEXT,
    matched_item TEXT,
    created_at TIMESTAMPTZ,
    status requisition_status
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        r.id AS suspect_requisition_id,
        r.reference_code,
        ri.item_description AS matched_item,
        r.created_at,
        r.status
    FROM requisitions r
    JOIN requisition_items ri ON ri.requisition_id = r.id
    WHERE r.site_id = p_site_id
      AND r.created_at >= (NOW() - INTERVAL '7 days')
      AND (p_exclude_requisition_id IS NULL OR r.id != p_exclude_requisition_id)
      AND (
          ri.item_description ILIKE '%' || p_search_text || '%'
          OR p_search_text ILIKE '%' || ri.item_description || '%'
      )
    ORDER BY r.created_at DESC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

```

## 00003_rls_policies.sql
```sql
-- ============================================================================
-- 00003_rls_policies.sql
-- Multi-tenant Row-Level Security policies
-- ============================================================================

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE requesters ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisition_items ENABLE ROW LEVEL SECURITY;

-- Helper to extract user company claim or fall back to single-tenant prototype header
CREATE OR REPLACE FUNCTION current_user_company_id()
RETURNS UUID AS $$
BEGIN
    RETURN COALESCE(
        (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'company_id')::UUID,
        '00000000-0000-0000-0000-000000000001'::UUID
    );
EXCEPTION WHEN OTHERS THEN
    RETURN '00000000-0000-0000-0000-000000000001'::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- Service role bypasses all RLS automatically, while authenticated web users use tenant filter
CREATE POLICY "Companies tenant isolation" ON companies
    FOR ALL USING (id = current_user_company_id());

CREATE POLICY "Sites tenant isolation" ON sites
    FOR ALL USING (company_id = current_user_company_id());

CREATE POLICY "Zones tenant isolation" ON zones
    FOR ALL USING (site_id IN (SELECT id FROM sites WHERE company_id = current_user_company_id()));

CREATE POLICY "Requesters tenant isolation" ON requesters
    FOR ALL USING (company_id = current_user_company_id());

CREATE POLICY "Requisitions tenant isolation" ON requisitions
    FOR ALL USING (company_id = current_user_company_id());

CREATE POLICY "Requisition items tenant isolation" ON requisition_items
    FOR ALL USING (requisition_id IN (
        SELECT id FROM requisitions WHERE company_id = current_user_company_id()
    ));

```
