-- Migration 2: Sequences, Triggers, and Functions
-- Conforms to ADR-0001 and ADR-0003

-- 1. Sequences for Human-Readable Identifiers
CREATE SEQUENCE IF NOT EXISTS requisition_ref_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS po_number_seq START 10001;

-- 2. Trigger Function: Automatically Generate Requisition Reference Code (REQ-YYMM-XXXX)
CREATE OR REPLACE FUNCTION generate_requisition_ref()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.reference_code IS NULL OR TRIM(NEW.reference_code) = '' THEN
        NEW.reference_code := 'REQ-' || TO_CHAR(NOW(), 'YYMM') || '-' || nextval('requisition_ref_seq')::text;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_requisition_ref ON requisitions;
CREATE TRIGGER trg_generate_requisition_ref
    BEFORE INSERT ON requisitions
    FOR EACH ROW
    EXECUTE FUNCTION generate_requisition_ref();

-- 3. Trigger Function: Automatically Assign PO Number upon status transition to PO_PLACED
CREATE OR REPLACE FUNCTION assign_po_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'PO_PLACED' AND (NEW.po_number IS NULL OR TRIM(NEW.po_number) = '') THEN
        NEW.po_number := 'PO-' || nextval('po_number_seq')::text;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_po_number_insert ON requisitions;
CREATE TRIGGER trg_assign_po_number_insert
    BEFORE INSERT ON requisitions
    FOR EACH ROW
    EXECUTE FUNCTION assign_po_number();

DROP TRIGGER IF EXISTS trg_assign_po_number_update ON requisitions;
CREATE TRIGGER trg_assign_po_number_update
    BEFORE UPDATE ON requisitions
    FOR EACH ROW
    EXECUTE FUNCTION assign_po_number();

-- 4. Timestamp Maintenance Function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_companies_updated_at ON companies;
CREATE TRIGGER trg_companies_updated_at
    BEFORE UPDATE ON companies
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_requisitions_updated_at ON requisitions;
CREATE TRIGGER trg_requisitions_updated_at
    BEFORE UPDATE ON requisitions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 5. RPC Function: 7-Day Rolling Duplicate Order Detection
CREATE OR REPLACE FUNCTION check_7day_duplicates(
    p_site_id UUID,
    p_search_tokens TEXT[],
    p_exclude_requisition_id UUID DEFAULT NULL
)
RETURNS TABLE (
    suspect_requisition_id UUID,
    reference_code VARCHAR(32),
    matched_item TEXT,
    created_at TIMESTAMPTZ,
    status requisition_status
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        r.id,
        r.reference_code,
        ri.item_description,
        r.created_at,
        r.status
    FROM requisitions r
    JOIN requisition_items ri ON ri.requisition_id = r.id
    WHERE r.site_id = p_site_id
      AND r.created_at >= (NOW() - INTERVAL '7 days')
      AND r.status != 'CANCELLED'
      AND (p_exclude_requisition_id IS NULL OR r.id != p_exclude_requisition_id)
      AND EXISTS (
          SELECT 1 FROM unnest(p_search_tokens) token
          WHERE ri.item_description ILIKE '%' || token || '%'
      )
    ORDER BY r.created_at DESC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
