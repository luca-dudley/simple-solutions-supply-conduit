/**
 * Production WhatsApp Webhook Handler for Supply Conduit
 * Conforms strictly to ADR-0001, ADR-0002, ADR-0003, and Operational Multi-Tier Specification.
 *
 * Capabilities:
 * 1. GET: Meta webhook challenge verification (hub.mode, hub.verify_token, hub.challenge)
 * 2. POST: Inbound webhook verification via HMAC-SHA256 (X-Hub-Signature-256)
 * 3. Idempotency protection against WhatsApp at-least-once delivery retries
 * 4. Conversational keyword tracking (STATUS, TRACK, REQ-...)
 * 5. Structured item, urgency, and multi-tier location extraction via Gemini 3.8 Flash
 * 6. Automatic Requester Profile Name resolution from WhatsApp metadata
 * 7. Dynamic Multi-Tier Hierarchy resolution ("Find-or-Create" Sites & Zones)
 * 8. Tightened 7-day rolling duplicate detection (false-positive elimination)
 * 9. Requisition header, line items, and location details persistence (status: LOGGED)
 * 10. Automated outbound WhatsApp confirmation ping and status delivery alerts
 */

import { getServiceRoleClient } from "../_shared/supabaseClient.ts";
import {
  InboundWhatsAppWebhookPayload,
  StructuredRequisitionExtraction,
} from "../_shared/types.ts";
import {
  downloadWhatsAppMedia,
  formatConfirmationMessage,
  formatDeliveryAlertMessage,
  formatLocation,
  formatQuantityItem,
  formatStatusTrackingReply,
  sendWhatsAppTextMessage,
  verifyWhatsAppSignature,
} from "../_shared/whatsapp.ts";
import { extractWithGemini } from "../_shared/gemini.ts";

/**
 * Generic hardware and material stop-words that must never trigger duplicate matches.
 */
const GENERIC_HARDWARE_STOPWORDS = new Set([
  // Generic materials & hardware classifications
  "pvc", "steel", "plastic", "fitting", "joint", "roll", "rolls", "tape",
  "meter", "meters", "unit", "units", "box", "boxes", "bottle", "bottles",
  "pipe", "pipes", "piece", "pieces", "size", "standard", "heavy", "duty",
  // Common conversation / requisition filler
  "and", "the", "for", "with", "item", "items", "bags", "pack", "packs",
  "need", "urgent", "urgently", "please", "line", "packhouse", "cold", "room",
  "routine", "spares", "parts", "valve", "valves", "right", "angle",
  "straight", "curved", "small", "large", "medium", "each", "approx"
]);

/**
 * Extracts searchable keyword tokens from line item descriptions for the
 * 7-day duplicate detection RPC, filtering out broad generic hardware stop-words.
 */
function extractDuplicateSearchTokens(
  extraction: StructuredRequisitionExtraction
): string[] {
  const tokens = new Set<string>();

  for (const item of extraction.items) {
    if (!item.item_description) continue;

    const desc = item.item_description.trim().toLowerCase();

    // Clean description without punctuation
    const words = desc
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 3 && !GENERIC_HARDWARE_STOPWORDS.has(w));

    // Multi-word bigrams for product descriptors (e.g. "ball valve", "thread tape", "pump pliers", "water pump")
    if (words.length >= 2) {
      for (let i = 0; i < words.length - 1; i++) {
        tokens.add(`${words[i]} ${words[i + 1]}`);
      }
    }

    // Meaningful core single-word terms (minimum 4 characters, non-stopwords)
    for (const w of words) {
      if (w.length >= 4 && !GENERIC_HARDWARE_STOPWORDS.has(w)) {
        tokens.add(w);
      }
    }

    // Part number if specified (e.g. "EP2-400G", "B68")
    if (item.part_number && item.part_number.trim().length >= 3) {
      tokens.add(item.part_number.trim().toLowerCase());
    }
  }

  return Array.from(tokens);
}

/**
 * Helper to generate a clean, safe code for auto-created sites.
 * Ensures max 20 chars and alphanumeric uppercase.
 */
function generateSiteCode(siteName: string): string {
  const cleaned = siteName.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const base = cleaned.slice(0, 10) || "SITE";
  const suffix = Math.floor(100 + Math.random() * 900);
  return `${base}-${suffix}`.slice(0, 20);
}

/**
 * Helper to generate a clean, safe code for auto-created zones.
 */
