/**
 * Meta Cloud API (WhatsApp) Webhook & Messaging Helpers
 * Conforms to ADR-0002 & ADR-0003.
 */

import { StructuredRequisitionExtraction } from "./types.ts";

/**
 * Validates the X-Hub-Signature-256 header against the raw request body using HMAC-SHA256.
 * Implements constant-time comparison to prevent timing attacks.
 */
export async function verifyWhatsAppSignature(
  rawBody: Uint8Array,
  signatureHeader: string | null,
  appSecret: string
): Promise<boolean> {
  if (!signatureHeader || !appSecret) {
    return false;
  }

  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) {
    return false;
  }

  const providedHex = signatureHeader.slice(prefix.length).trim().toLowerCase();

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(appSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      rawBody as unknown as BufferSource
    );
    const computedHex = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toLowerCase();

    if (computedHex.length !== providedHex.length) {
      return false;
    }

    // Constant-time comparison
    let mismatch = 0;
    for (let i = 0; i < computedHex.length; i++) {
      mismatch |= computedHex.charCodeAt(i) ^ providedHex.charCodeAt(i);
    }
    return mismatch === 0;
  } catch (err) {
    console.error("[WhatsApp] Signature verification error:", err);
    return false;
  }
}

/**
 * Downloads a media asset (e.g. voice note audio) from Meta Cloud API.
 */
export async function downloadWhatsAppMedia(
  mediaId: string
): Promise<{ data: Uint8Array; mimeType: string } | null> {
  const token = Deno.env.get("WHATSAPP_API_TOKEN");
  if (!token) {
    console.warn("[WhatsApp] WHATSAPP_API_TOKEN is not set; skipping media download.");
    return null;
  }

  try {
    // Step 1: Retrieve media metadata and direct download URL
    const metaRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!metaRes.ok) {
      const errText = await metaRes.text();
      console.warn(`[WhatsApp] Failed to query media ID ${mediaId}: ${metaRes.status} ${errText}`);
      return null;
    }

    const metaData = await metaRes.json();
    const downloadUrl = metaData.url;
    const mimeType = metaData.mime_type || "audio/ogg";

    if (!downloadUrl) {
      console.warn(`[WhatsApp] Media metadata returned no download URL for ID ${mediaId}`);
      return null;
    }

    // Step 2: Download raw binary stream
    const fileRes = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!fileRes.ok) {
      console.warn(`[WhatsApp] Failed to download media binary: ${fileRes.status}`);
      return null;
    }

    const arrayBuffer = await fileRes.arrayBuffer();
    return { data: new Uint8Array(arrayBuffer), mimeType };
  } catch (err) {
    console.error(`[WhatsApp] Error downloading media ${mediaId}:`, err);
    return null;
  }
}

/**
 * Sends a transactional WhatsApp text reply via Meta Cloud API v20.0.
 */
export async function sendWhatsAppTextMessage(
  recipientPhone: string,
  messageBody: string
): Promise<{ success: boolean; status: number; data?: unknown; error?: string }> {
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const token = Deno.env.get("WHATSAPP_API_TOKEN");

  if (!phoneNumberId || !token) {
    console.warn("[WhatsApp] WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_API_TOKEN missing; skipping outbound message.");
    return { success: false, status: 0, error: "Missing WhatsApp credentials" };
  }

  // Meta Cloud API accepts phone numbers without the leading '+' or with it
  const formattedPhone = recipientPhone.replace(/^\+/, "").trim();

  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: formattedPhone,
    type: "text",
    text: {
      preview_url: false,
      body: messageBody,
    },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const resJson = await res.json().catch(() => null);

    if (!res.ok) {
      console.warn(`[WhatsApp] Outbound message dispatch error (${res.status}):`, resJson);
      return { success: false, status: res.status, data: resJson, error: "Meta API returned error" };
    }

    return { success: true, status: res.status, data: resJson };
  } catch (err) {
    console.error("[WhatsApp] Outbound message network error:", err);
    return { success: false, status: 500, error: (err as Error).message };
  }
}

/**
 * Generic or default unit words that should be omitted from display.
 */
const GENERIC_UNITS = new Set([
  "unit",
  "units",
  "item",
  "items",
  "each",
  "ea",
  "piece",
  "pieces",
  "pcs",
  "part",
  "parts",
  "qty",
  "",
]);

/**
 * Formats line item quantity as a clean multiplication tag (e.g. "1x", "3x")
 * and appends non-standard units (e.g. "3x PTFE Thread Seal Tape (Rolls)").
 * Never outputs "1 units" or trailing plural bugs.
 */
