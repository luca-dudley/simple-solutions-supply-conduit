/**
 * Gemini Structured Extraction Engine for Southern African Requisitions
 * Conforms to ADR-0002, ADR-0003, and User Requirements.
 */

import {
  ExtractedLineItemContract,
  StructuredRequisitionExtraction,
  UrgencyLevel,
} from "./types.ts";

export const SOUTH_AFRICAN_INDUSTRIAL_PROMPT = `You are an expert procurement and supply-chain parsing assistant for Southern African operational job sites, civil works, and agricultural packhouses.
Parse the user's requisition message or voice transcript into structured JSON matching the provided schema.

Rules:
1. Normalize item descriptions using standard South African industrial terminology.
   Examples:
   - "pocket of cement" / "sakke sement" -> "Cement 50kg Bags"
   - "50 mil brass valve" / "klapklep" -> "Brass Gate Valve 50mm PN16"
   - "binding wire" / "draad" -> "Binding Wire 1.6mm 50kg Roll"
   - "rebar" / "Y12" / "Y16 steel" -> "High Tensile Deformed Rebar Y12 / Y16"
   - "crushed stone" / "G5 gravel" -> "G5 Sub-base Gravel"
   - "polypipe" / "HDPE 63mm" -> "HDPE Pipe Class 10 / 12"
   - "ammonia leak valve" -> "Ammonia Service Ball Valve"
   - "V-belt" -> "Industrial V-Belt"
   - "cartridges grease" -> "Lithium EP2 Grease Cartridge 400g"
2. Normalize unit of measure:
   - Use standard units: "units", "meters", "kg", "bags", "rolls", "boxes", "litres", "cartridges".
3. Detect Urgency:
   - CRITICAL_BREAKDOWN: Harvest or packing line stopped, main water pump failed, main generator off, flood/leak emergency, active civil halt.
   - URGENT: Needed urgently within 24 hours to prevent work stoppage.
   - ROUTINE: Standard weekly replenishment or routine scheduled maintenance.
4. Multi-Facility & Location Extraction:
   - site_name: Macro facility, farm, estate, packhouse complex, or depot mentioned (e.g., "Ceres Packhouse", "Kouebokkeveld Estate", "Lichtenburg Farm"). Return null if unspecified.
   - zone_name: Functional hub, building, or operational zone (e.g., "Cold Storage", "Workshop", "Packhouse Line 2", "Pump Station 4", "Chemical Shed", "Fertilizer Bay"). Return null if unspecified.
   - location_detail: Specific granular room, bay, chamber, or asset callout (e.g., "Cold Room 2", "Tractor Bay 5", "Compressor A", "Borehole 3"). Return null if unspecified.
5. Confidence Score:
   - Provide a confidence_score between 0.0 and 1.0 reflecting how clearly items, quantities, and descriptions were specified.
6. Clarification Needed:
   - If quantities or specific part sizes/numbers are missing, or the message is ambiguous, specify what needs clarification in clarification_needed. Otherwise return null.`;

export const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          item_description: { type: "STRING" },
          quantity: { type: "NUMBER" },
          unit_of_measure: { type: "STRING" },
          part_number: { type: "STRING", nullable: true },
        },
        required: ["item_description", "quantity", "unit_of_measure"],
      },
    },
    urgency: {
      type: "STRING",
      enum: ["ROUTINE", "URGENT", "CRITICAL_BREAKDOWN"],
    },
    site_name: {
      type: "STRING",
      nullable: true,
      description: "Macro facility or farm property name if mentioned",
    },
    zone_name: {
      type: "STRING",
      nullable: true,
      description: "Functional hub or operational zone if mentioned",
    },
    location_detail: {
      type: "STRING",
      nullable: true,
      description: "Granular room, bay, or machine identifier if mentioned",
    },
    confidence_score: { type: "NUMBER" },
    clarification_needed: { type: "STRING", nullable: true },
  },
  required: ["items", "urgency", "confidence_score"],
};

/**
 * Encodes Uint8Array into Base64 safely without call stack limit overflows.
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * Rule-based fallback extractor for cases where Gemini API is unavailable or offline.
 */
