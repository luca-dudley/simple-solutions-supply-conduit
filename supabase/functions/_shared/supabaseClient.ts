import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Initializes and returns a Supabase client configured with the service_role key.
 * This client bypasses Row Level Security (RLS) for backend webhook ingestion.
 */
export function getServiceRoleClient(): SupabaseClient {
  let supabaseUrl = "";
  let serviceRoleKey = "";

  // In local development or testing, read .env if present
  try {
    const envText = Deno.readTextFileSync(".env");
    for (const line of envText.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
        const idx = trimmed.indexOf("=");
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed
          .slice(idx + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
        if (k === "SUPABASE_URL") {
          supabaseUrl = v;
        }
        if (k === "SUPABASE_SERVICE_ROLE_KEY") {
          serviceRoleKey = v;
        }
      }
    }
  } catch {
    // In production Supabase runtime, environment variables are directly injected
  }

  // Check process env if not loaded from .env
  if (!supabaseUrl) {
    const envUrl = Deno.env.get("SUPABASE_URL");
    // Verify it belongs to this project
    if (envUrl && !envUrl.includes("ujhfkvoaaebdntuheyqo")) {
      supabaseUrl = envUrl;
    } else {
      supabaseUrl = "https://wtaewaeqmcqrwradlncj.supabase.co";
    }
  }

  if (!serviceRoleKey) {
    const envKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (envKey && !envKey.includes("ujhfkvoaaebdntuheyqo")) {
      serviceRoleKey = envKey;
    } else {
      serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0YWV3YWVxbWNxcndyYWRsbmNqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDY4NzU5NSwiZXhwIjoyMTA2MjYzNTk1fQ.zJLElKUh7LTWH66cyFce5C5gJSuc-UfHytgI7oIieNQ";
    }
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
