# Live Supabase Schema Manifest
> **Last Synchronized:** 2026-10-08 11:19:22 UTC
> **Source:** Remote Supabase Instance via pg_dump (Direct Connection)

---

## 1. Relational Database Schema & Policies (DDL)

```sql
--
-- PostgreSQL database dump
--

\restrict nZfbCWlm4mhcH8uFb29l6mT6FGagxJMECKAP0wKZRV7w6XeCFklXXSsrjYOgjKW

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11 (Ubuntu 17.11-1.pgdg24.04+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: requisition_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.requisition_status AS ENUM (
    'LOGGED',
    'PENDING_QUOTE',
    'PO_PLACED',
    'DELIVERED_TO_SITE',
    'CLOSED',
    'CANCELLED'
);


--
-- Name: urgency_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.urgency_level AS ENUM (
    'ROUTINE',
    'URGENT',
    'CRITICAL_BREAKDOWN'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'admin',
    'buyer',
    'dispatcher',
    'viewer'
);


--
-- Name: assign_po_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_po_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.status = 'PO_PLACED' AND (NEW.po_number IS NULL OR TRIM(NEW.po_number) = '') THEN
        NEW.po_number := 'PO-' || nextval('po_number_seq')::text;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: check_7day_duplicates(uuid, text[], uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_7day_duplicates(p_site_id uuid, p_search_tokens text[], p_exclude_requisition_id uuid DEFAULT NULL::uuid) RETURNS TABLE(suspect_requisition_id uuid, reference_code character varying, matched_item text, created_at timestamp with time zone, status public.requisition_status)
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: current_user_company_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_company_id() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: generate_requisition_ref(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_requisition_ref() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.reference_code IS NULL OR TRIM(NEW.reference_code) = '' THEN
        NEW.reference_code := 'REQ-' || TO_CHAR(NOW(), 'YYMM') || '-' || nextval('requisition_ref_seq')::text;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    currency character varying(3) DEFAULT 'ZAR'::character varying NOT NULL,
    timezone text DEFAULT 'Africa/Johannesburg'::text NOT NULL,
    settings jsonb DEFAULT '{"require_zone": false, "duplicate_window_days": 7}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    company_code character varying(6) NOT NULL
);


--
-- Name: COLUMN companies.company_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.company_code IS 'Unique 6-character uppercase alphanumeric code used by field requesters for zero-touch farm onboarding.';


--
-- Name: po_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.po_number_seq
    START WITH 10001
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: requesters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.requesters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    phone_number character varying(20) NOT NULL,
    name text NOT NULL,
    role_title text,
    default_site_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: requisition_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.requisition_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    requisition_id uuid NOT NULL,
    item_description text NOT NULL,
    normalized_tokens text,
    quantity numeric(10,2) DEFAULT 1.0 NOT NULL,
    unit_of_measure character varying(30) DEFAULT 'units'::character varying NOT NULL,
    part_number character varying(100),
    notes text,
    pastel_item_code character varying(50),
    unit_price_zar numeric(12,2),
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE ONLY public.requisition_items REPLICA IDENTITY FULL;


--
-- Name: requisition_ref_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.requisition_ref_seq
    START WITH 1001
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: requisitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.requisitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    reference_code character varying(32) NOT NULL,
    po_number character varying(32),
    site_id uuid NOT NULL,
    zone_id uuid,
    requester_id uuid NOT NULL,
    status public.requisition_status DEFAULT 'LOGGED'::public.requisition_status NOT NULL,
    urgency public.urgency_level DEFAULT 'ROUTINE'::public.urgency_level NOT NULL,
    raw_message_text text,
    audio_url text,
    media_urls text[] DEFAULT '{}'::text[] NOT NULL,
    whatsapp_message_id character varying(128),
    is_duplicate_suspect boolean DEFAULT false NOT NULL,
    duplicate_of_id uuid,
    assigned_buyer_id uuid,
    supplier_name text,
    total_estimated_zar numeric(12,2) DEFAULT 0.00,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    location_detail text
);

ALTER TABLE ONLY public.requisitions REPLICA IDENTITY FULL;


--
-- Name: sites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    name text NOT NULL,
    code character varying(20) NOT NULL,
    location_description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: user_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    company_id uuid NOT NULL,
    full_name text NOT NULL,
    role public.user_role DEFAULT 'buyer'::public.user_role NOT NULL,
    phone_number character varying(20),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    site_id uuid NOT NULL,
    name text NOT NULL,
    code character varying(20),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: companies companies_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_slug_key UNIQUE (slug);


--
-- Name: requesters requesters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requesters
    ADD CONSTRAINT requesters_pkey PRIMARY KEY (id);


--
-- Name: requisition_items requisition_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requisition_items
    ADD CONSTRAINT requisition_items_pkey PRIMARY KEY (id);


--
-- Name: requisitions requisitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requisitions
    ADD CONSTRAINT requisitions_pkey PRIMARY KEY (id);


--
-- Name: requisitions requisitions_po_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requisitions
    ADD CONSTRAINT requisitions_po_number_key UNIQUE (po_number);


--
-- Name: requisitions requisitions_reference_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requisitions
    ADD CONSTRAINT requisitions_reference_code_key UNIQUE (reference_code);


--
-- Name: requisitions requisitions_whatsapp_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requisitions
    ADD CONSTRAINT requisitions_whatsapp_message_id_key UNIQUE (whatsapp_message_id);


--
-- Name: sites sites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_pkey PRIMARY KEY (id);


--
-- Name: requesters uq_requesters_company_phone; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requesters
    ADD CONSTRAINT uq_requesters_company_phone UNIQUE (company_id, phone_number);


--
-- Name: sites uq_sites_company_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT uq_sites_company_code UNIQUE (company_id, code);


--
-- Name: user_profiles uq_user_profiles_user; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT uq_user_profiles_user UNIQUE (user_id);


--
-- Name: zones uq_zones_site_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zones
    ADD CONSTRAINT uq_zones_site_name UNIQUE (site_id, name);


--
-- Name: user_profiles user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (id);


--
-- Name: zones zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zones
    ADD CONSTRAINT zones_pkey PRIMARY KEY (id);


--
-- Name: idx_companies_company_code_upper; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_companies_company_code_upper ON public.companies USING btree (upper((company_code)::text));


--
-- Name: idx_requisition_items_description_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_requisition_items_description_trgm ON public.requisition_items USING gin (item_description public.gin_trgm_ops);


--
-- Name: idx_requisition_items_requisition_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_requisition_items_requisition_id ON public.requisition_items USING btree (requisition_id);


--
-- Name: idx_requisitions_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_requisitions_company_id ON public.requisitions USING btree (company_id);


--
-- Name: idx_requisitions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_requisitions_created_at ON public.requisitions USING btree (created_at DESC);


--
-- Name: idx_requisitions_duplicate_suspect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_requisitions_duplicate_suspect ON public.requisitions USING btree (is_duplicate_suspect) WHERE (is_duplicate_suspect = true);


--
-- Name: idx_requisitions_site_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_requisitions_site_id ON public.requisitions USING btree (site_id);


--
-- Name: idx_requisitions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_requisitions_status ON public.requisitions USING btree (status);


--
-- Name: idx_user_profiles_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_profiles_company_id ON public.user_profiles USING btree (company_id);


--
-- Name: idx_user_profiles_user_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_profiles_user_company ON public.user_profiles USING btree (user_id, company_id);


--
-- Name: uq_requesters_active_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_requesters_active_phone ON public.requesters USING btree (phone_number) WHERE (is_active = true);


--
-- Name: INDEX uq_requesters_active_phone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.uq_requesters_active_phone IS 'Enforces single-tenant phone routing on active field workers across the shared WhatsApp bot number.';


--
-- Name: requisitions trg_assign_po_number_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_po_number_insert BEFORE INSERT ON public.requisitions FOR EACH ROW EXECUTE FUNCTION public.assign_po_number();


--
-- Name: requisitions trg_assign_po_number_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_po_number_update BEFORE UPDATE ON public.requisitions FOR EACH ROW EXECUTE FUNCTION public.assign_po_number();


--
-- Name: companies trg_companies_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: requisitions trg_generate_requisition_ref; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_generate_requisition_ref BEFORE INSERT ON public.requisitions FOR EACH ROW EXECUTE FUNCTION public.generate_requisition_ref();


--
-- Name: requisitions trg_requisitions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_requisitions_updated_at BEFORE UPDATE ON public.requisitions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_profiles trg_user_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_user_profiles_updated_at BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: requesters requesters_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requesters
    ADD CONSTRAINT requesters_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: requesters requesters_default_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requesters
    ADD CONSTRAINT requesters_default_site_id_fkey FOREIGN KEY (default_site_id) REFERENCES public.sites(id) ON DELETE SET NULL;


--
-- Name: requisition_items requisition_items_requisition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requisition_items
    ADD CONSTRAINT requisition_items_requisition_id_fkey FOREIGN KEY (requisition_id) REFERENCES public.requisitions(id) ON DELETE CASCADE;


--
-- Name: requisitions requisitions_assigned_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requisitions
    ADD CONSTRAINT requisitions_assigned_buyer_id_fkey FOREIGN KEY (assigned_buyer_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: requisitions requisitions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requisitions
    ADD CONSTRAINT requisitions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: requisitions requisitions_duplicate_of_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requisitions
    ADD CONSTRAINT requisitions_duplicate_of_id_fkey FOREIGN KEY (duplicate_of_id) REFERENCES public.requisitions(id) ON DELETE SET NULL;


--
-- Name: requisitions requisitions_requester_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requisitions
    ADD CONSTRAINT requisitions_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.requesters(id) ON DELETE RESTRICT;


--
-- Name: requisitions requisitions_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requisitions
    ADD CONSTRAINT requisitions_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;


--
-- Name: requisitions requisitions_zone_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requisitions
    ADD CONSTRAINT requisitions_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES public.zones(id) ON DELETE SET NULL;


--
-- Name: sites sites_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: user_profiles user_profiles_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: user_profiles user_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: zones zones_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zones
    ADD CONSTRAINT zones_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE;


--
-- Name: companies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

--
-- Name: companies companies_tenant_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY companies_tenant_select ON public.companies FOR SELECT TO authenticated USING ((id = public.current_user_company_id()));


--
-- Name: companies companies_tenant_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY companies_tenant_update ON public.companies FOR UPDATE TO authenticated USING ((id = public.current_user_company_id())) WITH CHECK ((id = public.current_user_company_id()));


--
-- Name: requesters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.requesters ENABLE ROW LEVEL SECURITY;

--
-- Name: requesters requesters_tenant_modify; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY requesters_tenant_modify ON public.requesters TO authenticated USING ((company_id = public.current_user_company_id())) WITH CHECK ((company_id = public.current_user_company_id()));


--
-- Name: requesters requesters_tenant_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY requesters_tenant_select ON public.requesters FOR SELECT TO authenticated USING ((company_id = public.current_user_company_id()));


--
-- Name: requisition_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.requisition_items ENABLE ROW LEVEL SECURITY;

--
-- Name: requisition_items requisition_items_tenant_modify; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY requisition_items_tenant_modify ON public.requisition_items TO authenticated USING ((requisition_id IN ( SELECT requisitions.id
   FROM public.requisitions
  WHERE (requisitions.company_id = public.current_user_company_id())))) WITH CHECK ((requisition_id IN ( SELECT requisitions.id
   FROM public.requisitions
  WHERE (requisitions.company_id = public.current_user_company_id()))));


--
-- Name: requisition_items requisition_items_tenant_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY requisition_items_tenant_select ON public.requisition_items FOR SELECT TO authenticated USING ((requisition_id IN ( SELECT requisitions.id
   FROM public.requisitions
  WHERE (requisitions.company_id = public.current_user_company_id()))));


--
-- Name: requisitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.requisitions ENABLE ROW LEVEL SECURITY;

--
-- Name: requisitions requisitions_tenant_modify; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY requisitions_tenant_modify ON public.requisitions TO authenticated USING ((company_id = public.current_user_company_id())) WITH CHECK ((company_id = public.current_user_company_id()));


--
-- Name: requisitions requisitions_tenant_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY requisitions_tenant_select ON public.requisitions FOR SELECT TO authenticated USING ((company_id = public.current_user_company_id()));


--
-- Name: sites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;

--
-- Name: sites sites_tenant_modify; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sites_tenant_modify ON public.sites TO authenticated USING ((company_id = public.current_user_company_id())) WITH CHECK ((company_id = public.current_user_company_id()));


--
-- Name: sites sites_tenant_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sites_tenant_select ON public.sites FOR SELECT TO authenticated USING ((company_id = public.current_user_company_id()));


--
-- Name: user_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_profiles user_profiles_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_profiles_select ON public.user_profiles FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (company_id = public.current_user_company_id())));


--
-- Name: user_profiles user_profiles_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_profiles_update ON public.user_profiles FOR UPDATE TO authenticated USING (((user_id = auth.uid()) OR ((company_id = public.current_user_company_id()) AND (EXISTS ( SELECT 1
   FROM public.user_profiles user_profiles_1
  WHERE ((user_profiles_1.user_id = auth.uid()) AND (user_profiles_1.role = 'admin'::public.user_role))))))) WITH CHECK ((company_id = public.current_user_company_id()));


--
-- Name: zones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.zones ENABLE ROW LEVEL SECURITY;

--
-- Name: zones zones_tenant_modify; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY zones_tenant_modify ON public.zones TO authenticated USING ((site_id IN ( SELECT sites.id
   FROM public.sites
  WHERE (sites.company_id = public.current_user_company_id())))) WITH CHECK ((site_id IN ( SELECT sites.id
   FROM public.sites
  WHERE (sites.company_id = public.current_user_company_id()))));


--
-- Name: zones zones_tenant_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY zones_tenant_select ON public.zones FOR SELECT TO authenticated USING ((site_id IN ( SELECT sites.id
   FROM public.sites
  WHERE (sites.company_id = public.current_user_company_id()))));


--
-- PostgreSQL database dump complete
--

\unrestrict nZfbCWlm4mhcH8uFb29l6mT6FGagxJMECKAP0wKZRV7w6XeCFklXXSsrjYOgjKW

```