export function heuristicExtractRequisition(
  text: string
): StructuredRequisitionExtraction {
  const lower = text.toLowerCase();

  // Detect urgency
  let urgency: UrgencyLevel = "ROUTINE";
  if (
    lower.includes("critical") ||
    lower.includes("breakdown") ||
    lower.includes("stopped") ||
    lower.includes("halt") ||
    lower.includes("emergency") ||
    lower.includes("ammonia leak")
  ) {
    urgency = "CRITICAL_BREAKDOWN";
  } else if (
    lower.includes("urgent") ||
    lower.includes("urgently") ||
    lower.includes("asap") ||
    lower.includes("today") ||
    lower.includes("24 hour")
  ) {
    urgency = "URGENT";
  }

  // Detect South African terminology
  const items: ExtractedLineItemContract[] = [];

  // Match cement: e.g. "10 pockets cement" or "5 sakke sement"
  const cementMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:pockets?|sakke?|bags?)?\s*(?:of\s*)?(?:cement|sement)/i);
  if (cementMatch) {
    items.push({
      item_description: "Cement 50kg Bags",
      quantity: parseFloat(cementMatch[1]) || 1,
      unit_of_measure: "bags",
      part_number: null,
    });
  }

  // Match valves: e.g. "2x 50mm PVC ball valves" or "brass valve"
  const valveMatch = lower.match(/(\d+(?:\.\d+)?)\s*x?\s*([0-9]+mm)?\s*(?:pvc|brass)?\s*(?:ball|gate)?\s*valves?/i);
  if (valveMatch && !lower.includes("cement only")) {
    const size = valveMatch[2] ? ` ${valveMatch[2]}` : "";
    items.push({
      item_description: `Ball Valve${size}`,
      quantity: parseFloat(valveMatch[1]) || 1,
      unit_of_measure: "units",
      part_number: null,
    });
  }

  // Match V-belts: e.g. "4x V-Belt B68"
  const beltMatch = lower.match(/(\d+(?:\.\d+)?)\s*x?\s*v-?belts?\s*([a-z0-9]+)?/i);
  if (beltMatch) {
    items.push({
      item_description: `Industrial V-Belt${beltMatch[2] ? ` ${beltMatch[2].toUpperCase()}` : ""}`,
      quantity: parseFloat(beltMatch[1]) || 1,
      unit_of_measure: "units",
      part_number: beltMatch[2]?.toUpperCase() || null,
    });
  }

  // Match grease: e.g. "5x Lithium EP2 Grease cartridges"
  const greaseMatch = lower.match(/(\d+(?:\.\d+)?)\s*x?\s*(?:lithium\s*)?(?:ep2\s*)?grease\s*(?:cartridges?)?/i);
  if (greaseMatch) {
    items.push({
      item_description: "Lithium EP2 Grease Cartridge 400g",
      quantity: parseFloat(greaseMatch[1]) || 1,
      unit_of_measure: "cartridges",
      part_number: "EP2-400G",
    });
  }

  // Default fallback if no specific pattern matched
  if (items.length === 0) {
    const qtyMatch = text.match(/\b(\d+(?:\.\d+)?)\b/);
    const quantity = qtyMatch ? parseFloat(qtyMatch[1]) : 1;
    items.push({
      item_description: text.trim().slice(0, 120),
      quantity: quantity > 0 ? quantity : 1,
      unit_of_measure: "units",
      part_number: null,
    });
  }

  let site_name: string | null = null;
  let zone_name: string | null = null;
  let location_detail: string | null = null;

  const coldRoomMatch = text.match(/\b(cold\s*room\s*\d+)\b/i);
  if (coldRoomMatch) {
    zone_name = coldRoomMatch[1].replace(/\b\w/g, (c) => c.toUpperCase());
    location_detail = zone_name;
  }
  const packhouseMatch = text.match(/\b(packhouse(?:\s*line\s*\d+)?)\b/i);
  if (packhouseMatch) {
    zone_name = packhouseMatch[1].replace(/\b\w/g, (c) => c.toUpperCase());
  }
  const workshopMatch = text.match(/\b(workshop(?:\s*shed\s*[a-z0-9]+)?)\b/i);
  if (workshopMatch) {
    zone_name = workshopMatch[1].replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const isHeuristicFallback =
    items.length === 1 && items[0].item_description === text.trim().slice(0, 120);
  const confidenceScore = isHeuristicFallback ? 0.4 : 0.85;

  return {
    items,
    urgency,
    site_name,
    zone_name,
    location_detail,
    confidence_score: confidenceScore,
    clarification_needed: isHeuristicFallback
      ? "Could not fully parse specific line items; please confirm part specifications."
      : null,
  };
}

