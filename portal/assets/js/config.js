/**
 * config.js
 * Supabase configuration and session utilities for Supply Conduit Office Portal
 */

(function (window) {
  // Public Client Configuration (Safe for browser delivery; service keys strictly prohibited)
  const DEFAULT_SUPABASE_URL = "https://wtaewaeqmcqrwradlncj.supabase.co";
  const DEFAULT_SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0YWV3YWVxbWNxcndyYWRsbmNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2ODc1OTUsImV4cCI6MjEwNjI2MzU5NX0.E2CPpA9_UajhtHtpYsnjRWVnj5nrEk2HuFnx7bWikdw";
  const DEFAULT_COMPANY_ID = "00000000-0000-0000-0000-000000000001";

  // Allow runtime override via localStorage if configured in settings
  const SUPABASE_URL = localStorage.getItem("sc_supabase_url") || DEFAULT_SUPABASE_URL;
  const SUPABASE_ANON_KEY = localStorage.getItem("sc_supabase_anon_key") || DEFAULT_SUPABASE_ANON_KEY;
  const COMPANY_ID = localStorage.getItem("sc_company_id") || DEFAULT_COMPANY_ID;

  let supabaseClient = null;

  function getSupabase() {
    if (!supabaseClient) {
      if (typeof window.supabase === "undefined" || !window.supabase.createClient) {
        console.error("Supabase JS SDK not loaded.");
        return null;
      }
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
      });
    }
    return supabaseClient;
  }

  function isDemoSession() {
    return localStorage.getItem("sc_demo_session") === "true";
  }

  function setDemoSession(enabled) {
    if (enabled) {
      localStorage.setItem("sc_demo_session", "true");
      localStorage.setItem("sc_user_email", "buyer.relief@apexops.co.za");
    } else {
      localStorage.removeItem("sc_demo_session");
      localStorage.removeItem("sc_user_email");
    }
  }

  function getActiveUserEmail() {
    return localStorage.getItem("sc_user_email") || "admin@apexops.co.za";
  }

  window.AppConfig = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    COMPANY_ID,
    getSupabase,
    isDemoSession,
    setDemoSession,
    getActiveUserEmail,
  };
})(typeof window !== "undefined" ? window : globalThis);
