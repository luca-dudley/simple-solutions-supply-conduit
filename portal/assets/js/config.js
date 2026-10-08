/**
 * config.js
 * Supabase configuration and session context utilities for Supply Conduit Office Portal
 * Adheres strictly to ADR-0005 multi-tenant isolation and fail-closed security.
 */

(function (window) {
  // Public Client Configuration (Safe for browser delivery; service keys strictly prohibited)
  const DEFAULT_SUPABASE_URL = "https://wtaewaeqmcqrwradlncj.supabase.co";
  const DEFAULT_SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0YWV3YWVxbWNxcndyYWRsbmNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2ODc1OTUsImV4cCI6MjEwNjI2MzU5NX0.E2CPpA9_UajhtHtpYsnjRWVnj5nrEk2HuFnx7bWikdw";

  // Host-based switching or runtime overrides
  const isLocal = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  const SUPABASE_URL = (isLocal && localStorage.getItem("sc_supabase_url")) || DEFAULT_SUPABASE_URL;
  const SUPABASE_ANON_KEY = (isLocal && localStorage.getItem("sc_supabase_anon_key")) || DEFAULT_SUPABASE_ANON_KEY;

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
          detectSessionInUrl: true,
        },
      });
    }
    return supabaseClient;
  }

  function getStoredUserProfile() {
    try {
      const data = localStorage.getItem("sc_user_profile");
      return data ? JSON.parse(data) : null;
    } catch (_) {
      return null;
    }
  }

  function setStoredUserProfile(profile) {
    if (profile) {
      localStorage.setItem("sc_user_profile", JSON.stringify(profile));
    } else {
      localStorage.removeItem("sc_user_profile");
    }
  }

  function clearSession() {
    localStorage.removeItem("sc_user_profile");
    localStorage.removeItem("sc_demo_session");
  }

  window.AppConfig = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    getSupabase,
    getStoredUserProfile,
    setStoredUserProfile,
    clearSession,
  };
})(typeof window !== "undefined" ? window : globalThis);
