-- Migration: 20261005000001_multi_facility_and_duplicate_tightening.sql
-- Description: Adds location_detail to requisitions, tightens 7-day duplicate detection,
-- updates Luca Dudley contact profile, and clears false duplicate flags.

-- 1. Add granular location detail column to requisitions
ALTER TABLE public.requisitions
  ADD COLUMN IF NOT EXISTS location_detail TEXT;

-- 2. Update 7-Day Rolling Duplicate Detection RPC to filter out generic stop-words
CREATE OR REPLACE FUNCTION public.check_7day_duplicates(
    p_site_id UUID,
    p_search_tokens TEXT[],
    p_exclude_requisition_id UUID DEFAULT NULL
)
RETURNS TABLE (
    suspect_requisition_id UUID,
    reference_code VARCHAR(32),
    matched_item TEXT,
    created_at TIMESTAMPTZ,
    status public.requisition_status
) AS $$
DECLARE
    filtered_tokens TEXT[];
BEGIN
    SELECT ARRAY_AGG(LOWER(TRIM(t))) INTO filtered_tokens
    FROM unnest(p_search_tokens) t
    WHERE LOWER(TRIM(t)) NOT IN (
        'pvc', 'steel', 'plastic', 'fitting', 'joint', 'roll', 'rolls', 'tape',
        'meter', 'meters', 'unit', 'units', 'box', 'boxes', 'bottle', 'bottles',
        'pipe', 'pipes', 'piece', 'pieces', 'size', 'standard', 'heavy', 'duty',
        'and', 'the', 'for', 'with', 'item', 'items', 'bags', 'pack', 'need',
        'urgent', 'urgently', 'please', 'line', 'packhouse', 'cold', 'room',
        'routine', 'spares', 'parts', 'valve', 'valves', 'right', 'angle'
    )
    AND LENGTH(TRIM(t)) >= 4;

    IF filtered_tokens IS NULL OR ARRAY_LENGTH(filtered_tokens, 1) = 0 THEN
        RETURN;
    END IF;

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
          SELECT 1 FROM unnest(filtered_tokens) token
          WHERE ri.item_description ILIKE '%' || token || '%'
      )
    ORDER BY r.created_at DESC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql;

-- 3. Update requester profile for phone +27605468176 to Luca Dudley
UPDATE public.requesters
SET name = 'Luca Dudley'
WHERE phone_number IN ('+27605468176', '27605468176');

-- 4. Clear false duplicate flag on REQ-2610-1015 and set location_detail
UPDATE public.requisitions
SET is_duplicate_suspect = false,
    duplicate_of_id = NULL,
    location_detail = 'Cold Room 2'
WHERE reference_code = 'REQ-2610-1015';
