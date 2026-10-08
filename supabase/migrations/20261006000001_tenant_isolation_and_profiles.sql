-- ============================================================================
-- Migration: 20261006000001_tenant_isolation_and_profiles.sql
-- Description: Multi-tenant user_profiles, company_code onboarding,
--              active requester phone uniqueness, and fail-closed RLS policies.
-- Reference: ADR-0005
-- ============================================================================

-- 1. Extend public.companies with 6-character onboarding code
ALTER TABLE public.companies 
ADD COLUMN IF NOT EXISTS company_code VARCHAR(6);

-- Set default code for Apex Industrial Ops if not already set
UPDATE public.companies 
SET company_code = 'APEX01' 
WHERE id = '00000000-0000-0000-0000-000000000001' AND company_code IS NULL;

-- Populate any other null company codes with generated random 6-character strings
UPDATE public.companies
SET company_code = UPPER(SUBSTRING(MD5(id::text || clock_timestamp()::text) FROM 1 FOR 6))
WHERE company_code IS NULL;

ALTER TABLE public.companies 
ALTER COLUMN company_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_company_code_upper 
ON public.companies (UPPER(company_code));

COMMENT ON COLUMN public.companies.company_code IS 
'Unique 6-character uppercase alphanumeric code used by field requesters for zero-touch farm onboarding.';


-- 2. Create User Role Enum
DO $$ BEGIN
    CREATE TYPE public.user_role AS ENUM ('admin', 'buyer', 'dispatcher', 'viewer');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;


-- 3. Create public.user_profiles (Tenant Membership)
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    role public.user_role DEFAULT 'buyer'::public.user_role NOT NULL,
    phone_number VARCHAR(20),
    is_active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT uq_user_profiles_user UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_company 
ON public.user_profiles(user_id, company_id);

CREATE INDEX IF NOT EXISTS idx_user_profiles_company_id 
ON public.user_profiles(company_id);

-- Attach updated_at trigger
DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_updated_at 
BEFORE UPDATE ON public.user_profiles 
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- 4. Tighten constraints on public.requesters
-- Phone number must be unique among active requesters across the single WhatsApp conduit
CREATE UNIQUE INDEX IF NOT EXISTS uq_requesters_active_phone 
ON public.requesters (phone_number) 
WHERE (is_active = true);

COMMENT ON INDEX public.uq_requesters_active_phone IS 
'Enforces single-tenant phone routing on active field workers across the shared WhatsApp bot number.';


-- 5. Updated Session Context Function (current_user_company_id)
-- Resolves company from user_profiles via auth.uid() with fail-closed security definer
CREATE OR REPLACE FUNCTION public.current_user_company_id() 
RETURNS uuid 
LANGUAGE plpgsql 
STABLE 
SECURITY DEFINER 
SET search_path = public
AS $$
DECLARE
    v_company_id uuid;
BEGIN
    -- 1. Primary: Resolve company from user_profiles table using authenticated UID
    SELECT company_id INTO v_company_id
    FROM public.user_profiles
    WHERE user_id = auth.uid() AND is_active = true
    LIMIT 1;

    IF v_company_id IS NOT NULL THEN
        RETURN v_company_id;
    END IF;

    -- 2. Secondary: Fallback to JWT app_metadata claim if set
    RETURN NULLIF(current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'company_id', '')::uuid;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$;


-- ============================================================================
-- 6. Fail-Closed Row-Level Security Policies
-- Drops all permissive (current_user_company_id() IS NULL OR ...) policies
-- ============================================================================

-- Drop permissive prototype policies
DROP POLICY IF EXISTS "Allow read access to companies" ON public.companies;
DROP POLICY IF EXISTS "Allow modifications to companies" ON public.companies;
DROP POLICY IF EXISTS "companies_tenant_select" ON public.companies;
DROP POLICY IF EXISTS "companies_tenant_update" ON public.companies;

DROP POLICY IF EXISTS "Allow read access to sites" ON public.sites;
DROP POLICY IF EXISTS "Allow modifications to sites" ON public.sites;
DROP POLICY IF EXISTS "sites_tenant_select" ON public.sites;
DROP POLICY IF EXISTS "sites_tenant_modify" ON public.sites;

DROP POLICY IF EXISTS "Allow read access to zones" ON public.zones;
DROP POLICY IF EXISTS "Allow modifications to zones" ON public.zones;
DROP POLICY IF EXISTS "zones_tenant_select" ON public.zones;
DROP POLICY IF EXISTS "zones_tenant_modify" ON public.zones;

DROP POLICY IF EXISTS "Allow read access to requesters" ON public.requesters;
DROP POLICY IF EXISTS "Allow modifications to requesters" ON public.requesters;
DROP POLICY IF EXISTS "requesters_tenant_select" ON public.requesters;
DROP POLICY IF EXISTS "requesters_tenant_modify" ON public.requesters;

