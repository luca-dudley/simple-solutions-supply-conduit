-- Migration 3: Row Level Security (RLS), Realtime Publication, and Seed Data
-- Conforms to ADR-0001, ADR-0003, and ADR-0004

-- 1. Enable Row Level Security on all core tables
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE requesters ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisition_items ENABLE ROW LEVEL SECURITY;

-- 2. Tenant Context Helper Function
CREATE OR REPLACE FUNCTION current_user_company_id()
RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'company_id', '')::uuid;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- 3. RLS Policies: Multi-Tenant Isolation with Open Permissive Fallback for Authenticated Buyers & Prototyping
-- Permissive read policies for web portal / anon / authenticated buyers
CREATE POLICY "Allow read access to companies" 
    ON companies FOR SELECT 
    USING (
        current_user_company_id() IS NULL OR id = current_user_company_id()
    );

CREATE POLICY "Allow read access to sites" 
    ON sites FOR SELECT 
    USING (
        current_user_company_id() IS NULL OR company_id = current_user_company_id()
    );

CREATE POLICY "Allow read access to zones" 
    ON zones FOR SELECT 
    USING (
        current_user_company_id() IS NULL 
        OR site_id IN (SELECT id FROM sites WHERE company_id = current_user_company_id())
    );

CREATE POLICY "Allow read access to requesters" 
    ON requesters FOR SELECT 
    USING (
        current_user_company_id() IS NULL OR company_id = current_user_company_id()
    );

CREATE POLICY "Allow read access to requisitions" 
    ON requisitions FOR SELECT 
    USING (
        current_user_company_id() IS NULL OR company_id = current_user_company_id()
    );

CREATE POLICY "Allow read access to requisition_items" 
    ON requisition_items FOR SELECT 
    USING (
        current_user_company_id() IS NULL 
        OR requisition_id IN (SELECT id FROM requisitions WHERE company_id = current_user_company_id())
    );

-- Write policies allowing office backoffice operations & edge workers
CREATE POLICY "Allow modifications to requisitions" 
    ON requisitions FOR ALL 
    USING (
        current_user_company_id() IS NULL OR company_id = current_user_company_id()
    ) 
    WITH CHECK (
        current_user_company_id() IS NULL OR company_id = current_user_company_id()
    );

CREATE POLICY "Allow modifications to requisition_items" 
    ON requisition_items FOR ALL 
    USING (
        current_user_company_id() IS NULL 
        OR requisition_id IN (SELECT id FROM requisitions WHERE company_id = current_user_company_id())
    ) 
    WITH CHECK (
        current_user_company_id() IS NULL 
        OR requisition_id IN (SELECT id FROM requisitions WHERE company_id = current_user_company_id())
    );

CREATE POLICY "Allow modifications to requesters" 
    ON requesters FOR ALL 
    USING (
        current_user_company_id() IS NULL OR company_id = current_user_company_id()
    ) 
    WITH CHECK (
        current_user_company_id() IS NULL OR company_id = current_user_company_id()
    );

CREATE POLICY "Allow modifications to sites" 
    ON sites FOR ALL 
    USING (
        current_user_company_id() IS NULL OR company_id = current_user_company_id()
    ) 
    WITH CHECK (
        current_user_company_id() IS NULL OR company_id = current_user_company_id()
    );

CREATE POLICY "Allow modifications to zones" 
    ON zones FOR ALL 
    USING (
        current_user_company_id() IS NULL 
        OR site_id IN (SELECT id FROM sites WHERE company_id = current_user_company_id())
    ) 
    WITH CHECK (
        current_user_company_id() IS NULL 
        OR site_id IN (SELECT id FROM sites WHERE company_id = current_user_company_id())
    );

CREATE POLICY "Allow modifications to companies" 
    ON companies FOR ALL 
    USING (
        current_user_company_id() IS NULL OR id = current_user_company_id()
    ) 
    WITH CHECK (
        current_user_company_id() IS NULL OR id = current_user_company_id()
    );

-- 4. Enable Supabase Realtime for Backoffice Live Pipeline Updates
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'requisitions'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE requisitions;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'requisition_items'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE requisition_items;
    END IF;
END $$;

ALTER TABLE requisitions REPLICA IDENTITY FULL;
ALTER TABLE requisition_items REPLICA IDENTITY FULL;

-- 5. Seed Data for Immediate Backoffice UI Verification
INSERT INTO companies (id, name, slug, currency, timezone, settings)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Apex Industrial Ops',
    'apex-industrial-ops',
    'ZAR',
    'Africa/Johannesburg',
    '{"duplicate_window_days": 7, "require_zone": false}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO sites (id, company_id, name, code, location_description, is_active)