function generateZoneCode(zoneName: string): string {
  const cleaned = zoneName.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const base = cleaned.slice(0, 10) || "ZONE";
  const suffix = Math.floor(100 + Math.random() * 900);
  return `${base}-${suffix}`.slice(0, 20);
}

/**
 * Formats location according to operational multi-tier convention:
 * [Site Name] • [Zone Name] • [Location Detail]
 */
function formatItemLocation(siteName?: string, zoneName?: string, locationDetail?: string | null): string {
  return formatLocation(siteName, zoneName, locationDetail);
}

/**
 * Dynamically resolves macro Site and functional Zone ("Find-or-Create").
 * Supports distributed industrial and agricultural enterprise facilities.
 */
async function findOrCreateLocation(
  supabase: ReturnType<typeof getServiceRoleClient>,
  companyId: string,
  defaultSiteId: string | null,
  extraction: StructuredRequisitionExtraction
): Promise<{
  siteId: string;
  siteName: string;
  zoneId: string | null;
  zoneName: string | null;
  locationDetail: string | null;
  formattedLocation: string;
}> {
  let resolvedSiteId: string | null = null;
  let resolvedSiteName = "Job Site";
  let resolvedZoneId: string | null = null;
  let resolvedZoneName: string | null = null;

  const rawSiteHint = extraction.site_name?.trim();
  const rawZoneHint = extraction.zone_name?.trim();
  const locationDetail = extraction.location_detail?.trim() || null;

  // 1. Resolve Macro Site
  if (rawSiteHint && rawSiteHint.length > 1) {
    const { data: matchedSites } = await supabase
      .from("sites")
      .select("id, name, code")
      .eq("company_id", companyId)
      .ilike("name", rawSiteHint)
      .limit(1);

    if (matchedSites && matchedSites.length > 0) {
      resolvedSiteId = matchedSites[0].id;
      resolvedSiteName = matchedSites[0].name;
      console.log(`[Location Resolver] Matched existing site: ${resolvedSiteName} (${resolvedSiteId})`);
    } else {
      const newCode = generateSiteCode(rawSiteHint);
      console.log(`[Location Resolver] Auto-creating new site: "${rawSiteHint}" (code: ${newCode})`);
      const { data: createdSite, error: siteErr } = await supabase
        .from("sites")
        .insert({
          company_id: companyId,
          name: rawSiteHint,
          code: newCode,
          is_active: true,
        })
        .select("id, name")
        .single();

      if (!siteErr && createdSite) {
        resolvedSiteId = createdSite.id;
        resolvedSiteName = createdSite.name;
      } else {
        console.warn(`[Location Resolver] Failed to auto-insert site "${rawSiteHint}":`, siteErr?.message);
      }
    }
  }

  // Fallback to defaultSiteId or first active site if site is still unassigned
  if (!resolvedSiteId) {
    if (defaultSiteId) {
      resolvedSiteId = defaultSiteId;
    } else {
      const { data: firstActiveSite } = await supabase
        .from("sites")
        .select("id, name")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      resolvedSiteId = firstActiveSite?.id ?? null;
    }

    if (resolvedSiteId) {
      const { data: siteRecord } = await supabase
        .from("sites")
        .select("name")
        .eq("id", resolvedSiteId)
        .single();
      resolvedSiteName = siteRecord?.name || "Job Site";
    }
  }

  if (!resolvedSiteId) {
    throw new Error(`No operational site could be resolved for company ${companyId}`);
  }

  // 2. Resolve Functional Zone (scoped under resolvedSiteId)
  if (rawZoneHint && rawZoneHint.length > 1) {
    const { data: matchedZones } = await supabase
      .from("zones")
      .select("id, name")
      .eq("site_id", resolvedSiteId)
      .ilike("name", rawZoneHint)
      .limit(1);

    if (matchedZones && matchedZones.length > 0) {
      resolvedZoneId = matchedZones[0].id;
      resolvedZoneName = matchedZones[0].name;
      console.log(`[Location Resolver] Matched existing zone: ${resolvedZoneName} (${resolvedZoneId})`);
    } else {
      const newZoneCode = generateZoneCode(rawZoneHint);
      console.log(`[Location Resolver] Auto-creating new zone: "${rawZoneHint}" (code: ${newZoneCode})`);
      const { data: createdZone, error: zoneErr } = await supabase
        .from("zones")
        .insert({
          site_id: resolvedSiteId,
          name: rawZoneHint,
          code: newZoneCode,
          is_active: true,
        })
        .select("id, name")
        .single();

      if (!zoneErr && createdZone) {
        resolvedZoneId = createdZone.id;
        resolvedZoneName = createdZone.name;
      } else {
        console.warn(`[Location Resolver] Failed to auto-insert zone "${rawZoneHint}":`, zoneErr?.message);
      }
    }
  }

  // 3. Format Location String
  const formattedLocation = formatItemLocation(resolvedSiteName, resolvedZoneName || undefined, locationDetail);

  return {
    siteId: resolvedSiteId,
    siteName: resolvedSiteName,
    zoneId: resolvedZoneId,
    zoneName: resolvedZoneName,
    locationDetail,
    formattedLocation,
  };
}

