-- Migration 1: Core Relational Entities & Enums
-- Conforms to ADR-0001 and ADR-0003

-- 1. Enable Required PostgreSQL Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 2. Define Enum Types
DO $$ BEGIN
    CREATE TYPE requisition_status AS ENUM (
        'LOGGED',
        'PENDING_QUOTE',
        'PO_PLACED',
        'DELIVERED_TO_SITE',
        'CLOSED',
        'CANCELLED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE urgency_level AS ENUM (
        'ROUTINE',
        'URGENT',
        'CRITICAL_BREAKDOWN'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. Companies Table (Tenant Boundary)
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    currency VARCHAR(3) NOT NULL DEFAULT 'ZAR',
    timezone TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
    settings JSONB NOT NULL DEFAULT '{"duplicate_window_days": 7, "require_zone": false}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4. Sites Table (Operational Facilities)
CREATE TABLE IF NOT EXISTS sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code VARCHAR(20) NOT NULL,
    location_description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_sites_company_code UNIQUE (company_id, code)
);

-- 5. Zones Table (Operational Sub-Quadrants)
CREATE TABLE IF NOT EXISTS zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code VARCHAR(20),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_zones_site_name UNIQUE (site_id, name)
);

-- 6. Requesters Table (Authorized Field Workers)
CREATE TABLE IF NOT EXISTS requesters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    phone_number VARCHAR(20) NOT NULL,
    name TEXT NOT NULL,
    role_title TEXT,
    default_site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_requesters_company_phone UNIQUE (company_id, phone_number)
);

-- 7. Requisitions Table (Master Header Record)
CREATE TABLE IF NOT EXISTS requisitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    reference_code VARCHAR(32) NOT NULL UNIQUE,
    po_number VARCHAR(32) UNIQUE,
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
    zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
    requester_id UUID NOT NULL REFERENCES requesters(id) ON DELETE RESTRICT,
    status requisition_status NOT NULL DEFAULT 'LOGGED',
    urgency urgency_level NOT NULL DEFAULT 'ROUTINE',
    raw_message_text TEXT,
    audio_url TEXT,
    media_urls TEXT[] NOT NULL DEFAULT '{}',
    whatsapp_message_id VARCHAR(128) UNIQUE,
    is_duplicate_suspect BOOLEAN NOT NULL DEFAULT false,
    duplicate_of_id UUID REFERENCES requisitions(id) ON DELETE SET NULL,
    assigned_buyer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    supplier_name TEXT,
    total_estimated_zar NUMERIC(12, 2) DEFAULT 0.00,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 8. Requisition Items Table (Extracted Line Items)
CREATE TABLE IF NOT EXISTS requisition_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requisition_id UUID NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
    item_description TEXT NOT NULL,
    normalized_tokens TEXT,
    quantity NUMERIC(10, 2) NOT NULL DEFAULT 1.0,
    unit_of_measure VARCHAR(30) NOT NULL DEFAULT 'units',
    part_number VARCHAR(100),
    notes TEXT,
    pastel_item_code VARCHAR(50),
    unit_price_zar NUMERIC(12, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 9. Performance & Trigram Search Indexes
CREATE INDEX IF NOT EXISTS idx_requisitions_company_id ON requisitions(company_id);
CREATE INDEX IF NOT EXISTS idx_requisitions_site_id ON requisitions(site_id);
CREATE INDEX IF NOT EXISTS idx_requisitions_status ON requisitions(status);
CREATE INDEX IF NOT EXISTS idx_requisitions_created_at ON requisitions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requisitions_duplicate_suspect ON requisitions(is_duplicate_suspect) WHERE is_duplicate_suspect = true;
CREATE INDEX IF NOT EXISTS idx_requisition_items_requisition_id ON requisition_items(requisition_id);

-- Trigram GIN index for fast fuzzy searching across line items (duplicate detection)
CREATE INDEX IF NOT EXISTS idx_requisition_items_description_trgm 
    ON requisition_items USING gin (item_description gin_trgm_ops);