DROP POLICY IF EXISTS "Allow read access to requisitions" ON public.requisitions;
DROP POLICY IF EXISTS "Allow modifications to requisitions" ON public.requisitions;
DROP POLICY IF EXISTS "requisitions_tenant_select" ON public.requisitions;
DROP POLICY IF EXISTS "requisitions_tenant_modify" ON public.requisitions;

DROP POLICY IF EXISTS "Allow read access to requisition_items" ON public.requisition_items;
DROP POLICY IF EXISTS "Allow modifications to requisition_items" ON public.requisition_items;
DROP POLICY IF EXISTS "requisition_items_tenant_select" ON public.requisition_items;
DROP POLICY IF EXISTS "requisition_items_tenant_modify" ON public.requisition_items;

DROP POLICY IF EXISTS "user_profiles_select" ON public.user_profiles;
DROP POLICY IF EXISTS "user_profiles_update" ON public.user_profiles;

-- Enable RLS across all relevant tables
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requesters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requisition_items ENABLE ROW LEVEL SECURITY;

-- 6.1 user_profiles Policies
CREATE POLICY "user_profiles_select" ON public.user_profiles
FOR SELECT TO authenticated
USING (
    user_id = auth.uid() 
    OR company_id = public.current_user_company_id()
);

CREATE POLICY "user_profiles_update" ON public.user_profiles
FOR UPDATE TO authenticated
USING (
    user_id = auth.uid() 
    OR (
        company_id = public.current_user_company_id() 
        AND EXISTS (
            SELECT 1 FROM public.user_profiles 
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    )
)
WITH CHECK (
    company_id = public.current_user_company_id()
);

-- 6.2 companies Policies
CREATE POLICY "companies_tenant_select" ON public.companies
FOR SELECT TO authenticated
USING (id = public.current_user_company_id());

CREATE POLICY "companies_tenant_update" ON public.companies
FOR UPDATE TO authenticated
USING (id = public.current_user_company_id())
WITH CHECK (id = public.current_user_company_id());

-- 6.3 sites Policies
CREATE POLICY "sites_tenant_select" ON public.sites
FOR SELECT TO authenticated
USING (company_id = public.current_user_company_id());

CREATE POLICY "sites_tenant_modify" ON public.sites
FOR ALL TO authenticated
USING (company_id = public.current_user_company_id())
WITH CHECK (company_id = public.current_user_company_id());

-- 6.4 zones Policies
CREATE POLICY "zones_tenant_select" ON public.zones
FOR SELECT TO authenticated
USING (site_id IN (
    SELECT id FROM public.sites WHERE company_id = public.current_user_company_id()
));

CREATE POLICY "zones_tenant_modify" ON public.zones
FOR ALL TO authenticated
USING (site_id IN (
    SELECT id FROM public.sites WHERE company_id = public.current_user_company_id()
))
WITH CHECK (site_id IN (
    SELECT id FROM public.sites WHERE company_id = public.current_user_company_id()
));

-- 6.5 requesters Policies
CREATE POLICY "requesters_tenant_select" ON public.requesters
FOR SELECT TO authenticated
USING (company_id = public.current_user_company_id());

CREATE POLICY "requesters_tenant_modify" ON public.requesters
FOR ALL TO authenticated
USING (company_id = public.current_user_company_id())
WITH CHECK (company_id = public.current_user_company_id());

-- 6.6 requisitions Policies
CREATE POLICY "requisitions_tenant_select" ON public.requisitions
FOR SELECT TO authenticated
USING (company_id = public.current_user_company_id());

CREATE POLICY "requisitions_tenant_modify" ON public.requisitions
FOR ALL TO authenticated
USING (company_id = public.current_user_company_id())
WITH CHECK (company_id = public.current_user_company_id());

-- 6.7 requisition_items Policies
CREATE POLICY "requisition_items_tenant_select" ON public.requisition_items
FOR SELECT TO authenticated
USING (requisition_id IN (
    SELECT id FROM public.requisitions WHERE company_id = public.current_user_company_id()
));

CREATE POLICY "requisition_items_tenant_modify" ON public.requisition_items
FOR ALL TO authenticated
USING (requisition_id IN (
    SELECT id FROM public.requisitions WHERE company_id = public.current_user_company_id()
))
WITH CHECK (requisition_id IN (
    SELECT id FROM public.requisitions WHERE company_id = public.current_user_company_id()
));

-- Add user_profiles and requesters to realtime publication if desired
ALTER PUBLICATION supabase_realtime ADD TABLE public.requesters;