VALUES (
    '00000000-0000-0000-0000-000000000010',
    '00000000-0000-0000-0000-000000000001',
    'Ceres Packhouse Main',
    'CERES-MAIN',
    'R46 Regional Road, Ceres Valley, Western Cape',
    true
)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO zones (id, site_id, name, code, is_active)
VALUES (
    '00000000-0000-0000-0000-000000000020',
    '00000000-0000-0000-0000-000000000010',
    'Cold Room 2',
    'CR-02',
    true
)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO requesters (id, company_id, phone_number, name, role_title, default_site_id, is_active)
VALUES (
    '00000000-0000-0000-0000-000000000030',
    '00000000-0000-0000-0000-000000000001',
    '+27821234567',
    'Braam van der Merwe',
    'Site Agent & Mechanical Foreman',
    '00000000-0000-0000-0000-000000000010',
    true
)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Mock Requisition 2 (Pre-existing PENDING_QUOTE order)
INSERT INTO requisitions (
    id,
    company_id,
    reference_code,
    site_id,
    zone_id,
    requester_id,
    status,
    urgency,
    raw_message_text,
    supplier_name,
    total_estimated_zar,
    notes,
    created_at
)
VALUES (
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000001',
    'REQ-2610-1002',
    '00000000-0000-0000-0000-000000000010',
    '00000000-0000-0000-0000-000000000020',
    '00000000-0000-0000-0000-000000000030',
    'PENDING_QUOTE',
    'ROUTINE',
    'Routine spares for packhouse conveyor: 4x V-Belt B68 and 5x Lithium EP2 Grease cartridges for weekly service.',
    'Agri Industrial Supplies Ceres',
    2125.00,
    'Sourcing 3 competitive quotes from local Boland distributors.',
    timezone('utc'::text, now() - INTERVAL '2 hours')
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO requisition_items (
    id,
    requisition_id,
    item_description,
    normalized_tokens,
    quantity,
    unit_of_measure,
    part_number,
    pastel_item_code,
    unit_price_zar
)
VALUES
    (
        '00000000-0000-0000-0000-000000000203',
        '00000000-0000-0000-0000-000000000102',
        'V-Belt B68 Heavy Duty Industrial',
        'v-belt b68 heavy duty industrial',
        4.00,
        'units',
        'B68-HD',
        'BLT-IND-B68',
        225.00
    ),
    (
        '00000000-0000-0000-0000-000000000204',
        '00000000-0000-0000-0000-000000000102',
        'Lithium EP2 Grease Cartridge 400g',
        'lithium ep2 grease cartridge 400g',
        5.00,
        'cartridges',
        'EP2-400G',
        'LUB-GRS-EP2',
        245.00
    )
ON CONFLICT (id) DO NOTHING;

-- Mock Requisition 1 (LOGGED order, urgent breakdown, duplicate suspect of prior line)
INSERT INTO requisitions (
    id,
    company_id,
    reference_code,
    site_id,
    zone_id,
    requester_id,
    status,
    urgency,
    raw_message_text,
    is_duplicate_suspect,
    duplicate_of_id,
    total_estimated_zar,
    notes,
    created_at
)
VALUES (
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000001',
    'REQ-2610-1001',
    '00000000-0000-0000-0000-000000000010',
    '00000000-0000-0000-0000-000000000020',
    '00000000-0000-0000-0000-000000000030',
    'LOGGED',
    'CRITICAL_BREAKDOWN',
    'Urgently need 2x 50mm PVC ball valves and pressure gauge 0-10 bar for Cold Room 2 ammonia line leak.',
    true,
    '00000000-0000-0000-0000-000000000102',
    1450.00,
    'Flagged as duplicate suspect due to overlapping items requested for Cold Room 2 within 7-day window.',
    timezone('utc'::text, now() - INTERVAL '15 minutes')
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO requisition_items (
    id,
    requisition_id,
    item_description,
    normalized_tokens,
    quantity,
    unit_of_measure,
    part_number,
    pastel_item_code,
    unit_price_zar
)
VALUES
    (
        '00000000-0000-0000-0000-000000000201',
        '00000000-0000-0000-0000-000000000101',
        '50mm PVC Ball Valve Schedule 80',
        '50mm pvc ball valve schedule 80',
        2.00,
        'units',
        'BV-PVC-050',
        'VLV-PVC-050',
        450.00
    ),
    (
        '00000000-0000-0000-0000-000000000202',
        '00000000-0000-0000-0000-000000000101',
        'Pressure Gauge 0-10 Bar Bottom Entry',
        'pressure gauge 0-10 bar bottom entry',
        1.00,
        'units',
        'PG-010-BE',
        'GAU-PRS-010',
        550.00
    )
ON CONFLICT (id) DO NOTHING;
