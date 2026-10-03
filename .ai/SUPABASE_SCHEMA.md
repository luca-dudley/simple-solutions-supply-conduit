# Live Supabase Schema Manifest
> **Last Synchronized:** 2026-10-03 07:46:11 UTC
> **Source:** Remote Supabase Instance via pg_dump (Direct Connection)

---

## 1. Relational Database Schema & Policies (DDL)

```sql
--
-- PostgreSQL database dump
--

\restrict 1jqksKjjckCkJTL3CShAUhbbeNrpPfdeUAupSPilGb0k46S4xTJCzAtHf19Xb23

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
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
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
$$;


--
-- Name: current_user_company_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_company_id() RETURNS uuid
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
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
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


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
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
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
-- Name: zones uq_zones_site_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zones
    ADD CONSTRAINT uq_zones_site_name UNIQUE (site_id, name);


--
-- Name: zones zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zones
    ADD CONSTRAINT zones_pkey PRIMARY KEY (id);


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
-- Name: zones zones_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zones
    ADD CONSTRAINT zones_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE;


--
-- Name: companies Allow modifications to companies; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow modifications to companies" ON public.companies USING (((public.current_user_company_id() IS NULL) OR (id = public.current_user_company_id()))) WITH CHECK (((public.current_user_company_id() IS NULL) OR (id = public.current_user_company_id())));


--
-- Name: requesters Allow modifications to requesters; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow modifications to requesters" ON public.requesters USING (((public.current_user_company_id() IS NULL) OR (company_id = public.current_user_company_id()))) WITH CHECK (((public.current_user_company_id() IS NULL) OR (company_id = public.current_user_company_id())));


--
-- Name: requisition_items Allow modifications to requisition_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow modifications to requisition_items" ON public.requisition_items USING (((public.current_user_company_id() IS NULL) OR (requisition_id IN ( SELECT requisitions.id
   FROM public.requisitions
  WHERE (requisitions.company_id = public.current_user_company_id()))))) WITH CHECK (((public.current_user_company_id() IS NULL) OR (requisition_id IN ( SELECT requisitions.id
   FROM public.requisitions
  WHERE (requisitions.company_id = public.current_user_company_id())))));


--
-- Name: requisitions Allow modifications to requisitions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow modifications to requisitions" ON public.requisitions USING (((public.current_user_company_id() IS NULL) OR (company_id = public.current_user_company_id()))) WITH CHECK (((public.current_user_company_id() IS NULL) OR (company_id = public.current_user_company_id())));


--
-- Name: sites Allow modifications to sites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow modifications to sites" ON public.sites USING (((public.current_user_company_id() IS NULL) OR (company_id = public.current_user_company_id()))) WITH CHECK (((public.current_user_company_id() IS NULL) OR (company_id = public.current_user_company_id())));


--
-- Name: zones Allow modifications to zones; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow modifications to zones" ON public.zones USING (((public.current_user_company_id() IS NULL) OR (site_id IN ( SELECT sites.id
   FROM public.sites
  WHERE (sites.company_id = public.current_user_company_id()))))) WITH CHECK (((public.current_user_company_id() IS NULL) OR (site_id IN ( SELECT sites.id
   FROM public.sites
  WHERE (sites.company_id = public.current_user_company_id())))));


--
-- Name: companies Allow read access to companies; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow read access to companies" ON public.companies FOR SELECT USING (((public.current_user_company_id() IS NULL) OR (id = public.current_user_company_id())));


--
-- Name: requesters Allow read access to requesters; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow read access to requesters" ON public.requesters FOR SELECT USING (((public.current_user_company_id() IS NULL) OR (company_id = public.current_user_company_id())));


--
-- Name: requisition_items Allow read access to requisition_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow read access to requisition_items" ON public.requisition_items FOR SELECT USING (((public.current_user_company_id() IS NULL) OR (requisition_id IN ( SELECT requisitions.id
   FROM public.requisitions
  WHERE (requisitions.company_id = public.current_user_company_id())))));


--
-- Name: requisitions Allow read access to requisitions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow read access to requisitions" ON public.requisitions FOR SELECT USING (((public.current_user_company_id() IS NULL) OR (company_id = public.current_user_company_id())));


--
-- Name: sites Allow read access to sites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow read access to sites" ON public.sites FOR SELECT USING (((public.current_user_company_id() IS NULL) OR (company_id = public.current_user_company_id())));


--
-- Name: zones Allow read access to zones; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow read access to zones" ON public.zones FOR SELECT USING (((public.current_user_company_id() IS NULL) OR (site_id IN ( SELECT sites.id
   FROM public.sites
  WHERE (sites.company_id = public.current_user_company_id())))));


--
-- Name: companies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

--
-- Name: requesters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.requesters ENABLE ROW LEVEL SECURITY;

--
-- Name: requisition_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.requisition_items ENABLE ROW LEVEL SECURITY;

--
-- Name: requisitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.requisitions ENABLE ROW LEVEL SECURITY;

--
-- Name: sites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;

--
-- Name: zones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.zones ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict 1jqksKjjckCkJTL3CShAUhbbeNrpPfdeUAupSPilGb0k46S4xTJCzAtHf19Xb23

```
