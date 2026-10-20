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
    try {
      localStorage.removeItem("sc_user_profile");
      localStorage.removeItem("sc_demo_session");
      // Thoroughly purge all Supabase auth storage tokens
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith("sb-") || key.startsWith("sc_") || key.includes("supabase"))) {
          if (key === "sc_supabase_url" || key === "sc_supabase_anon_key") continue;
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.clear();
      }
    } catch (e) {
      console.warn("Failed to clear session:", e);
    }
  }

  async function handleSignOut(event) {
    if (event) {
      if (typeof event.preventDefault === "function") event.preventDefault();
      if (typeof event.stopPropagation === "function") event.stopPropagation();
    }
    const profileDropdown = document.getElementById("profileDropdownMenu");
    if (profileDropdown) {
      profileDropdown.classList.add("hidden");
    }

    // 1. Immediately wipe all local tokens and session data so client is 100% signed out
    clearSession();
    try {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.clear();
      }
    } catch (_) {}

    // 2. Best-effort Supabase signout (local scope to instantly drop session without waiting on network lock)
    try {
      const client = getSupabase();
      if (client && client.auth) {
        await Promise.race([
          client.auth.signOut({ scope: "local" }),
          new Promise((resolve) => setTimeout(resolve, 500))
        ]);
      }
    } catch (err) {
      console.warn("Sign out background error:", err);
    }

    // 3. Immediately redirect to sign in view
    window.location.replace("index.html");
  }

  window.handleSignOut = handleSignOut;

  window.AppConfig = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    getSupabase,
    getStoredUserProfile,
    setStoredUserProfile,
    clearSession,
    handleSignOut,
  };
})(typeof window !== "undefined" ? window : globalThis);