export function formatQuantityItem(
  quantity: number | string | undefined | null,
  itemDescription: string,
  unitOfMeasure?: string | null
): string {
  const rawQty = typeof quantity === "number" ? quantity : parseFloat(String(quantity || 1));
  const qty = isNaN(rawQty) || rawQty <= 0 ? 1 : rawQty;
  const qtyTag = `${Number.isInteger(qty) ? qty : qty}x`;
  const desc = (itemDescription || "Requisition Item").trim();
  const unit = (unitOfMeasure || "").trim();
  const unitLower = unit.toLowerCase();

  if (!unitLower || GENERIC_UNITS.has(unitLower)) {
    return `${qtyTag} ${desc}`;
  }

  // Capitalize non-standard unit cleanly: e.g. "rolls" -> "Rolls", "meters" -> "Meters"
  const displayUnit = unit.charAt(0).toUpperCase() + unit.slice(1);

  // If description already includes this unit specification (e.g. "(rolls)" or "rolls"), don't duplicate
  if (desc.toLowerCase().includes(`(${unitLower})`)) {
    return `${qtyTag} ${desc}`;
  }

  return `${qtyTag} ${desc} (${displayUnit})`;
}

/**
 * Joins site, zone, and location details cleanly with a middle dot separator:
 * [Site Name] • [Zone Name] • [Location Detail]
 * Filters out undefined/null/empty/duplicate segments to ensure no trailing separators.
 */
export function formatLocation(
  siteName?: string | null,
  zoneName?: string | null,
  locationDetail?: string | null
): string {
  const segments: string[] = [];

  const cleanSite = siteName?.trim();
  const cleanZone = zoneName?.trim();
  const cleanDetail = locationDetail?.trim();

  if (cleanSite) {
    segments.push(cleanSite);
  }

  if (cleanZone && !segments.some((s) => s.toLowerCase() === cleanZone.toLowerCase())) {
    segments.push(cleanZone);
  }

  if (cleanDetail && !segments.some((s) => s.toLowerCase() === cleanDetail.toLowerCase())) {
    segments.push(cleanDetail);
  }

  return segments.length > 0 ? segments.join(" • ") : "Unassigned Site";
}

/**
 * Formats raw database urgency enums into clean title case.
 */
export function formatUrgency(urgency?: string | null): string {
  switch (urgency) {
    case "CRITICAL_BREAKDOWN":
      return "Critical Breakdown";
    case "URGENT":
      return "Urgent";
    case "ROUTINE":
    default:
      return "Routine";
  }
}

/**
 * Maps database status to human-readable pipeline stage.
 */
