/**
 * Automated Verification Test Suite for WhatsApp Webhook Handler
 * Conforms to ADR-0003 Section 4: Acceptance Criteria & Automated Verification Checklist.
 */

import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { handleWhatsAppWebhook } from "./index.ts";
import { getServiceRoleClient } from "../_shared/supabaseClient.ts";
import {
  formatConfirmationMessage,
  formatDeliveryAlertMessage,
  formatLocation,
  formatPipelineStage,
  formatQuantityItem,
  formatStatusTrackingReply,
  formatUrgency,
} from "../_shared/whatsapp.ts";

// Helper to compute valid Meta HMAC-SHA256 signature for test requests
async function computeTestSignature(bodyText: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(bodyText) as unknown as BufferSource);
  const hex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

// Ensure environment variables are loaded
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "supply_conduit_webhook_verify_token_secure";
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") || "0123456789abcdef0123456789abcdef";

Deno.env.set("WHATSAPP_VERIFY_TOKEN", VERIFY_TOKEN);
Deno.env.set("WHATSAPP_APP_SECRET", APP_SECRET);

Deno.test("Test Suite 1: Webhook Handshake (GET)", async (t) => {
  await t.step("Valid GET handshake returns 200 with challenge text", async () => {
    const challengeValue = "test_challenge_code_987654";
    const url = `https://example.com/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=${challengeValue}`;
    const req = new Request(url, { method: "GET" });

    const res = await handleWhatsAppWebhook(req);
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "text/plain");
    const body = await res.text();
    assertEquals(body, challengeValue);
  });

  await t.step("Invalid verify token returns 403 Forbidden", async () => {
    const url = `https://example.com/webhook?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=test_challenge`;
    const req = new Request(url, { method: "GET" });

    const res = await handleWhatsAppWebhook(req);
    assertEquals(res.status, 403);
  });

  await t.step("Invalid hub.mode returns 403 Forbidden", async () => {
    const url = `https://example.com/webhook?hub.mode=unknown&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=test_challenge`;
    const req = new Request(url, { method: "GET" });

    const res = await handleWhatsAppWebhook(req);
    assertEquals(res.status, 403);
  });
});

Deno.test("Test Suite 2: Webhook Security & Signatures (POST)", async (t) => {
  const dummyPayload = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [],
  });

  await t.step("POST without signature header returns 403 Forbidden", async () => {
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: dummyPayload,
    });

    const res = await handleWhatsAppWebhook(req);
    assertEquals(res.status, 403);
  });

  await t.step("POST with invalid signature returns 403 Forbidden", async () => {
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": "sha256=invalidhex0123456789abcdef",
      },
      body: dummyPayload,
    });

    const res = await handleWhatsAppWebhook(req);
    assertEquals(res.status, 403);
  });

  await t.step("POST with non-message event returns 200 OK without processing", async () => {
    const statusPayload = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_ID",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "27821234567",
                  phone_number_id: "100012345678901",
                },
                statuses: [
                  {
                    id: "wamid.delivery_receipt_123",
                    status: "delivered",
                    timestamp: "1727600000",
                    recipient_id: "27821234567",
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const sig = await computeTestSignature(statusPayload, APP_SECRET);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sig,
      },
      body: statusPayload,
    });

    const res = await handleWhatsAppWebhook(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "acknowledged");
  });
});