/**
 * Main Webhook Request Handler
 */
export async function handleWhatsAppWebhook(req: Request): Promise<Response> {
  const method = req.method;

  // ==========================================================================
  // 1. Meta Webhook Handshake Verification (HTTP GET)
  // ==========================================================================
  if (method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    const expectedVerifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN");

    if (
      mode === "subscribe" &&
      token &&
      expectedVerifyToken &&
      token === expectedVerifyToken
    ) {
      console.log("[Webhook Handshake] Successfully verified Meta challenge token.");
      return new Response(challenge ?? "", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    console.warn(
      `[Webhook Handshake] Verification failed. Received token: '${token}', Expected: '${expectedVerifyToken}'`
    );
    return new Response("Forbidden", {
      status: 403,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // ==========================================================================
  // 2. Inbound Webhook Ingestion (HTTP POST)
  // ==========================================================================
  if (method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // A. Cryptographic Signature Verification & Internal Action Dispatch
  const signatureHeader =
    req.headers.get("x-hub-signature-256") ||
    req.headers.get("X-Hub-Signature-256");
  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET") || "";

  const rawBodyBuffer = await req.arrayBuffer();
  const rawBodyBytes = new Uint8Array(rawBodyBuffer);
  const textDecoder = new TextDecoder();
  const bodyText = textDecoder.decode(rawBodyBytes);

  let parsedBodyJson: any = null;
  try {
    parsedBodyJson = JSON.parse(bodyText);
  } catch (_) {
    // raw text or malformed JSON
  }

  // Handle internal delivery alert action (e.g. from portal dashboard or supabase webhook)
  if (parsedBodyJson && parsedBodyJson.action === "delivery_alert" && parsedBodyJson.requisition_id) {
    console.log(`[Webhook Delivery Alert] Internal delivery alert triggered for ${parsedBodyJson.requisition_id}`);
    const supabase = getServiceRoleClient();
    const { data: reqRecord, error: reqErr } = await supabase
      .from("requisitions")
      .select(`
        id, reference_code, status, location_detail,
        site:sites(name),
        zone:zones(name),
        requester:requesters(phone_number, name),
        items:requisition_items(quantity, unit_of_measure, item_description)
      `)
      .eq("id", parsedBodyJson.requisition_id)
      .single();

    if (reqErr || !reqRecord) {
      return new Response(JSON.stringify({ error: "Requisition not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const recipientPhone = (reqRecord.requester as any)?.phone_number;
    if (!recipientPhone) {
      return new Response(JSON.stringify({ message: "No phone number on requester record" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const loc = formatLocation(
      (reqRecord.site as any)?.name,
      (reqRecord.zone as any)?.name,
      reqRecord.location_detail
    );
    const alertMessage = formatDeliveryAlertMessage(
      reqRecord.reference_code,
      loc,
      reqRecord.items || []
    );
    const dispatchResult = await sendWhatsAppTextMessage(recipientPhone, alertMessage);

    return new Response(
      JSON.stringify({
        success: dispatchResult.success,
        reference_code: reqRecord.reference_code,
        recipient: recipientPhone,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // For Meta inbound webhooks, verify HMAC signature
  const isSignatureValid = await verifyWhatsAppSignature(
    rawBodyBytes,
    signatureHeader,
    appSecret
  );

  if (!isSignatureValid) {
    console.warn("[Webhook Ingestion] Rejected request: Invalid HMAC signature.");
    return new Response(
      JSON.stringify({ error: "Forbidden: Signature mismatch" }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // B. Parse JSON Payload
  let payload: InboundWhatsAppWebhookPayload;
  if (parsedBodyJson && parsedBodyJson.entry) {
    payload = parsedBodyJson as InboundWhatsAppWebhookPayload;
  } else {
    try {
      payload = JSON.parse(bodyText);
    } catch (err) {
      console.error("[Webhook Ingestion] Failed to parse JSON body:", err);
      return new Response(JSON.stringify({ error: "Bad Request: Malformed JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const changeValue = payload.entry?.[0]?.changes?.[0]?.value;
  const messages = changeValue?.messages;

  // Filter out non-message events (e.g. delivery receipts, read statuses)
  if (!messages || messages.length === 0) {
    return new Response(
      JSON.stringify({ status: "acknowledged", detail: "No inbound messages" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const inboundMessage = messages[0];
  const whatsappMessageId = inboundMessage.id;
  const fromPhone = inboundMessage.from; // e.g. "27821234567"
  const normalizedPhone = fromPhone.startsWith("+") ? fromPhone : `+${fromPhone}`;
  const rawContactName = changeValue?.contacts?.[0]?.profile?.name?.trim();
  const contactName = rawContactName && rawContactName.length > 0 ? rawContactName : "Field Requester";

  console.log(
    `[Webhook Ingestion] Processing message ${whatsappMessageId} from ${fromPhone} (${contactName})`
  );

  // Initialize Supabase Service Role Client
  const supabase = getServiceRoleClient();

  // C. Check Idempotency (Prevent Duplicate Processing from Meta Retries)
  const { data: existingRequisition, error: idempError } = await supabase
    .from("requisitions")
    .select("id, reference_code, status")
    .eq("whatsapp_message_id", whatsappMessageId)
    .maybeSingle();

  if (idempError) {
    console.error("[Webhook Idempotency] Check query failed:", idempError);
  }

  if (existingRequisition) {
    console.log(
      `[Webhook Idempotency] Message ${whatsappMessageId} already processed (Ref: ${existingRequisition.reference_code}). Returning 200 OK.`
    );
    return new Response(
      JSON.stringify({
        status: "idempotent_ok",
        message: "Message already processed",
        reference_code: existingRequisition.reference_code,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // ==========================================================================
  // 3. Extract Inbound Content & Trim Text
  // ==========================================================================
  let rawMessageText = "";
  let audioData: { data: Uint8Array; mimeType: string } | null = null;

  if (inboundMessage.type === "text" && inboundMessage.text) {
    rawMessageText =
      typeof inboundMessage.text === "string"
        ? inboundMessage.text
        : (inboundMessage.text.body ?? "");
  } else if (inboundMessage.type === "audio" && inboundMessage.audio) {
    console.log(`[Webhook Ingestion] Downloading audio media ID: ${inboundMessage.audio.id}`);
    audioData = await downloadWhatsAppMedia(inboundMessage.audio.id);
    rawMessageText = `[Voice Note received: ID ${inboundMessage.audio.id}]`;
  } else if (inboundMessage.type === "image" && inboundMessage.image) {
    rawMessageText = inboundMessage.image.caption || "[Image Requisition Attached]";
  } else {
    rawMessageText = `[Message type ${inboundMessage.type}]`;
  }

  rawMessageText = rawMessageText || "";
  const trimmedText = rawMessageText.trim();
  const rawPhoneDigits = fromPhone.replace(/^\+/, "");

  // ==========================================================================
  // 4. Whitelist Verification & Multi-Tenant Routing (ADR-0005)
  // ==========================================================================
  const { data: matchedRequesters, error: reqLookupErr } = await supabase
    .from("requesters")
    .select("id, company_id, default_site_id, name, is_active, company:companies(id, name, company_code)")
    .or(`phone_number.eq.${normalizedPhone},phone_number.eq.${rawPhoneDigits}`)
    .limit(1);

  if (reqLookupErr) {
    console.error("[Webhook Requester] Error querying requesters:", reqLookupErr);
  }

  const existingRequester = matchedRequesters?.[0];

  // Case 1: Unknown Number (Not Whitelisted)
  if (!existingRequester) {
    console.log(`[Webhook Whitelist] Unknown phone number ${fromPhone}. Evaluating onboarding options...`);

    const trimmedUpper = trimmedText.toUpperCase();
    const isCompanyCodePattern = /^[A-Z0-9]{6}$/.test(trimmedUpper);

    if (isCompanyCodePattern) {
      console.log(`[Webhook Whitelist] Checking 6-character Company Code: "${trimmedUpper}"`);
      const { data: matchedCompany, error: compErr } = await supabase
        .from("companies")
        .select("id, name, company_code")
        .ilike("company_code", trimmedUpper)
        .maybeSingle();

      if (compErr) {
        console.error("[Webhook Whitelist] Company code query error:", compErr);
      }

      if (matchedCompany) {
        console.log(`[Webhook Whitelist] Company code "${trimmedUpper}" matched company "${matchedCompany.name}" (${matchedCompany.id})`);

        // Find default active site for this company
        const { data: firstActiveSite } = await supabase
          .from("sites")
          .select("id, name")
          .eq("company_id", matchedCompany.id)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();

        const defaultSiteId = firstActiveSite?.id ?? null;
        const assignedName = contactName && contactName !== "Field Requester" ? contactName : "Field Technician";

        const { data: newRequester, error: insertReqErr } = await supabase
          .from("requesters")
          .insert({
            company_id: matchedCompany.id,
            phone_number: normalizedPhone,
            name: assignedName,
            role_title: "Field Technician",
            default_site_id: defaultSiteId,
            is_active: true,
          })
          .select("id, name, company_id, default_site_id")
          .single();

        if (insertReqErr || !newRequester) {
          console.error("[Webhook Whitelist] Failed to auto-enroll requester:", insertReqErr);
          throw new Error(`Failed to enroll requester: ${insertReqErr?.message}`);
        }

        console.log(`[Webhook Whitelist] Enrolled requester ${newRequester.name} (${newRequester.id}) for ${matchedCompany.name}`);

        const welcomeMsg = `🎉 *Welcome to Supply Conduit!*\n\nYour number has been linked to *${matchedCompany.name}*.\n\nYou can now send voice notes or text messages directly in this chat to log field requisitions anytime.`;
        const sendRes = await sendWhatsAppTextMessage(fromPhone, welcomeMsg);

        return new Response(
          JSON.stringify({
            success: true,
            onboarding: true,
            company_id: matchedCompany.id,
            requester_id: newRequester.id,
            outbound_dispatched: sendRes.success,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    }

    // Friendly unknown number receipt
    const unknownReceiptMsg =
      "👋 Welcome to Supply Conduit. Your number is not yet linked to an active farm or facility. Please contact your operations manager or enter your 6-character Company Code.";
    console.log(`[Webhook Whitelist] Dispatching unknown number receipt to ${fromPhone}`);
    const sendRes = await sendWhatsAppTextMessage(fromPhone, unknownReceiptMsg);

    return new Response(
      JSON.stringify({
        success: true,
        unlinked: true,
        message: "Unknown phone number. Friendly receipt dispatched.",
        outbound_dispatched: sendRes.success,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Case 2: Deactivated Requester (is_active === false)
  if (!existingRequester.is_active) {
    const compName = (existingRequester.company as any)?.name || "your facility";
    console.log(`[Webhook Whitelist] Requester ${existingRequester.id} (${fromPhone}) is deactivated for ${compName}.`);
    const inactiveNotice = `⚠️ *Notice: Account Inactive*\n\nYour field profile for *${compName}* is currently inactive. Please contact your operations manager to re-activate your requisitions access.`;
    const sendRes = await sendWhatsAppTextMessage(fromPhone, inactiveNotice);

    return new Response(
      JSON.stringify({
        success: true,
        inactive: true,
        message: "Requester account inactive.",
        outbound_dispatched: sendRes.success,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Active Whitelisted Requester Details
  const requesterId = existingRequester.id;
  const companyId = existingRequester.company_id;
  let defaultSiteId: string | null = existingRequester.default_site_id;

  // Auto-update display name if placeholder or newly detected
  const isPlaceholderName = (name: string) => {
    const lower = (name || "").trim().toLowerCase();
    return (
      lower === "field requester" ||
      lower === "field technician" ||
      lower === "unknown requester" ||
      lower === "requester" ||
      lower === ""
    );
  };

  if (
    contactName &&
    contactName !== "Field Requester" &&
    (isPlaceholderName(existingRequester.name) || existingRequester.name !== contactName)
  ) {
    console.log(
      `[Webhook Requester] Updating requester ${existingRequester.id} name from '${existingRequester.name}' to '${contactName}'`
    );
    await supabase
      .from("requesters")
      .update({ name: contactName })
      .eq("id", existingRequester.id);
    existingRequester.name = contactName;
  }

  // ==========================================================================
  // 5. Conversational Keyword Tracking Handler (STATUS / TRACK / REQ-...)
  // ==========================================================================
  const isStatusQuery = /^(status|track)$/i.test(trimmedText);
  const refCodeMatch = trimmedText.match(/^REQ-[A-Z0-9-]+$/i);

  if (isStatusQuery || refCodeMatch) {
    console.log(`[Webhook Tracking] Inbound keyword inquiry from ${fromPhone}: "${trimmedText}"`);

    if (refCodeMatch) {
      const targetRef = trimmedText.toUpperCase();
      const { data: specificReq } = await supabase
        .from("requisitions")
        .select(`
          reference_code, status, created_at, location_detail,
          site:sites(name),
          zone:zones(name),
          items:requisition_items(quantity, unit_of_measure, item_description)
        `)
        .eq("reference_code", targetRef)
        .maybeSingle();

      let replyText = "";
      if (!specificReq) {
        replyText = formatStatusTrackingReply([], targetRef);
      } else {
        const loc = formatLocation(
          (specificReq.site as any)?.name,
          (specificReq.zone as any)?.name,
          specificReq.location_detail
        );

        replyText = formatStatusTrackingReply(
          [
            {
              reference_code: specificReq.reference_code,
              status: specificReq.status,
              formatted_location: loc,
              items: specificReq.items || [],
              created_at: specificReq.created_at,
            },
          ],
          targetRef
        );
      }

      const sendRes = await sendWhatsAppTextMessage(fromPhone, replyText);
      return new Response(
        JSON.stringify({
          success: true,
          tracking_query: true,
          reference_code: targetRef,
          outbound_dispatched: sendRes.success,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } else {
      // General STATUS / TRACK query: find active (non-closed) requisitions for this requester
      const { data: reqs } = await supabase
        .from("requisitions")
        .select(`
          reference_code, status, created_at, location_detail,
          site:sites(name),
          zone:zones(name),
          items:requisition_items(quantity, unit_of_measure, item_description)
        `)
        .eq("requester_id", requesterId)
        .not("status", "in", '("CLOSED","CANCELLED")')
        .order("created_at", { ascending: false })
        .limit(5);

      const activeReqs = reqs || [];

      const formattedList = activeReqs.map((r: any) => ({
        reference_code: r.reference_code,
        status: r.status,
        formatted_location: formatLocation(r.site?.name, (r.zone as any)?.name, r.location_detail),
        items: r.items || [],
        created_at: r.created_at,
      }));

      const replyText = formatStatusTrackingReply(formattedList);
      const sendRes = await sendWhatsAppTextMessage(fromPhone, replyText);
      return new Response(
        JSON.stringify({
          success: true,
          tracking_query: true,
          active_count: formattedList.length,
          outbound_dispatched: sendRes.success,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  // ==========================================================================
  // 6. Audio & Text Extraction via Gemini 3.8 Flash
  // ==========================================================================
  console.log(`[Webhook Extraction] Invoking Gemini structured extraction for: "${rawMessageText.slice(0, 80)}"`);
  const extraction = await extractWithGemini({
    text: rawMessageText,
    audio: audioData ?? undefined,
  });

  console.log(
    `[Webhook Extraction] Extracted ${extraction.items.length} items, Urgency: ${extraction.urgency}, Site: ${extraction.site_name || "N/A"}, Zone: ${extraction.zone_name || "N/A"}, LocationDetail: ${extraction.location_detail || "N/A"}`
  );

  // ==========================================================================
  // 7. Database Operations via Supabase Service Role Client
  // ==========================================================================

  // B. Dynamic Location Resolution (Macro Site, Functional Zone, Granular Detail)
  const locationRes = await findOrCreateLocation(
    supabase,
    companyId,
    defaultSiteId,
    extraction
  );

  const siteId = locationRes.siteId;
  const zoneId = locationRes.zoneId;
  const locationDetail = locationRes.locationDetail;
  const formattedLocation = locationRes.formattedLocation;
  console.log(`[Webhook Location] Resolved location: ${formattedLocation} (site: ${siteId}, zone: ${zoneId})`);

  // C. 7-Day Rolling Duplicate Detection RPC
  const searchTokens = extractDuplicateSearchTokens(extraction);
  console.log(`[Webhook Duplicate Check] Querying duplicates with tightened tokens:`, searchTokens);

  const { data: duplicateMatches, error: duplicateErr } = await supabase.rpc(
    "check_7day_duplicates",
    {
      p_site_id: siteId,
      p_search_tokens: searchTokens.length > 0 ? searchTokens : ["requisition"],
      p_exclude_requisition_id: null,
    }
  );

  if (duplicateErr) {
    console.error("[Webhook Duplicate Check] RPC error:", duplicateErr);
  }

  const isDuplicateSuspect = Boolean(duplicateMatches && duplicateMatches.length > 0);
  const duplicateOfId = isDuplicateSuspect ? duplicateMatches[0].suspect_requisition_id : null;

  if (isDuplicateSuspect) {
    console.warn(
      `[Webhook Duplicate Check] Order flagged as duplicate suspect! Matches: ${duplicateMatches[0].reference_code} ("${duplicateMatches[0].matched_item}")`
    );
  }

  // D. Insert Requisition Header Row
  const notesBuffer: string[] = [];
  if (extraction.clarification_needed) {
    notesBuffer.push(`Clarification Needed: ${extraction.clarification_needed}`);
  }
  if (isDuplicateSuspect && duplicateMatches && duplicateMatches.length > 0) {
    notesBuffer.push(
      `7-Day Duplicate Suspect: Matches prior order ${duplicateMatches[0].reference_code} ("${duplicateMatches[0].matched_item}").`
    );
  }

  const { data: insertedRequisition, error: reqInsertErr } = await supabase
    .from("requisitions")
    .insert({
      company_id: companyId,
      site_id: siteId,
      zone_id: zoneId,
      location_detail: locationDetail,
      requester_id: requesterId,
      status: "LOGGED",
      urgency: extraction.urgency,
      raw_message_text: rawMessageText,
      whatsapp_message_id: whatsappMessageId,
      is_duplicate_suspect: isDuplicateSuspect,
      duplicate_of_id: duplicateOfId,
      total_estimated_zar: 0.00,
      notes: notesBuffer.length > 0 ? notesBuffer.join("\n") : null,
    })
    .select("id, reference_code, site_id, zone_id, location_detail, requester_id, status, urgency, is_duplicate_suspect, created_at")
    .single();

  if (reqInsertErr || !insertedRequisition) {
    console.error("[Webhook Ingestion] Requisition insert failed:", reqInsertErr);
    throw new Error(`Failed to insert requisition: ${reqInsertErr?.message}`);
  }

  const requisitionId = insertedRequisition.id;
  const referenceCode = insertedRequisition.reference_code;
  console.log(`[Webhook Ingestion] Created requisition header: ${referenceCode} (${requisitionId})`);

  // E. Insert Requisition Line Items
  if (extraction.items.length > 0) {
    const itemRecords = extraction.items.map((item) => ({
      requisition_id: requisitionId,
      item_description: item.item_description,
      normalized_tokens: item.item_description
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .trim(),
      quantity: item.quantity,
      unit_of_measure: item.unit_of_measure,
      part_number: item.part_number,
      notes: item.notes,
    }));

    const { error: itemsInsertErr } = await supabase
      .from("requisition_items")
      .insert(itemRecords);

    if (itemsInsertErr) {
      console.error("[Webhook Ingestion] Error inserting requisition items:", itemsInsertErr);
    } else {
      console.log(`[Webhook Ingestion] Inserted ${itemRecords.length} line items.`);
    }
  }

  // ==========================================================================
  // 6. Automated Outbound WhatsApp Confirmation Ping
  // ==========================================================================
  const confirmationBody = formatConfirmationMessage(
    referenceCode,
    formattedLocation,
    extraction,
    isDuplicateSuspect
  );

  console.log(`[Webhook Outbound] Dispatching confirmation ping to ${fromPhone}...`);
  const outboundResult = await sendWhatsAppTextMessage(fromPhone, confirmationBody);
  console.log(`[Webhook Outbound] Ping dispatch result:`, outboundResult);

  // Return HTTP 200 OK
  return new Response(
    JSON.stringify({
      success: true,
      reference_code: referenceCode,
      requisition_id: requisitionId,
      site_id: siteId,
      zone_id: zoneId,
      location: formattedLocation,
      items_captured: extraction.items.length,
      urgency: extraction.urgency,
      is_duplicate_suspect: isDuplicateSuspect,
      outbound_dispatched: outboundResult.success,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

// Default export / Deno serve entrypoint
if (import.meta.main) {
  Deno.serve(handleWhatsAppWebhook);
}
