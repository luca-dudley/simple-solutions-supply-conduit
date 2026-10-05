/**
 * Shared Type Definitions for Supabase Edge Functions & Supply Conduit Data Contracts
 * Conforms to ADR-0001, ADR-0002, ADR-0003, and ADR-0004.
 */

// ============================================================================
// Core Status Enums
// ============================================================================

export type UrgencyLevel = "ROUTINE" | "URGENT" | "CRITICAL_BREAKDOWN";

export type RequisitionStatus =
  | "LOGGED"
  | "PENDING_QUOTE"
  | "PO_PLACED"
  | "DELIVERED_TO_SITE"
  | "CLOSED"
  | "CANCELLED";

// ============================================================================
// AI Structured Extraction Contracts
// ============================================================================

export interface ExtractedLineItemContract {
  item_description: string;
  quantity: number;
  unit_of_measure: string; // e.g. "units", "meters", "kg", "bags", "rolls", "boxes", "litres", "cartridges"
  part_number?: string | null;
  notes?: string | null;
}

export interface StructuredRequisitionExtraction {
  items: ExtractedLineItemContract[];
  urgency: UrgencyLevel;
  urgency_reason?: string | null;
  site_name?: string | null;
  zone_name?: string | null;
  location_detail?: string | null;
  site_hint?: string | null;
  zone_hint?: string | null;
  confidence_score: number; // 0.0 to 1.0
  clarification_needed?: string | null;
}

// ============================================================================
// Meta Cloud API (WhatsApp) Webhook Contracts
// ============================================================================

export interface WhatsAppContact {
  profile: {
    name: string;
  };
  wa_id: string; // e.g. "27821234567"
}

export interface WhatsAppTextMessage {
  body: string;
}

export interface WhatsAppAudioMessage {
  id: string;
  mime_type: string;
}

export interface WhatsAppImageMessage {
  id: string;
  mime_type: string;
  caption?: string;
}

export interface WhatsAppInboundMessage {
  from: string;
  id: string; // e.g. "wamid.HBgL..."
  timestamp: string;
  type: "text" | "audio" | "image" | string;
  text?: WhatsAppTextMessage;
  audio?: WhatsAppAudioMessage;
  image?: WhatsAppImageMessage;
}

export interface WhatsAppStatusUpdate {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient_id: string;
}

export interface WhatsAppChangeValue {
  messaging_product: "whatsapp";
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: WhatsAppContact[];
  messages?: WhatsAppInboundMessage[];
  statuses?: WhatsAppStatusUpdate[];
}

export interface WhatsAppChange {
  value: WhatsAppChangeValue;
  field: "messages" | string;
}

export interface WhatsAppEntry {
  id: string;
  changes: WhatsAppChange[];
}

export interface InboundWhatsAppWebhookPayload {
  object: "whatsapp_business_account" | string;
  entry: WhatsAppEntry[];
}

// Outbound Message Request Payload
export interface WhatsAppOutboundTextMessage {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "text";
  text: {
    preview_url: boolean;
    body: string;
  };
}

// ============================================================================
// Database Entities (PostgreSQL / Supabase Schema)
// ============================================================================

export interface Company {
  id: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  settings: {
    duplicate_window_days?: number;
    require_zone?: boolean;
    [key: string]: unknown;
  };
  created_at: string;
  updated_at: string;
}

export interface Site {
  id: string;
  company_id: string;
  name: string;
  code: string;
  location_description?: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Zone {
  id: string;
  site_id: string;
  name: string;
  code?: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Requester {
  id: string;
  company_id: string;
  phone_number: string;
  name: string;
  role_title?: string | null;
  default_site_id?: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Requisition {
  id: string;
  company_id: string;
  reference_code: string;
  po_number?: string | null;
  site_id: string;
  zone_id?: string | null;
  requester_id: string;
  status: RequisitionStatus;
  urgency: UrgencyLevel;
  raw_message_text?: string | null;
  audio_url?: string | null;
  media_urls: string[];
  whatsapp_message_id?: string | null;
  is_duplicate_suspect: boolean;
  duplicate_of_id?: string | null;
  assigned_buyer_id?: string | null;
  supplier_name?: string | null;
  total_estimated_zar: number;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RequisitionItem {
  id: string;
  requisition_id: string;
  item_description: string;
  normalized_tokens?: string | null;
  quantity: number;
  unit_of_measure: string;
  part_number?: string | null;
  notes?: string | null;
  pastel_item_code?: string | null;
  unit_price_zar?: number | null;
  created_at: string;
}

export interface DuplicateCheckResult {
  suspect_requisition_id: string;
  reference_code: string;
  matched_item: string;
  created_at: string;
  status: RequisitionStatus;
}

export interface RequisitionCardState {
  id: string;
  reference_code: string;
  po_number?: string | null;
  site_name: string;
  site_code: string;
  zone_name?: string | null;
  requester_name: string;
  requester_phone: string;
  status: RequisitionStatus;
  urgency: UrgencyLevel;
  is_duplicate_suspect: boolean;
  duplicate_of_ref?: string | null;
  raw_message_text?: string | null;
  audio_url?: string | null;
  items: Array<{
    id: string;
    item_description: string;
    quantity: number;
    unit_of_measure: string;
    part_number?: string | null;
    unit_price_zar?: number | null;
    line_total_zar?: number | null;
    pastel_item_code?: string | null;
  }>;
  total_estimated_zar: number;
  created_at: string;
}