/**
 * Extracts structured requisition items via Google Gemini API.
 * Uses gemini-3.8-flash as the primary default model with automatic fallback.
 */
export async function extractWithGemini(
  content: { text?: string; audio?: { data: Uint8Array; mimeType: string } }
): Promise<StructuredRequisitionExtraction> {
  const apiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("LLM_API_KEY");
  const rawText = content.text || "";

  if (!apiKey) {
    console.warn("[Gemini] GEMINI_API_KEY not found; using heuristic extraction.");
    return heuristicExtractRequisition(rawText || "Field requisition");
  }

  // Models to attempt: primary is gemini-3.8-flash as specified by user requirements
  const modelCandidates = [
    "gemini-3.8-flash",
    "gemini-flash-latest",
    "gemini-3.7-flash",
  ];

  // Construct parts
  const userParts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [];

  if (content.audio) {
    userParts.push({
      inline_data: {
        mime_type: content.audio.mimeType || "audio/ogg",
        data: uint8ArrayToBase64(content.audio.data),
      },
    });
    userParts.push({
      text: "Transcribe the audio note and extract the requisition items according to the schema.",
    });
  } else if (rawText) {
    userParts.push({ text: rawText });
  } else {
    return heuristicExtractRequisition("General field requisition");
  }

  const requestBody = {
    system_instruction: {
      parts: [{ text: SOUTH_AFRICAN_INDUSTRIAL_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts: userParts,
      },
    ],
    generationConfig: {
      response_mime_type: "application/json",
      response_schema: GEMINI_RESPONSE_SCHEMA,
    },
  };

  for (const model of modelCandidates) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(4000),
      });

      if (!res.ok) {
        const errBody = await res.text();
        console.warn(`[Gemini] Model ${model} returned HTTP ${res.status}: ${errBody.slice(0, 150)}`);
        // If 404, 429, or 503, try next candidate
        continue;
      }

      const resJson = await res.json();
      const candidateText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!candidateText) {
        console.warn(`[Gemini] Empty candidate text from ${model}`);
        continue;
      }

      // Clean possible markdown code fence
      const cleanJson = candidateText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      const parsed = JSON.parse(cleanJson);

      // Validate required fields
      if (Array.isArray(parsed.items) && parsed.items.length > 0 && parsed.urgency) {
        return {
          items: parsed.items.map((item: ExtractedLineItemContract) => ({
            item_description: String(item.item_description || "Requisition Item").trim(),
            quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
            unit_of_measure: String(item.unit_of_measure || "units").trim(),
            part_number: item.part_number ? String(item.part_number).trim() : null,
            notes: item.notes ? String(item.notes).trim() : null,
          })),
          urgency: (["ROUTINE", "URGENT", "CRITICAL_BREAKDOWN"].includes(parsed.urgency)
            ? parsed.urgency
            : "ROUTINE") as UrgencyLevel,
          urgency_reason: parsed.urgency_reason || null,
          site_name: parsed.site_name ? String(parsed.site_name).trim() : null,
          zone_name: parsed.zone_name ? String(parsed.zone_name).trim() : null,
          location_detail: parsed.location_detail ? String(parsed.location_detail).trim() : null,
          confidence_score: typeof parsed.confidence_score === "number" ? parsed.confidence_score : 0.85,
          clarification_needed: parsed.clarification_needed || null,
        };
      }
    } catch (err) {
      console.warn(`[Gemini] Attempt on ${model} failed with exception:`, (err as Error).message);
    }
  }

  // If all models failed, use heuristic extraction
  console.warn("[Gemini] All Gemini model attempts failed; falling back to heuristic extraction.");
  return heuristicExtractRequisition(rawText);
}