Deno.test("Test Suite 3: End-to-End Ingestion, Extraction & Idempotency", async () => {
  const testMessageId = `wamid.test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const phone = "+27821234567";

  const requisitionPayload = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID_100",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "27821234567",
                phone_number_id: "100012345678901",
              },
              contacts: [
                {
                  profile: { name: "Braam van der Merwe" },
                  wa_id: "27821234567",
                },
              ],
              messages: [
                {
                  from: "27821234567",
                  id: testMessageId,
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  type: "text",
                  text: { body: "Need 10 pockets cement for packhouse line 2" },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  const sig = await computeTestSignature(requisitionPayload, APP_SECRET);

  // 1. First Dispatch -> Ingestion succeeds
  const req1 = new Request("https://example.com/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": sig,
    },
    body: requisitionPayload,
  });

  const res1 = await handleWhatsAppWebhook(req1);
  assertEquals(res1.status, 200);
  const data1 = await res1.json();
  assertEquals(data1.success, true);
  assertNotEquals(data1.reference_code, undefined);
  assertEquals(data1.reference_code.startsWith("REQ-"), true);
  assertEquals(data1.items_captured >= 1, true);

  // 2. Second Dispatch with identical message ID -> Idempotent immediate 200 OK
  const req2 = new Request("https://example.com/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": sig,
    },
    body: requisitionPayload,
  });

  const res2 = await handleWhatsAppWebhook(req2);
  assertEquals(res2.status, 200);
  const data2 = await res2.json();
  assertEquals(data2.status, "idempotent_ok");
  assertEquals(data2.reference_code, data1.reference_code);

  // 3. Verify Database Persistence via Service Role Client
  const supabase = getServiceRoleClient();
  const { data: dbReq } = await supabase
    .from("requisitions")
    .select("id, reference_code, status, urgency, whatsapp_message_id, requisition_items(*)")
    .eq("whatsapp_message_id", testMessageId)
    .single();

  if (!dbReq) {
    throw new Error("Expected requisition to be found in database, but got null.");
  }
  assertEquals(dbReq.whatsapp_message_id, testMessageId);
  assertEquals(dbReq.status, "LOGGED");
  assertEquals(dbReq.requisition_items.length >= 1, true);

  // Cleanup test requisition
  await supabase.from("requisitions").delete().eq("id", dbReq.id);
});

Deno.test("Test Suite 4: Multi-Tenant Whitelist Invariants & Company Code Auto-Enrollment (ADR-0005)", async (t) => {
  const supabase = getServiceRoleClient();

  await t.step("Unknown phone number returns 200 OK friendly receipt without creating requisition or requester", async () => {
    const unknownPhone = `+2783${Math.floor(1000000 + Math.random() * 9000000)}`;
    const rawDigits = unknownPhone.replace(/^\+/, "");
    const testMessageId = `wamid.test_unknown_${Date.now()}`;

    const payload = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_ID_UNKNOWN",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "27821234567",
                  phone_number_id: "100012345678901",
                },
                contacts: [
                  {
                    profile: { name: "Unregistered Worker" },
                    wa_id: rawDigits,
                  },
                ],
                messages: [
                  {
                    from: rawDigits,
                    id: testMessageId,
                    timestamp: Math.floor(Date.now() / 1000).toString(),
                    type: "text",
                    text: { body: "Please send 5 rolls binding wire for fence repair" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const sig = await computeTestSignature(payload, APP_SECRET);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sig,
      },
      body: payload,
    });

    const res = await handleWhatsAppWebhook(req);
    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.success, true);
    assertEquals(data.unlinked, true);

    // Verify NO requester or requisition was created
    const { data: checkReq } = await supabase
      .from("requesters")
      .select("id")
      .eq("phone_number", unknownPhone)
      .maybeSingle();
    assertEquals(checkReq, null);

    const { data: checkRequisition } = await supabase
      .from("requisitions")
      .select("id")
      .eq("whatsapp_message_id", testMessageId)
      .maybeSingle();
    assertEquals(checkRequisition, null);
  });

  await t.step("Inbound 6-character Company Code auto-enrolls requester into tenant whitelist", async () => {
    const onboardingPhone = `+2784${Math.floor(1000000 + Math.random() * 9000000)}`;
    const rawDigits = onboardingPhone.replace(/^\+/, "");
    const testMessageId = `wamid.test_code_${Date.now()}`;

    const payload = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_ID_ONBOARD",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "27821234567",
                  phone_number_id: "100012345678901",
                },
                contacts: [
                  {
                    profile: { name: "Thabo Mokoena" },
                    wa_id: rawDigits,
                  },
                ],
                messages: [
                  {
                    from: rawDigits,
                    id: testMessageId,
                    timestamp: Math.floor(Date.now() / 1000).toString(),
                    type: "text",
                    text: { body: "APEX01" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const sig = await computeTestSignature(payload, APP_SECRET);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sig,
      },
      body: payload,
    });

    const res = await handleWhatsAppWebhook(req);
    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.success, true);
    assertEquals(data.onboarding, true);
    assertNotEquals(data.requester_id, undefined);

    // Verify requester was persisted with company_id and default site
    const { data: enrolledRequester } = await supabase
      .from("requesters")
      .select("id, name, phone_number, company_id, default_site_id, is_active")
      .eq("id", data.requester_id)
      .single();

    if (!enrolledRequester) {
      throw new Error("Expected auto-enrolled requester in database.");
    }
    assertEquals(enrolledRequester.name, "Thabo Mokoena");
    assertEquals(enrolledRequester.phone_number, onboardingPhone);
    assertEquals(enrolledRequester.is_active, true);
    assertNotEquals(enrolledRequester.company_id, null);

    // Clean up
    await supabase.from("requesters").delete().eq("id", enrolledRequester.id);
  });

  await t.step("Deactivated requester (is_active = false) returns 200 OK inactive alert without creating requisition", async () => {
    const inactivePhone = `+2785${Math.floor(1000000 + Math.random() * 9000000)}`;
    const rawDigits = inactivePhone.replace(/^\+/, "");
    const testMessageId = `wamid.test_inactive_${Date.now()}`;

    // Provision an inactive requester
    const defaultCompId = Deno.env.get("DEFAULT_COMPANY_ID") || "00000000-0000-0000-0000-000000000001";
    const { data: tempRequester, error: tempErr } = await supabase
      .from("requesters")
      .insert({
        company_id: defaultCompId,
        phone_number: inactivePhone,
        name: "Suspended Operator",
        role_title: "Former Field Hand",
        is_active: false,
      })
      .select("id")
      .single();

    if (tempErr || !tempRequester) {
      throw new Error(`Failed to create inactive requester fixture: ${tempErr?.message}`);
    }

    const payload = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_ID_INACTIVE",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "27821234567",
                  phone_number_id: "100012345678901",
                },
                contacts: [
                  {
                    profile: { name: "Suspended Operator" },
                    wa_id: rawDigits,
                  },
                ],
                messages: [
                  {
                    from: rawDigits,
                    id: testMessageId,
                    timestamp: Math.floor(Date.now() / 1000).toString(),
                    type: "text",
                    text: { body: "Need 2 new spanners urgently" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const sig = await computeTestSignature(payload, APP_SECRET);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sig,
      },
      body: payload,
    });

    const res = await handleWhatsAppWebhook(req);
    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.success, true);
    assertEquals(data.inactive, true);

    // Verify NO requisition was created
    const { data: checkRequisition } = await supabase
      .from("requisitions")
      .select("id")
      .eq("whatsapp_message_id", testMessageId)
      .maybeSingle();
    assertEquals(checkRequisition, null);

    // Clean up
    await supabase.from("requesters").delete().eq("id", tempRequester.id);
  });
});

Deno.test("Test Suite 5: 7-Day Duplicate Order Detection", async () => {
  const testMessageId = `wamid.test_duplicate_${Date.now()}`;
  const supabase = getServiceRoleClient();

  // In seed data, Ceres Packhouse Main has a prior requisition with:
  // "50mm PVC Ball Valve Schedule 80"
  const duplicatePayload = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID_300",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "27821234567",
                phone_number_id: "100012345678901",
              },
              contacts: [
                {
                  profile: { name: "Braam van der Merwe" },
                  wa_id: "27821234567",
                },
              ],
              messages: [
                {
                  from: "27821234567",
                  id: testMessageId,
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  type: "text",
                  text: {
                    body: "Need 2x 50mm PVC ball valves urgently for line repair",
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  const sig = await computeTestSignature(duplicatePayload, APP_SECRET);
  const req = new Request("https://example.com/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": sig,
    },
    body: duplicatePayload,
  });

  const res = await handleWhatsAppWebhook(req);
  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.success, true);
  // Duplicate check should identify prior 50mm PVC Ball Valve order
  assertEquals(data.is_duplicate_suspect, true);

  // Cleanup
  await supabase.from("requisitions").delete().eq("id", data.requisition_id);
});

Deno.test("Test Suite 6: Conversational Keyword Tracking (STATUS & REQ-...)", async (t) => {
  const supabase = getServiceRoleClient();

  await t.step("Inbound 'STATUS' inquiry returns open requests summary without creating requisition", async () => {
    const testMessageId = `wamid.test_status_${Date.now()}`;
    const payload = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_ID_400",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                messages: [
                  {
                    from: "27821234567",
                    id: testMessageId,
                    timestamp: Math.floor(Date.now() / 1000).toString(),
                    type: "text",
                    text: { body: "STATUS" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const sig = await computeTestSignature(payload, APP_SECRET);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sig,
      },
      body: payload,
    });

    const res = await handleWhatsAppWebhook(req);
    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.success, true);
    assertEquals(data.tracking_query, true);

    // Verify NO new requisition was inserted for this message ID
    const { data: noReq } = await supabase
      .from("requisitions")
      .select("id")
      .eq("whatsapp_message_id", testMessageId)
      .maybeSingle();

    assertEquals(noReq, null);
  });

  await t.step("Inbound specific ref 'REQ-2610-1001' queries that requisition status", async () => {
    const testMessageId = `wamid.test_ref_query_${Date.now()}`;
    const payload = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_ID_401",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                messages: [
                  {
                    from: "27821234567",
                    id: testMessageId,
                    timestamp: Math.floor(Date.now() / 1000).toString(),
                    type: "text",
                    text: { body: "REQ-2610-1001" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const sig = await computeTestSignature(payload, APP_SECRET);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sig,
      },
      body: payload,
    });

    const res = await handleWhatsAppWebhook(req);
    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.success, true);
    assertEquals(data.tracking_query, true);
    assertEquals(data.reference_code, "REQ-2610-1001");
  });
});

Deno.test("Test Suite 7: Internal Delivery Alert Action", async () => {
  const supabase = getServiceRoleClient();
  const { data: seedReq } = await supabase
    .from("requisitions")
    .select("id, reference_code")
    .eq("reference_code", "REQ-2610-1001")
    .single();

  if (!seedReq) {
    throw new Error("Expected seed requisition REQ-2610-1001 to exist.");
  }

  const payload = JSON.stringify({
    action: "delivery_alert",
    requisition_id: seedReq.id,
  });

  const req = new Request("https://example.com/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: payload,
  });

  const res = await handleWhatsAppWebhook(req);
  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.reference_code, seedReq.reference_code);
});

Deno.test("Test Suite 8: Dynamic Multi-Tier Location Hierarchy", async () => {
  const supabase = getServiceRoleClient();
  const testMessageId = `wamid.test_loc_${Date.now()}`;
  const testPhone = "+27829990001";
  const rawDigits = "27829990001";

  // Pre-seed requester for whitelist validation
  const { data: defaultComp } = await supabase.from("companies").select("id").limit(1).single();
  if (!defaultComp) throw new Error("No company found for test");
  const { error: seedErr } = await supabase.from("requesters").upsert({
    company_id: defaultComp.id,
    phone_number: testPhone,
    name: "Jan de Wet",
    role_title: "Packhouse Engineer",
    is_active: true,
  }, { onConflict: "company_id,phone_number" });
  if (seedErr) throw new Error(`Failed to seed test requester: ${seedErr.message}`);

  const payload = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID_LOC",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "27821234567",
                phone_number_id: "100012345678901",
              },
              contacts: [
                {
                  profile: { name: "Jan de Wet" },
                  wa_id: rawDigits,
                },
              ],
              messages: [
                {
                  from: rawDigits,
                  id: testMessageId,
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  type: "text",
                  text: { body: "Urgent: Need 4 roller bearings for Elgin Valley Orchard in Packhouse Line 1 (Sizer Unit 4)" },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  const sig = await computeTestSignature(payload, APP_SECRET);
  const req = new Request("https://example.com/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": sig,
    },
    body: payload,
  });

  const res = await handleWhatsAppWebhook(req);
  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.success, true);

  // Verify DB state
  const { data: dbReq } = await supabase
    .from("requisitions")
    .select("id, site_id, zone_id, location_detail, site:sites(name), zone:zones(name)")
    .eq("id", data.requisition_id)
    .single();

  if (!dbReq) {
    throw new Error("Expected requisition to be found in database.");
  }
  // Ensure location was resolved
  assertNotEquals(dbReq.site_id, null);

  // Clean up
  await supabase.from("requisitions").delete().eq("id", data.requisition_id);
  await supabase.from("requesters").delete().eq("phone_number", testPhone);
});

Deno.test("Test Suite 9: Automatic Requester Profile Resolution", async () => {
  const supabase = getServiceRoleClient();
  const testPhone = "+27828880002";
  const rawDigits = "27828880002";
  const testMessageId = `wamid.test_profile_${Date.now()}`;

  // First create requester with placeholder name
  const { data: defaultComp } = await supabase.from("companies").select("id").limit(1).single();
  if (!defaultComp) throw new Error("No company found for test");
  const { data: testReq } = await supabase.from("requesters").insert({
    company_id: defaultComp.id,
    phone_number: testPhone,
    name: "Field Requester",
    role_title: "Field Requester",
    is_active: true,
  }).select("id, name").single();

  if (!testReq) {
    throw new Error("Failed to seed initial requester for test");
  }

  // Send a webhook message from this phone with profile name "Charlize Joubert"
  const payload = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID_PROFILE",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "27821234567",
                phone_number_id: "100012345678901",
              },
              contacts: [
                {
                  profile: { name: "Charlize Joubert" },
                  wa_id: rawDigits,
                },
              ],
              messages: [
                {
                  from: rawDigits,
                  id: testMessageId,
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  type: "text",
                  text: { body: "Need 20 safety goggles" },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  const sig = await computeTestSignature(payload, APP_SECRET);
  const req = new Request("https://example.com/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": sig,
    },
    body: payload,
  });

  const res = await handleWhatsAppWebhook(req);
  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.success, true);

  // Check that requester's name in DB was updated from "Field Requester" to "Charlize Joubert"
  const { data: updatedReq } = await supabase
    .from("requesters")
    .select("id, name")
    .eq("id", testReq.id)
    .single();

  assertEquals(updatedReq?.name, "Charlize Joubert");

  // Clean up
  await supabase.from("requisitions").delete().eq("id", data.requisition_id);
  await supabase.from("requesters").delete().eq("id", testReq.id);
});

Deno.test("Test Suite 10: Tightened Duplicate Detection (No False Positives on Hardware Stopwords)", async () => {
  const supabase = getServiceRoleClient();
  const testMessageId = `wamid.test_tight_dup_${Date.now()}`;

  // In Ceres Packhouse, prior orders contain PVC ball valves, PVC elbows, grease, belts.
  // Here we request HDPE dripper pipe with end plugs.
  // Generic stopwords like "pipe", "unit", "plastic" are filtered out.
  const payload = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID_TIGHT_DUP",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "27821234567",
                phone_number_id: "100012345678901",
              },
              contacts: [
                {
                  profile: { name: "Braam van der Merwe" },
                  wa_id: "27821234567",
                },
              ],
              messages: [
                {
                  from: "27821234567",
                  id: testMessageId,
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  type: "text",
                  text: { body: "Please order 100m of 16mm HDPE dripper pipe with end plugs" },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  const sig = await computeTestSignature(payload, APP_SECRET);
  const req = new Request("https://example.com/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": sig,
    },
    body: payload,
  });

  const res = await handleWhatsAppWebhook(req);
  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.success, true);
  // Must NOT be marked as duplicate suspect
  assertEquals(data.is_duplicate_suspect, false);

  // Clean up
  await supabase.from("requisitions").delete().eq("id", data.requisition_id);
});

Deno.test("Test Suite 11: High-Readability Industrial Card Templates & Formatting Helpers", async (t) => {
  await t.step("Quantity formatting helper handles multipliers, non-standard units, and ignores generic units", () => {
    // Generic units are excluded (never render "1 units" or trailing plural bugs)
    assertEquals(formatQuantityItem(1, "Water Pump Pliers", "unit"), "1x Water Pump Pliers");
    assertEquals(formatQuantityItem(1, "Water Pump Pliers", "units"), "1x Water Pump Pliers");
    assertEquals(formatQuantityItem(5, "Steel hex bolts", "each"), "5x Steel hex bolts");
    assertEquals(formatQuantityItem(2, "Brass nipple", "pcs"), "2x Brass nipple");
    assertEquals(formatQuantityItem(1, "Angle grinder", null), "1x Angle grinder");

    // Non-standard units are capitalized and parenthesized
    assertEquals(
      formatQuantityItem(3, "PTFE Thread Seal Tape", "rolls"),
      "3x PTFE Thread Seal Tape (Rolls)"
    );
    assertEquals(
      formatQuantityItem(1, "PVC 90° Elbow", "30mm"),
      "1x PVC 90° Elbow (30mm)"
    );
    assertEquals(
      formatQuantityItem(10, "Portland Cement", "bags"),
      "10x Portland Cement (Bags)"
    );

    // If unit is already in description, do not duplicate
    assertEquals(
      formatQuantityItem(3, "Thread Seal Tape (Rolls)", "rolls"),
      "3x Thread Seal Tape (Rolls)"
    );
  });

  await t.step("Location formatting helper joins segments with middle dots and filters duplicates/empties", () => {
    // 3 tiers
    assertEquals(
      formatLocation("Ceres Packhouse Main", "Workshop Bay 3", "Compressor Room B"),
      "Ceres Packhouse Main • Workshop Bay 3 • Compressor Room B"
    );

    // Deduplication when zone and detail match
    assertEquals(
      formatLocation("Ceres Packhouse Main", "Cold Room 2", "Cold Room 2"),
      "Ceres Packhouse Main • Cold Room 2"
    );

    // Filter null/undefined/empty
    assertEquals(
      formatLocation("Ceres Packhouse Main", null, undefined),
      "Ceres Packhouse Main"
    );
    assertEquals(
      formatLocation(null, "Cold Room 2", ""),
      "Cold Room 2"
    );
    assertEquals(
      formatLocation("", null, undefined),
      "Unassigned Site"
    );
  });

  await t.step("Template A: Order Confirmation (Receipt) formats exact layout with divider and optional duplicate alert", () => {
    const mockExtraction = {
      items: [
        { quantity: 1, item_description: "PVC 90° Elbow (30mm)", unit_of_measure: "unit" },
        { quantity: 3, item_description: "PTFE Thread Seal Tape", unit_of_measure: "rolls" },
        { quantity: 1, item_description: "Water Pump Pliers", unit_of_measure: "unit" },
      ],
      urgency: "URGENT" as const,
      confidence_score: 0.95,
      clarification_needed: null,
    };

    const loc = formatLocation("Ceres Packhouse Main", "Cold Room 2", null);

    // Non-duplicate receipt
    const receipt = formatConfirmationMessage("REQ-2610-1015", loc, mockExtraction, false);
    assertEquals(
      receipt.includes("📋 ORDER LOGGED • REQ-2610-1015"),
      true
    );
    assertEquals(
      receipt.includes("• 1x PVC 90° Elbow (30mm)\n• 3x PTFE Thread Seal Tape (Rolls)\n• 1x Water Pump Pliers"),
      true
    );
    assertEquals(
      receipt.includes("📍 Location: Ceres Packhouse Main • Cold Room 2"),
      true
    );
    assertEquals(
      receipt.includes("⚡ Urgency: Urgent"),
      true
    );
    assertEquals(
      receipt.includes("⏱ Status: In Review"),
      true
    );
    assertEquals(
      receipt.includes("────────────────\nReply STATUS to track your open orders."),
      true
    );
    assertEquals(
      receipt.includes("⚠️ Note: Similar items were ordered"),
      false
    );

    // Duplicate suspect receipt
    const duplicateReceipt = formatConfirmationMessage("REQ-2610-1015", loc, mockExtraction, true);
    assertEquals(
      duplicateReceipt.includes("⚠️ Note: Similar items were ordered for this site within 7 days."),
      true
    );
    assertEquals(
      duplicateReceipt.includes("⚠️ Note: Similar items were ordered for this site within 7 days.\n\n────────────────"),
      true
    );
  });

  await t.step("Template B: Active Orders Tracking (STATUS) formats itemized cards with nested line items", () => {
    const activeOrders = [
      {
        reference_code: "REQ-2610-1015",
        status: "LOGGED",
        formatted_location: "Ceres Packhouse Main • Cold Room 2",
        items: [
          { quantity: 1, item_description: "PVC 90° Elbow (30mm)", unit_of_measure: "unit" },
          { quantity: 3, item_description: "PTFE Thread Seal Tape", unit_of_measure: "rolls" },
        ],
      },
      {
        reference_code: "REQ-2610-1001",
        status: "PO_PLACED",
        formatted_location: "Ceres Packhouse Main • Cold Room 2",
        items: [
          { quantity: 2, item_description: "50mm PVC Ball Valve Schedule 80", unit_of_measure: "unit" },
        ],
      },
    ];

    const reply = formatStatusTrackingReply(activeOrders);
    assertEquals(
      reply.includes("📦 YOUR ACTIVE ORDERS (2)"),
      true
    );
    assertEquals(
      reply.includes("REQ-2610-1015 • In Review\n📍 Ceres Packhouse Main • Cold Room 2\n  - 1x PVC 90° Elbow (30mm)\n  - 3x PTFE Thread Seal Tape (Rolls)"),
      true
    );
    assertEquals(
      reply.includes("REQ-2610-1001 • PO Placed\n📍 Ceres Packhouse Main • Cold Room 2\n  - 2x 50mm PVC Ball Valve Schedule 80"),
      true
    );
    assertEquals(
      reply.includes("────────────────\nReply with an order number (e.g. REQ-2610-1015) for details."),
      true
    );
  });

  await t.step("Template C: Delivery Arrival Alert (DELIVERED_TO_SITE) formats collection card", () => {
    const loc = formatLocation("Ceres Packhouse Main", "Cold Room 2", null);
    const items = [
      { quantity: 1, item_description: "PVC 90° Elbow (30mm)", unit_of_measure: "unit" },
      { quantity: 3, item_description: "PTFE Thread Seal Tape", unit_of_measure: "rolls" },
    ];

    const alert = formatDeliveryAlertMessage("REQ-2610-1015", loc, items);
    assertEquals(
      alert.includes("🚚 ORDER ARRIVED • REQ-2610-1015"),
      true
    );
    assertEquals(
      alert.includes("Your requested items have been delivered to site:\n• 1x PVC 90° Elbow (30mm)\n• 3x PTFE Thread Seal Tape (Rolls)"),
      true
    );
    assertEquals(
      alert.includes("📍 Collection: Ceres Packhouse Main • Cold Room 2 (Site Office)"),
      true
    );
    assertEquals(
      alert.includes("Please inspect and collect your items."),
      true
    );
  });
});



