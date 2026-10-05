/**
 * Edge Function: notify-field-manager
 * Dispatches automated field notifications when a requisition status updates.
 * Conforms to ADR-0003 Section 3 & Operational Tracker Specification.
 */

import { getServiceRoleClient } from "../_shared/supabaseClient.ts";
import {
  formatDeliveryAlertMessage,
  formatLocation,
  sendWhatsAppTextMessage,
} from "../_shared/whatsapp.ts";

export async function handleNotifyFieldManager(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const record = body.record || body;
    const oldRecord = body.old_record || null;

    // Check if status changed to DELIVERED_TO_SITE
    const targetStatus = record.status;
    const previousStatus = oldRecord ? oldRecord.status : null;

    if (previousStatus && targetStatus === previousStatus) {
      return new Response(JSON.stringify({ message: "Status unchanged, no notification needed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const requisitionId = record.id;
    if (!requisitionId) {
      return new Response(JSON.stringify({ error: "Missing requisition id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = getServiceRoleClient();
    const { data: requisition, error } = await supabase
      .from("requisitions")
      .select(`
        id, reference_code, status, site_id, requester_id, location_detail,
        site:sites(name),
        zone:zones(name),
        requester:requesters(phone_number, name),
        items:requisition_items(item_description, quantity, unit_of_measure)
      `)
      .eq("id", requisitionId)
      .single();

    if (error || !requisition) {
      return new Response(JSON.stringify({ error: "Requisition not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const recipientPhone = requisition.requester?.phone_number;
    if (!recipientPhone) {
      return new Response(JSON.stringify({ message: "No phone number for requester" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const loc = formatLocation(
      (requisition.site as any)?.name,
      (requisition.zone as any)?.name,
      requisition.location_detail
    );

    let alertMessage = "";
    if (targetStatus === "DELIVERED_TO_SITE") {
      alertMessage = formatDeliveryAlertMessage(
        requisition.reference_code,
        loc,
        requisition.items || []
      );
    } else if (targetStatus === "PO_PLACED") {
      alertMessage = `📋 *Purchase Order Placed: ${requisition.reference_code}*\nYour order has been approved and placed with supplier. Delivery to site pending.`;
    } else {
      return new Response(JSON.stringify({ message: `No notification configured for status ${targetStatus}` }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const dispatchResult = await sendWhatsAppTextMessage(recipientPhone, alertMessage);
    return new Response(
      JSON.stringify({
        success: dispatchResult.success,
        reference_code: requisition.reference_code,
        recipient: recipientPhone,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[notify-field-manager] Error processing event:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

if (import.meta.main) {
  Deno.serve(handleNotifyFieldManager);
}