export function formatPipelineStage(status: string): string {
  switch (status) {
    case "LOGGED":
      return "In Review";
    case "PENDING_QUOTE":
      return "Pending Quote";
    case "PO_PLACED":
      return "PO Placed";
    case "DELIVERED_TO_SITE":
      return "Delivered to Site";
    case "CLOSED":
      return "Closed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}

/**
 * Formats Template A: Order Confirmation (Receipt)
 *
 * 📋 ORDER LOGGED • [REF_CODE]
 *
 * • [Qty]x [Item Description]
 * • [Qty]x [Item Description]
 *
 * 📍 Location: [Clean Formatted Location]
 * ⚡ Urgency: [Routine | Urgent | Critical Breakdown]
 * ⏱ Status: In Review
 * (optional duplicate note right above divider)
 * ────────────────
 * Reply STATUS to track your open orders.
 */
export function formatConfirmationMessage(
  referenceCode: string,
  formattedLocation: string,
  extraction: StructuredRequisitionExtraction,
  isDuplicateSuspect: boolean = false
): string {
  const itemsLines =
    extraction.items && extraction.items.length > 0
      ? extraction.items
          .map((item) => `• ${formatQuantityItem(item.quantity, item.item_description, item.unit_of_measure)}`)
          .join("\n")
      : "• 1x Requisition Items";

  const urgencyStr = formatUrgency(extraction.urgency);
  const duplicateAlert = isDuplicateSuspect
    ? "\n\n⚠️ Note: Similar items were ordered for this site within 7 days."
    : "";

  return `📋 ORDER LOGGED • ${referenceCode}

${itemsLines}

📍 Location: ${formattedLocation}
⚡ Urgency: ${urgencyStr}
⏱ Status: In Review${duplicateAlert}

────────────────
Reply STATUS to track your open orders.`.trim();
}

export interface ActiveOrderTrackingSummary {
  reference_code: string;
  status: string;
  formatted_location?: string;
  site_name?: string; // backwards compat
  zone_name?: string;
  location_detail?: string;
  items?: Array<{
    quantity?: number | string | null;
    item_description: string;
    unit_of_measure?: string | null;
  }>;
  items_summary?: string; // backwards compat string
  created_at?: string;
}

/**
 * Formats Template B: Active Orders Tracking (STATUS)
 *
 * 📦 YOUR ACTIVE ORDERS ([Count])
 *
 * [REF_CODE] • [Human Readable Stage]
 * 📍 [Clean Formatted Location]
 *   - [Qty]x [Item Description]
 *   - [Qty]x [Item Description]
 *
 * ────────────────
 * Reply with an order number (e.g. [FIRST_REF_CODE]) for details.
 */
export function formatStatusTrackingReply(
  activeRequisitions: ActiveOrderTrackingSummary[],
  queriedRef?: string
): string {
  // Case 1: Empty list
  if (activeRequisitions.length === 0) {
    if (queriedRef) {
      return `📦 ORDER NOT FOUND • ${queriedRef}

No active requisition found matching that reference code.

────────────────
Reply STATUS to view all your open orders.`.trim();
    }
    return `📦 YOUR ACTIVE ORDERS (0)

You currently have no open requisitions in progress.

────────────────
Send a message with what you need anytime to log an order.`.trim();
  }

  // Case 2: Specific reference code query
  if (queriedRef && activeRequisitions.length === 1) {
    const req = activeRequisitions[0];
    const stage = formatPipelineStage(req.status);
    const loc =
      req.formatted_location ||
      formatLocation(req.site_name, req.zone_name, req.location_detail);

    let itemsBlock = "";
    if (req.items && req.items.length > 0) {
      itemsBlock = req.items
        .map((it) => `  - ${formatQuantityItem(it.quantity, it.item_description, it.unit_of_measure)}`)
        .join("\n");
    } else if (req.items_summary) {
      itemsBlock = req.items_summary
        .split(",")
        .map((s) => `  - ${s.trim()}`)
        .join("\n");
    } else {
      itemsBlock = "  - 1x Requisition items";
    }

    return `📦 ORDER DETAILS • ${req.reference_code}

${req.reference_code} • ${stage}
📍 ${loc}
${itemsBlock}

────────────────
Reply STATUS to view all your open orders.`.trim();
  }

  // Case 3: List of active orders (Template B)
  const orderCards = activeRequisitions.map((req) => {
    const stage = formatPipelineStage(req.status);
    const loc =
      req.formatted_location ||
      formatLocation(req.site_name, req.zone_name, req.location_detail);

    let itemsBlock = "";
    if (req.items && req.items.length > 0) {
      itemsBlock = req.items
        .map((it) => `  - ${formatQuantityItem(it.quantity, it.item_description, it.unit_of_measure)}`)
        .join("\n");
    } else if (req.items_summary) {
      itemsBlock = req.items_summary
        .split(",")
        .map((s) => `  - ${s.trim()}`)
        .join("\n");
    } else {
      itemsBlock = "  - 1x Requisition items";
    }

    return `${req.reference_code} • ${stage}\n📍 ${loc}\n${itemsBlock}`;
  });

  const firstRef = activeRequisitions[0]?.reference_code || "REQ-YYMM-XXXX";

  return `📦 YOUR ACTIVE ORDERS (${activeRequisitions.length})

${orderCards.join("\n\n")}

────────────────
Reply with an order number (e.g. ${firstRef}) for details.`.trim();
}

/**
 * Formats Template C: Delivery Arrival Alert (DELIVERED_TO_SITE)
 *
 * 🚚 ORDER ARRIVED • [REF_CODE]
 *
 * Your requested items have been delivered to site:
 * • [Qty]x [Item Description]
 * • [Qty]x [Item Description]
 *
 * 📍 Collection: [Clean Formatted Location] (Site Office)
 * Please inspect and collect your items.
 */
export function formatDeliveryAlertMessage(
  referenceCode: string,
  formattedLocation: string,
  items:
    | Array<{
        quantity?: number | string | null;
        item_description: string;
        unit_of_measure?: string | null;
      }>
    | string
): string {
  const cleanLoc = (formattedLocation || "Job Site").trim();
  const collectionLocation = cleanLoc.toLowerCase().includes("(site office)")
    ? cleanLoc
    : `${cleanLoc} (Site Office)`;

  let itemsLines = "";
  if (Array.isArray(items) && items.length > 0) {
    itemsLines = items
      .map((it) => `• ${formatQuantityItem(it.quantity, it.item_description, it.unit_of_measure)}`)
      .join("\n");
  } else if (typeof items === "string" && items.trim()) {
    itemsLines = items
      .split(",")
      .map((s) => `• ${s.trim()}`)
      .join("\n");
  } else {
    itemsLines = "• 1x Requisition Items";
  }

  return `🚚 ORDER ARRIVED • ${referenceCode}

Your requested items have been delivered to site:
${itemsLines}

📍 Collection: ${collectionLocation}
Please inspect and collect your items.`.trim();
}
