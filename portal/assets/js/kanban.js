/**
 * kanban.js
 * Master Operational Tracker & Kanban Pipeline Controller for Supply Conduit
 * Real-time PostgREST sync, HTML5 drag-and-drop, 14-day archival, automated delivery alerts,
 * fail-closed multi-tenant RLS session guards, and field team whitelist management (ADR-0005).
 */

(function () {
  // Column definitions matching the state machine
  const COLUMNS = ["LOGGED", "PENDING_QUOTE", "PO_PLACED", "DELIVERED_TO_SITE", "CLOSED"];

  const NEXT_STATUS = {
    LOGGED: { next: "PENDING_QUOTE", label: "Request Quotes", icon: "arrow-right" },
    PENDING_QUOTE: { next: "PO_PLACED", label: "Place PO", icon: "check-circle" },
    PO_PLACED: { next: "DELIVERED_TO_SITE", label: "Mark Delivered", icon: "truck" },
    DELIVERED_TO_SITE: { next: "CLOSED", label: "Close Ticket", icon: "archive" },
    CLOSED: null,
  };

  // State
  let supabase = null;
  let currentUserProfile = null;
  let realtimeChannel = null;
  let allRequisitions = [];
  let allSites = [];
  let allRequesters = [];
  let selectedRequisition = null;
  let parsedCsvRows = [];

  let filters = {
    siteId: "ALL",
    urgency: "ALL",
    unassignedOnly: false,
    duplicatesOnly: false,
    showArchivedClosed: false,
    search: "",
  };

  let teamFilters = {
    search: "",
    siteId: "ALL",
    status: "ALL",
  };

  // Top Nav & Auth DOM Elements
  const connectionPill = document.getElementById("connectionStatusPill");
  const connectionDot = document.getElementById("connectionDot");
  const connectionText = document.getElementById("connectionText");
  const userNameSpan = document.getElementById("userNameSpan");
  const userRoleBadge = document.getElementById("userRoleBadge");
  const userCompanySpan = document.getElementById("userCompanySpan");
  const signOutBtn = document.getElementById("signOutBtn");
  const openTeamModalBtn = document.getElementById("openTeamModalBtn");
  const navTeamCountBadge = document.getElementById("navTeamCountBadge");

  // Kanban Filter & Control Elements
  const siteFilter = document.getElementById("siteFilter");
  const urgencyFilter = document.getElementById("urgencyFilter");
  const unassignedFilter = document.getElementById("unassignedFilter");
  const duplicatesOnlyFilter = document.getElementById("duplicatesOnlyFilter");
  const showArchivedClosedToggle = document.getElementById("showArchivedClosedToggle");
  const searchInput = document.getElementById("searchInput");
  const reliefToggleBtn = document.getElementById("reliefToggleBtn");
  const reliefBanner = document.getElementById("reliefBanner");
  const dismissReliefBannerBtn = document.getElementById("dismissReliefBannerBtn");
  const quickClaimUnassignedBtn = document.getElementById("quickClaimUnassignedBtn");
  const statsTotalCount = document.getElementById("statsTotalCount");

  // Requisition Inspection Modal Elements
  const inspectionModal = document.getElementById("inspectionModal");
  const closeModalBtn = document.getElementById("closeModalBtn");
  const modalRefCode = document.getElementById("modalRefCode");
  const modalPoBadge = document.getElementById("modalPoBadge");
  const modalUrgencyBadge = document.getElementById("modalUrgencyBadge");
  const modalSiteZone = document.getElementById("modalSiteZone");
  const modalRequesterName = document.getElementById("modalRequesterName");
  const modalCreatedAt = document.getElementById("modalCreatedAt");
  const modalRawText = document.getElementById("modalRawText");
  const modalAudioSection = document.getElementById("modalAudioSection");
  const modalPlayAudioBtn = document.getElementById("modalPlayAudioBtn");
  const modalDuplicateWarning = document.getElementById("modalDuplicateWarning");
  const modalDuplicateRef = document.getElementById("modalDuplicateRef");
  const modalDismissDuplicateBtn = document.getElementById("modalDismissDuplicateBtn");
  const modalItemCount = document.getElementById("modalItemCount");
  const modalItemsTableBody = document.getElementById("modalItemsTableBody");
  const modalSupplierInput = document.getElementById("modalSupplierInput");
  const modalPoNumberInput = document.getElementById("modalPoNumberInput");
  const modalNotesInput = document.getElementById("modalNotesInput");
  const modalSaveDetailsBtn = document.getElementById("modalSaveDetailsBtn");
  const modalCancelReqBtn = document.getElementById("modalCancelReqBtn");
  const modalAdvanceStatusBtn = document.getElementById("modalAdvanceStatusBtn");
  const modalAdvanceStatusText = document.getElementById("modalAdvanceStatusText");
  const toastContainer = document.getElementById("toastContainer");

  // Team Management Modal Elements (ADR-0005 Phase 4)
  const teamModal = document.getElementById("teamModal");
  const closeTeamModalBtn = document.getElementById("closeTeamModalBtn");
  const teamCompanyCode = document.getElementById("teamCompanyCode");
  const teamTotalCount = document.getElementById("teamTotalCount");
  const teamActiveCount = document.getElementById("teamActiveCount");
  const teamSearchInput = document.getElementById("teamSearchInput");
  const teamSiteFilter = document.getElementById("teamSiteFilter");
  const teamStatusFilter = document.getElementById("teamStatusFilter");
  const teamTableBody = document.getElementById("teamTableBody");
  const downloadTemplateBtn = document.getElementById("downloadTemplateBtn");
  const openAddRequesterBtn = document.getElementById("openAddRequesterBtn");
  const openBatchCsvBtn = document.getElementById("openBatchCsvBtn");

  // Add Requester Modal Elements
  const addRequesterModal = document.getElementById("addRequesterModal");
  const closeAddRequesterBtn = document.getElementById("closeAddRequesterBtn");
  const cancelAddRequesterBtn = document.getElementById("cancelAddRequesterBtn");
  const addRequesterForm = document.getElementById("addRequesterForm");
  const reqFullName = document.getElementById("reqFullName");
  const reqPhoneNumber = document.getElementById("reqPhoneNumber");
  const reqRoleTitle = document.getElementById("reqRoleTitle");
  const reqDefaultSite = document.getElementById("reqDefaultSite");

  // Batch CSV Import Elements
  const batchImportModal = document.getElementById("batchImportModal");
  const closeBatchImportBtn = document.getElementById("closeBatchImportBtn");
  const cancelBatchImportBtn = document.getElementById("cancelBatchImportBtn");
  const chooseCsvBtn = document.getElementById("chooseCsvBtn");
  const csvFileInput = document.getElementById("csvFileInput");
  const selectedFileName = document.getElementById("selectedFileName");
  const csvStatsBanner = document.getElementById("csvStatsBanner");
  const csvTotalRows = document.getElementById("csvTotalRows");
  const csvValidRows = document.getElementById("csvValidRows");
  const csvErrorRows = document.getElementById("csvErrorRows");
  const csvPreviewEmpty = document.getElementById("csvPreviewEmpty");
  const csvPreviewTableWrapper = document.getElementById("csvPreviewTableWrapper");
  const csvPreviewTableBody = document.getElementById("csvPreviewTableBody");
  const commitBatchImportBtn = document.getElementById("commitBatchImportBtn");
  const commitBatchBtnText = document.getElementById("commitBatchBtnText");

  /**
   * Show floating toast notification
   */
  function showToast(title, message, type = "info") {
    const toast = document.createElement("div");
    const colors = {
      info: "border-slate-300 bg-white text-slate-800 shadow-md",
      success: "border-emerald-300 bg-emerald-50 text-emerald-900 shadow-md",
      warning: "border-amber-300 bg-amber-50 text-amber-900 shadow-md",
      error: "border-red-300 bg-red-50 text-red-900 shadow-md",
    };

    toast.className = `p-3.5 rounded-xl border flex items-start space-x-3 pointer-events-auto transition-all transform duration-200 translate-y-2 opacity-0 max-w-sm ${
      colors[type] || colors.info
    }`;
    toast.innerHTML = `
      <div class="mt-0.5"><i data-lucide="${type === "success" ? "check-circle" : type === "warning" ? "alert-triangle" : type === "error" ? "alert-octagon" : "bell"}" class="w-4 h-4"></i></div>
      <div class="flex-1">
        <h5 class="text-xs font-bold">${title}</h5>
        <p class="text-[11px] opacity-90 mt-0.5">${message}</p>
      </div>
    `;

    toastContainer.appendChild(toast);
    lucide.createIcons({ root: toast });

    setTimeout(() => {
      toast.classList.remove("translate-y-2", "opacity-0");
    }, 10);

    setTimeout(() => {
      toast.classList.add("translate-y-2", "opacity-0");
      setTimeout(() => toast.remove(), 250);
    }, 4500);
  }

  /**
   * Relative time formatting
   */
  function formatRelativeTime(dateString) {
    if (!dateString) return "—";
    const date = new Date(dateString);
    const now = new Date();
    const diffSecs = Math.floor((now - date) / 1000);

    if (diffSecs < 60) return "Just now";
    if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
    if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
    return `${Math.floor(diffSecs / 86400)}d ago`;
  }

  /**
   * Phone number normalization to E.164 (+27XXXXXXXXX)
   */
  function normalizePhoneNumber(raw) {
    if (!raw) return null;
    let cleaned = raw.trim().replace(/[\s\-\(\)\.]/g, "");
    if (cleaned.startsWith("0")) {
      cleaned = "+27" + cleaned.slice(1);
    } else if (cleaned.startsWith("27")) {
      cleaned = "+" + cleaned;
    } else if (!cleaned.startsWith("+")) {
      cleaned = "+" + cleaned;
    }
    // E.164 validation: '+' followed by 7 to 15 digits
    if (!/^\+[1-9]\d{6,14}$/.test(cleaned)) {
      return null;
    }
    return cleaned;
  }

  /**
   * Formats multi-tier location: [Site Name] • [Zone Name] ([Location Detail])
   */
  function formatRequisitionLocation(req, useHtml = true) {
    const siteName = req.site ? req.site.name : "Unassigned Site";
    const zoneName = req.zone ? req.zone.name?.trim() : null;
    const locationDetail = req.location_detail ? req.location_detail.trim() : null;
    const separator = useHtml ? " &bull; " : " • ";

    if (zoneName && locationDetail) {
      if (zoneName.toLowerCase() === locationDetail.toLowerCase()) {
        return `${siteName}${separator}${zoneName}`;
      }
      return `${siteName}${separator}${zoneName} (${locationDetail})`;
    } else if (zoneName) {
      return `${siteName}${separator}${zoneName}`;
    } else if (locationDetail) {
      return `${siteName}${separator}${locationDetail}`;
    }
    return siteName;
  }

  /**
   * Update realtime connection status badge
   */
  function updateConnectionStatus(status) {
    if (status === "SUBSCRIBED") {
      connectionDot.className = "w-2 h-2 rounded-full bg-emerald-500";
      connectionText.textContent = "Live Realtime Sync";
      connectionText.className = "text-emerald-700 font-medium";
      connectionPill.className =
        "flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-xs font-mono";
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      connectionDot.className = "w-2 h-2 rounded-full bg-red-500 animate-pulse";
      connectionText.textContent = "Reconnecting...";
      connectionText.className = "text-red-700 font-medium";
      connectionPill.className =
        "flex items-center space-x-2 px-3 py-1 rounded-full bg-red-50 border border-red-200 text-xs font-mono";
    } else {
      connectionDot.className = "w-2 h-2 rounded-full bg-amber-400 animate-pulse";
      connectionText.textContent = "Connecting Realtime...";
      connectionText.className = "text-slate-600 font-medium";
      connectionPill.className =
        "flex items-center space-x-2 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs font-mono";
    }
  }

  /**
   * Session Guard: Enforces authenticated session and active user_profile (ADR-0005 Phase 3)
   */
  async function enforceSessionGuard() {
    supabase = AppConfig.getSupabase();
    if (!supabase) {
      window.location.replace("index.html");
      return false;
    }

    try {
      const {
        data: { session },
        error: sessionErr,
      } = await supabase.auth.getSession();

      if (sessionErr || !session || !session.user) {
        console.warn("No active Supabase session. Redirecting to sign in.");
        AppConfig.clearSession();
        window.location.replace("index.html");
        return false;
      }

      // Query user_profiles directly with authenticated UID (RLS protected)
      const { data: profile, error: profileErr } = await supabase
        .from("user_profiles")
        .select(`
          id,
          full_name,
          role,
          phone_number,
          is_active,
          company_id,
          company:companies(id, name, company_code)
        `)
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (profileErr || !profile || !profile.is_active) {
        console.error("User account has no active profile in tenant:", profileErr);
        await supabase.auth.signOut();
        AppConfig.clearSession();
        window.location.replace("index.html");
        return false;
      }

      currentUserProfile = profile;
      AppConfig.setStoredUserProfile(profile);

      // Populate User Nav Card
      userNameSpan.textContent = profile.full_name || session.user.email;
      userRoleBadge.textContent = profile.role || "buyer";
      const compName = profile.company?.name || "Facility";
      const compCode = profile.company?.company_code || "CODE";
      userCompanySpan.textContent = `${compName} • ${compCode}`;
      if (teamCompanyCode) {
        teamCompanyCode.textContent = compCode;
      }

      // Listen for reactive logout or token expiry
      supabase.auth.onAuthStateChange((event, newSession) => {
        if (event === "SIGNED_OUT" || !newSession) {
          console.warn("Auth state changed to SIGNED_OUT. Redirecting to index.html.");
          AppConfig.clearSession();
          window.location.replace("index.html");
        }
      });

      return true;
    } catch (err) {
      console.error("Session verification encountered exception:", err);
      window.location.replace("index.html");
      return false;
    }
  }

  /**
   * Load operational sites for filtering and requester assignment (scoped by RLS)
   */
  async function loadSites() {
    try {
      const { data, error } = await supabase
        .from("sites")
        .select("id, name, code, is_active")
        .order("name");

      if (error) throw error;
      allSites = data || [];

      // Populate Board Site Filter
      siteFilter.innerHTML = '<option value="ALL">All Operational Sites</option>';
      // Populate Team Modal Site Filter
      teamSiteFilter.innerHTML = '<option value="ALL">All Sites</option>';
      // Populate Add Requester Site Select
      reqDefaultSite.innerHTML = '<option value="">(None - resolved dynamically per ticket)</option>';

      allSites.forEach((site) => {
        const opt1 = document.createElement("option");
        opt1.value = site.id;
        opt1.textContent = `${site.name} (${site.code})`;
        siteFilter.appendChild(opt1);

        const opt2 = document.createElement("option");
        opt2.value = site.id;
        opt2.textContent = `${site.name} (${site.code})`;
        teamSiteFilter.appendChild(opt2);

        const opt3 = document.createElement("option");
        opt3.value = site.id;
        opt3.textContent = `${site.name} (${site.code})`;
        reqDefaultSite.appendChild(opt3);
      });
    } catch (err) {
      console.error("Failed to load sites:", err);
    }
  }

  /**
   * Fetch all requisitions with line items and relational metadata (scoped by RLS)
   */
  async function fetchRequisitions() {
    try {
      const { data, error } = await supabase
        .from("requisitions")
        .select(`
          *,
          site:sites(id, name, code),
          zone:zones(id, name, code),
          requester:requesters(id, name, phone_number, role_title),
          items:requisition_items(id, item_description, quantity, unit_of_measure, part_number, notes)
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;
      allRequisitions = data || [];
      renderBoard();
    } catch (err) {
      console.error("Failed to fetch requisitions:", err);
      showToast("Sync Error", `Could not retrieve requisitions: ${err.message}`, "error");
    }
  }

  /**
   * Setup Realtime WebSocket channel for instant backoffice pipeline updates
   */
  function setupRealtimeSync() {
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
    }

    realtimeChannel = supabase
      .channel("requisitions-live-sync")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "requisitions",
        },
        async (payload) => {
          console.log("[Realtime event]", payload.eventType, payload);

          if (payload.eventType === "INSERT") {
            showToast("New Field Requisition", `Ref: ${payload.new.reference_code}`, "info");
            if (payload.new.urgency === "CRITICAL_BREAKDOWN") {
              showToast("🚨 CRITICAL BREAKDOWN", `Immediate triage required for ${payload.new.reference_code}`, "warning");
            }
            await fetchRequisitions();
          } else if (payload.eventType === "UPDATE") {
            const oldStatus = payload.old ? payload.old.status : null;
            if (oldStatus && oldStatus !== payload.new.status) {
              showToast("Status Transition", `${payload.new.reference_code} moved to ${payload.new.status}`, "success");
            }
            await fetchRequisitions();
            if (selectedRequisition && selectedRequisition.id === payload.new.id) {
              const updated = allRequisitions.find((r) => r.id === payload.new.id);
              if (updated) openInspectionModal(updated);
            }
          } else if (payload.eventType === "DELETE") {
            await fetchRequisitions();
          }
        }
      )
      .subscribe((status) => {
        updateConnectionStatus(status);
      });
  }

  /**
   * Filter requisitions based on active filter controls and 14-day closed retention rule
   */
  function getFilteredRequisitions() {
    const now = new Date();

    return allRequisitions.filter((req) => {
      // Exclude cancelled unless explicitly searching
      if (req.status === "CANCELLED" && !filters.search) {
        return false;
      }

      // 14-day retention rule for CLOSED column
      if (req.status === "CLOSED" && !filters.showArchivedClosed && !filters.search) {
        const completedDate = new Date(req.updated_at || req.created_at);
        const diffDays = (now.getTime() - completedDate.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays > 14) {
          return false;
        }
      }

      // Site filter
      if (filters.siteId !== "ALL" && req.site_id !== filters.siteId) {
        return false;
      }

      // Urgency filter
      if (filters.urgency !== "ALL" && req.urgency !== filters.urgency) {
        return false;
      }

      // Unassigned filter
      if (filters.unassignedOnly && req.assigned_buyer_id) {
        return false;
      }

      // Duplicates only filter
      if (filters.duplicatesOnly && !req.is_duplicate_suspect) {
        return false;
      }

      // Free text search query
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const refMatch = req.reference_code && req.reference_code.toLowerCase().includes(q);
        const poMatch = req.po_number && req.po_number.toLowerCase().includes(q);
        const supplierMatch = req.supplier_name && req.supplier_name.toLowerCase().includes(q);
        const requesterMatch = req.requester && req.requester.name && req.requester.name.toLowerCase().includes(q);
        const textMatch = req.raw_message_text && req.raw_message_text.toLowerCase().includes(q);
        const itemMatch =
          Array.isArray(req.items) &&
          req.items.some((it) => it.item_description && it.item_description.toLowerCase().includes(q));

        if (!refMatch && !poMatch && !supplierMatch && !requesterMatch && !textMatch && !itemMatch) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Render all Kanban Columns
   */
  function renderBoard() {
    const filtered = getFilteredRequisitions();

    const grouped = {
      LOGGED: [],
      PENDING_QUOTE: [],
      PO_PLACED: [],
      DELIVERED_TO_SITE: [],
      CLOSED: [],
    };

    filtered.forEach((req) => {
      if (grouped[req.status]) {
        grouped[req.status].push(req);
      }
    });

    let totalActive = 0;

    COLUMNS.forEach((colStatus) => {
      const colEl = document.getElementById(`col_${colStatus}`);
      const countEl = document.getElementById(`count_${colStatus}`);
      const reqsInCol = grouped[colStatus] || [];

      if (colStatus !== "CLOSED") {
        totalActive += reqsInCol.length;
      }

      countEl.textContent = reqsInCol.length.toString();
      colEl.innerHTML = "";

      if (reqsInCol.length === 0) {
        colEl.innerHTML = `
          <div class="h-28 flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-xl text-slate-400 text-xs">
            <span class="font-medium">No requisitions</span>
          </div>
        `;
        return;
      }

      reqsInCol.forEach((req) => {
        const card = createCardElement(req);
        colEl.appendChild(card);
      });
    });

    statsTotalCount.textContent = totalActive.toString();
    lucide.createIcons();
  }

  /**
   * Construct a single Kanban Card element with Native HTML5 Drag and Drop
   */
  function createCardElement(req) {
    const card = document.createElement("div");
    card.className =
      "kanban-card bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-3.5 shadow-2xs hover:shadow-xs transition-all cursor-grab active:cursor-grabbing space-y-2.5 relative group";
    card.setAttribute("draggable", "true");
    card.dataset.id = req.id;
    card.dataset.status = req.status;

    // Urgency styling
    let urgencyBadge = "";
    if (req.urgency === "CRITICAL_BREAKDOWN") {
      urgencyBadge =
        '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red-100 text-red-800 border border-red-200 flex items-center space-x-1"><i data-lucide="flame" class="w-3 h-3"></i><span>Breakdown</span></span>';
    } else if (req.urgency === "URGENT") {
      urgencyBadge =
        '<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-800 border border-amber-200">Urgent</span>';
    } else {
      urgencyBadge =
        '<span class="px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-slate-100 text-slate-600 border border-slate-200">Routine</span>';
    }

    // Duplicate badge
    const duplicateBadge = req.is_duplicate_suspect
      ? '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500 text-white flex items-center space-x-1 shadow-2xs" title="7-Day Duplicate Order Suspect"><i data-lucide="alert-triangle" class="w-3 h-3"></i><span>DUP</span></span>'
      : "";

    // Items preview
    const items = req.items || [];
    const firstItem = items[0]?.item_description || "Requisition Item";
    const extraCount = items.length > 1 ? ` +${items.length - 1} more` : "";

    // PO & Supplier pill
    let poSupplierPill = "";
    if (req.supplier_name || req.po_number) {
      const parts = [];
      if (req.po_number) parts.push(`<span class="font-mono font-semibold">${req.po_number}</span>`);
      if (req.supplier_name) parts.push(`<span>${req.supplier_name}</span>`);
      poSupplierPill = `
        <div class="text-[11px] bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-600 flex items-center space-x-1.5 truncate">
          <i data-lucide="tag" class="w-3 h-3 text-slate-400 flex-shrink-0"></i>
          <span class="truncate">${parts.join(" &bull; ")}</span>
        </div>
      `;
    }

    // Relative timestamp
    const relativeTime = formatRelativeTime(req.created_at);

    // Multi-tier location
    const locationString = formatRequisitionLocation(req, true);

    card.innerHTML = `
      <div class="flex items-center justify-between gap-1">
        <span class="font-mono text-xs font-bold text-slate-900 group-hover:text-emerald-700 transition-colors">${req.reference_code}</span>
        <div class="flex items-center space-x-1.5">
          ${duplicateBadge}
          ${urgencyBadge}
        </div>
      </div>

      <div>
        <p class="text-xs font-semibold text-slate-800 line-clamp-2 leading-snug">${firstItem}${extraCount}</p>
        <div class="flex items-center space-x-1 text-[11px] text-slate-500 mt-1 truncate">
          <i data-lucide="map-pin" class="w-3 h-3 text-slate-400 flex-shrink-0"></i>
          <span class="truncate">${locationString}</span>
        </div>
      </div>

      ${poSupplierPill}

      <div class="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
        <div class="flex items-center space-x-1 truncate max-w-[140px]">
          <i data-lucide="user" class="w-3 h-3 text-slate-400 flex-shrink-0"></i>
          <span class="truncate">${req.requester?.name || "Field Requester"}</span>
        </div>
        <span class="font-mono text-[10px] text-slate-400">${relativeTime}</span>
      </div>
    `;

    // Click to inspect details
    card.addEventListener("click", () => {
      openInspectionModal(req);
    });

    // Native HTML5 Drag and Drop events
    card.addEventListener("dragstart", (e) => {
      card.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", req.id);
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("is-dragging");
      document.querySelectorAll(".kanban-column-body").forEach((col) => {
        col.classList.remove("drag-over");
      });
    });

    return card;
  }

  /**
   * Setup Drag and Drop Drop Targets across all columns
   */
  function setupColumnDropTargets() {
    COLUMNS.forEach((colStatus) => {
      const colEl = document.getElementById(`col_${colStatus}`);
      if (!colEl) return;

      colEl.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        colEl.classList.add("drag-over");
      });

      colEl.addEventListener("dragleave", (e) => {
        if (!colEl.contains(e.relatedTarget)) {
          colEl.classList.remove("drag-over");
        }
      });

      colEl.addEventListener("drop", async (e) => {
        e.preventDefault();
        colEl.classList.remove("drag-over");
        const reqId = e.dataTransfer.getData("text/plain");
        if (!reqId) return;

        const targetStatus = colEl.dataset.status;
        const req = allRequisitions.find((r) => r.id === reqId);
        if (!req || req.status === targetStatus) return;

        console.log(`[DragDrop] Moving ${req.reference_code} to ${targetStatus}`);
        await transitionRequisitionStatus(reqId, targetStatus);
      });
    });
  }

  /**
   * Open Requisition Inspection Modal
   */
  function openInspectionModal(req) {
    selectedRequisition = req;

    modalRefCode.textContent = req.reference_code;
    modalSiteZone.innerHTML = formatRequisitionLocation(req, true);
    modalRequesterName.textContent = `• ${req.requester?.name || "Field Requester"} (${req.requester?.phone_number || ""})`;
    modalCreatedAt.textContent = new Date(req.created_at).toLocaleString();
    modalRawText.textContent = req.raw_message_text ? `"${req.raw_message_text}"` : '"No raw text content."';

    // PO Badge
    if (req.po_number) {
      modalPoBadge.textContent = req.po_number;
      modalPoBadge.classList.remove("hidden");
    } else {
      modalPoBadge.classList.add("hidden");
    }

    // Urgency Badge
    modalUrgencyBadge.className = "px-2 py-0.5 rounded text-xs font-bold uppercase ";
    if (req.urgency === "CRITICAL_BREAKDOWN") {
      modalUrgencyBadge.classList.add("bg-red-100", "text-red-800", "border", "border-red-200");
      modalUrgencyBadge.textContent = "🔥 Breakdown";
    } else if (req.urgency === "URGENT") {
      modalUrgencyBadge.classList.add("bg-amber-100", "text-amber-800", "border", "border-amber-200");
      modalUrgencyBadge.textContent = "⚠️ Urgent";
    } else {
      modalUrgencyBadge.classList.add("bg-slate-100", "text-slate-600", "border", "border-slate-200");
      modalUrgencyBadge.textContent = "Routine";
    }

    // Duplicate Warning
    if (req.is_duplicate_suspect) {
      modalDuplicateWarning.classList.remove("hidden");
    } else {
      modalDuplicateWarning.classList.add("hidden");
    }

    // Operational Inputs
    modalSupplierInput.value = req.supplier_name || "";
    modalPoNumberInput.value = req.po_number || "";
    modalNotesInput.value = req.notes || "";

    // Line items table
    const items = req.items || [];
    modalItemCount.textContent = `${items.length} ${items.length === 1 ? "item" : "items"}`;
    modalItemsTableBody.innerHTML = "";

    if (items.length === 0) {
      modalItemsTableBody.innerHTML = `
        <tr>
          <td colspan="3" class="p-3 text-center text-slate-400 italic">No line items extracted.</td>
        </tr>
      `;
    } else {
      items.forEach((item) => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td class="p-3 font-medium text-slate-800">${item.item_description || "—"}</td>
          <td class="p-3 font-mono font-semibold text-slate-700">${item.quantity || 1}</td>
          <td class="p-3 text-slate-500">${item.unit_of_measure || "units"}</td>
        `;
        modalItemsTableBody.appendChild(row);
      });
    }

    // Advance Status Button Config
    const nextConfig = NEXT_STATUS[req.status];
    if (nextConfig) {
      modalAdvanceStatusBtn.classList.remove("hidden");
      modalAdvanceStatusText.textContent = nextConfig.label;
    } else {
      modalAdvanceStatusBtn.classList.add("hidden");
    }

    inspectionModal.classList.remove("hidden");
    lucide.createIcons({ root: inspectionModal });
  }

  function closeInspectionModal() {
    inspectionModal.classList.add("hidden");
    selectedRequisition = null;
  }

  /**
   * Save Practical Operational Details from Inspection Modal
   */
  async function saveOperationalDetails() {
    if (!selectedRequisition) return;

    const supplierName = modalSupplierInput.value.trim() || null;
    const poNumber = modalPoNumberInput.value.trim() || null;
    const notes = modalNotesInput.value.trim() || null;

    modalSaveDetailsBtn.disabled = true;
    modalSaveDetailsBtn.textContent = "Saving...";

    try {
      const { error } = await supabase
        .from("requisitions")
        .update({
          supplier_name: supplierName,
          po_number: poNumber,
          notes: notes,
        })
        .eq("id", selectedRequisition.id);

      if (error) throw error;

      selectedRequisition.supplier_name = supplierName;
      selectedRequisition.po_number = poNumber;
      selectedRequisition.notes = notes;

      showToast("Details Saved", `Updated details for ${selectedRequisition.reference_code}`, "success");
      await fetchRequisitions();
      openInspectionModal(selectedRequisition);
    } catch (err) {
      console.error("Save details failed:", err);
      showToast("Save Error", err.message, "error");
    } finally {
      modalSaveDetailsBtn.disabled = false;
      modalSaveDetailsBtn.textContent = "Save Details";
    }
  }

  /**
   * Status Machine Transition with Automated WhatsApp Delivery Alerts
   */
  async function transitionRequisitionStatus(reqId, newStatus) {
    try {
      const { data, error } = await supabase
        .from("requisitions")
        .update({ status: newStatus })
        .eq("id", reqId)
        .select("id, reference_code, status")
        .single();

      if (error) throw error;

      showToast("Order Updated", `${data.reference_code} moved to ${newStatus}`, "success");

      // Trigger automated delivery alert edge function when order arrives on site
      if (newStatus === "DELIVERED_TO_SITE") {
        console.log(`[Delivery Alert] Triggering outbound notification for ${data.reference_code}...`);
        fetch(`${AppConfig.SUPABASE_URL}/functions/v1/whatsapp-webhook`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${AppConfig.SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            action: "delivery_alert",
            requisition_id: reqId,
          }),
        })
          .then((res) => res.json())
          .then((resData) => {
            console.log("[Delivery Alert] Dispatch response:", resData);
            if (resData.success) {
              showToast("Delivery Alert Dispatched", `Sent WhatsApp arrival alert to requester (${data.reference_code})`, "info");
            }
          })
          .catch((err) => {
            console.warn("[Delivery Alert] Edge function trigger warning:", err);
          });
      }

      await fetchRequisitions();
    } catch (err) {
      console.error("Transition failed:", err);
      showToast("Transition Error", err.message, "error");
    }
  }

  /**
   * Cancel requisition
   */
  async function cancelRequisition() {
    if (!selectedRequisition) return;
    if (!confirm(`Are you sure you want to cancel order ${selectedRequisition.reference_code}?`)) {
      return;
    }
    await transitionRequisitionStatus(selectedRequisition.id, "CANCELLED");
    closeInspectionModal();
  }

  /**
   * Clear 7-day duplicate flag
   */
  async function dismissDuplicateFlag() {
    if (!selectedRequisition) return;

    try {
      const { error } = await supabase
        .from("requisitions")
        .update({ is_duplicate_suspect: false })
        .eq("id", selectedRequisition.id);

      if (error) throw error;

      selectedRequisition.is_duplicate_suspect = false;
      modalDuplicateWarning.classList.add("hidden");
      showToast("Duplicate Flag Cleared", `Verified order ${selectedRequisition.reference_code}`, "info");
      await fetchRequisitions();
    } catch (err) {
      console.error("Dismiss duplicate failed:", err);
      showToast("Error", err.message, "error");
    }
  }

  // ==========================================================================
  // FIELD TEAM & WHITELIST CONTROLLER (ADR-0005 Phase 4)
  // ==========================================================================

  /**
   * Load all whitelisted requesters for current company (RLS scoped)
   */
  async function loadRequesters() {
    try {
      const { data, error } = await supabase
        .from("requesters")
        .select(`
          id,
          name,
          phone_number,
          role_title,
          default_site_id,
          is_active,
          created_at,
          site:sites(id, name, code)
        `)
        .order("name");

      if (error) throw error;
      allRequesters = data || [];

      // Update counter badges
      const activeCount = allRequesters.filter((r) => r.is_active).length;
      const totalCount = allRequesters.length;

      if (navTeamCountBadge) navTeamCountBadge.textContent = activeCount.toString();
      if (teamTotalCount) teamTotalCount.textContent = totalCount.toString();
      if (teamActiveCount) teamActiveCount.textContent = `${activeCount} Active Foremen`;

      renderTeamTable();
    } catch (err) {
      console.error("Failed to load field requesters:", err);
      showToast("Team Sync Error", `Could not retrieve requesters: ${err.message}`, "error");
    }
  }

  /**
   * Render whitelisted requesters table with status toggles
   */
  function renderTeamTable() {
    if (!teamTableBody) return;

    const filtered = allRequesters.filter((req) => {
      // Search filter
      if (teamFilters.search) {
        const q = teamFilters.search.toLowerCase();
        const nameMatch = req.name && req.name.toLowerCase().includes(q);
        const phoneMatch = req.phone_number && req.phone_number.toLowerCase().includes(q);
        const roleMatch = req.role_title && req.role_title.toLowerCase().includes(q);
        if (!nameMatch && !phoneMatch && !roleMatch) return false;
      }

      // Site filter
      if (teamFilters.siteId !== "ALL" && req.default_site_id !== teamFilters.siteId) {
        return false;
      }

      // Status filter
      if (teamFilters.status === "ACTIVE" && !req.is_active) return false;
      if (teamFilters.status === "INACTIVE" && req.is_active) return false;

      return true;
    });

    teamTableBody.innerHTML = "";

    if (filtered.length === 0) {
      teamTableBody.innerHTML = `
        <tr>
          <td colspan="6" class="p-6 text-center text-slate-400 text-xs italic">
            No whitelisted field staff found matching the selected filters.
          </td>
        </tr>
      `;
      return;
    }

    filtered.forEach((req) => {
      const tr = document.createElement("tr");
      tr.className = "hover:bg-slate-50 transition-colors";

      const siteName = req.site?.name ? `${req.site.name} (${req.site.code})` : "— Dynamic";
      const statusPill = req.is_active
        ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">Active</span>'
        : '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">Deactivated</span>';

      const toggleBtn = req.is_active
        ? `<button data-action="toggle-status" data-id="${req.id}" data-active="true" class="px-2.5 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 border border-red-200 rounded-lg transition-all cursor-pointer">Deactivate</button>`
        : `<button data-action="toggle-status" data-id="${req.id}" data-active="false" class="px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 border border-emerald-200 rounded-lg transition-all cursor-pointer">Reactivate</button>`;

      tr.innerHTML = `
        <td class="p-3 font-semibold text-slate-900">${req.name}</td>
        <td class="p-3 font-mono text-slate-700">
          <div class="flex items-center space-x-1.5">
            <i data-lucide="phone" class="w-3.5 h-3.5 text-emerald-600 flex-shrink-0"></i>
            <span>${req.phone_number}</span>
          </div>
        </td>
        <td class="p-3 text-slate-600">${req.role_title || "Field Technician"}</td>
        <td class="p-3 text-slate-500">${siteName}</td>
        <td class="p-3 text-center">${statusPill}</td>
        <td class="p-3 text-right">${toggleBtn}</td>
      `;

      teamTableBody.appendChild(tr);
    });

    lucide.createIcons({ root: teamTableBody });
  }

  /**
   * One-click toggle status (Reactivate / Deactivate) for requester
   */
  async function toggleRequesterStatus(id, currentActive) {
    const newStatus = !currentActive;
    const req = allRequesters.find((r) => r.id === id);
    const staffName = req?.name || "Requester";

    try {
      const { error } = await supabase
        .from("requesters")
        .update({ is_active: newStatus })
        .eq("id", id);

      if (error) throw error;

      showToast(
        newStatus ? "Requester Activated" : "Requester Deactivated",
        `${staffName} is now ${newStatus ? "authorized to log tickets" : "barred from logging tickets"}.`,
        newStatus ? "success" : "info"
      );

      await loadRequesters();
    } catch (err) {
      console.error("Toggle requester status failed:", err);
      showToast("Update Error", err.message, "error");
    }
  }

  /**
   * Add a single requester
   */
  async function handleAddRequester(e) {
    e.preventDefault();

    const fullName = reqFullName.value.trim();
    const rawPhone = reqPhoneNumber.value.trim();
    const roleTitle = reqRoleTitle.value.trim() || null;
    const defaultSiteId = reqDefaultSite.value || null;

    const normalizedPhone = normalizePhoneNumber(rawPhone);
    if (!normalizedPhone) {
      showToast(
        "Invalid Mobile Number",
        "Please enter a valid South African mobile number (e.g. 082 123 4567 or +27821234567).",
        "warning"
      );
      reqPhoneNumber.focus();
      return;
    }

    if (!currentUserProfile || !currentUserProfile.company_id) {
      showToast("Session Error", "No active tenant company context found.", "error");
      return;
    }

    try {
      const { data, error } = await supabase
        .from("requesters")
        .insert({
          company_id: currentUserProfile.company_id,
          name: fullName,
          phone_number: normalizedPhone,
          role_title: roleTitle,
          default_site_id: defaultSiteId,
          is_active: true,
        })
        .select()
        .single();

      if (error) {
        if (error.code === "23505") {
          throw new Error(`Phone number ${normalizedPhone} is already active on a field profile.`);
        }
        throw error;
      }

      showToast("Field Requester Added", `Whitelisted ${data.name} (${data.phone_number})`, "success");
      addRequesterModal.classList.add("hidden");
      addRequesterForm.reset();
      await loadRequesters();
    } catch (err) {
      console.error("Add requester failed:", err);
      showToast("Enrollment Failed", err.message, "error");
    }
  }

  /**
   * Download CSV Template for batch import
   */
  function handleDownloadTemplate() {
    const csvHeader = "full_name,phone_number,role_title,site_name_or_code\n";
    const sampleRows =
      "Sipho Khumalo,0821234567,Packhouse Supervisor,CERES-01\n" +
      "Pieter Botha,+27839876543,Workshop Foreman,CERES-01\n" +
      "Charlize Joubert,0715551234,Cold Storage Tech,\n";

    const blob = new Blob([csvHeader + sampleRows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "supply_conduit_staff_whitelist_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Template Downloaded", "CSV template ready for filling.", "info");
  }

  /**
   * Client-side Formula Injection Sanitizer
   * Neutralizes leading '=', '+', '-', '@' characters to prevent spreadsheet exploits.
   */
  function sanitizeCsvCell(value) {
    if (!value) return "";
    let trimmed = value.trim();
    // Strip leading formula operator characters
    while (/^[=+\-@]/.test(trimmed)) {
      trimmed = trimmed.substring(1).trim();
    }
    return trimmed;
  }

  /**
   * Parse CSV File and Validate Rows
   */
  function parseAndPreviewCsv(file) {
    selectedFileName.textContent = file.name;
    const reader = new FileReader();

    reader.onload = function (e) {
      const text = (e.target && e.target.result) ? String(e.target.result) : "";
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      if (lines.length <= 1) {
        showToast("Empty File", "The CSV file contains no data rows.", "warning");
        return;
      }

      // Split header
      const headerLine = lines[0].toLowerCase();
      const headers = headerLine.split(",").map((h) => sanitizeCsvCell(h));

      const nameIdx = headers.findIndex((h) => h.includes("name"));
      const phoneIdx = headers.findIndex((h) => h.includes("phone"));
      const roleIdx = headers.findIndex((h) => h.includes("role") || h.includes("title"));
      const siteIdx = headers.findIndex((h) => h.includes("site"));

      if (nameIdx === -1 || phoneIdx === -1) {
        showToast("Invalid CSV Format", "CSV must contain at least 'full_name' and 'phone_number' columns.", "error");
        return;
      }

      parsedCsvRows = [];
      let validCount = 0;
      let errorCount = 0;

      for (let i = 1; i < lines.length; i++) {
        const rawRow = lines[i];
        // Handle basic comma separation
        const cells = rawRow.split(",").map((c) => sanitizeCsvCell(c));

        const fullName = cells[nameIdx] || "";
        const rawPhone = cells[phoneIdx] || "";
        const roleTitle = roleIdx !== -1 ? cells[roleIdx] : "";
        const siteText = siteIdx !== -1 ? cells[siteIdx] : "";

        const normalizedPhone = normalizePhoneNumber(rawPhone);

        // Match site
        let matchedSiteId = null;
        let matchedSiteName = siteText;
        if (siteText) {
          const matched = allSites.find(
            (s) =>
              s.code.toLowerCase() === siteText.toLowerCase() ||
              s.name.toLowerCase() === siteText.toLowerCase()
          );
          if (matched) {
            matchedSiteId = matched.id;
            matchedSiteName = `${matched.name} (${matched.code})`;
          }
        }

        let isValid = true;
        let errorReason = "";

        if (!fullName || fullName.length < 2) {
          isValid = false;
          errorReason = "Name required";
        } else if (!normalizedPhone) {
          isValid = false;
          errorReason = "Invalid phone number";
        }

        if (isValid) {
          validCount++;
        } else {
          errorCount++;
        }

        parsedCsvRows.push({
          fullName,
          rawPhone,
          normalizedPhone,
          roleTitle,
          siteText: matchedSiteName,
          siteId: matchedSiteId,
          isValid,
          errorReason,
        });
      }

      // Update Preview UI
      csvStatsBanner.classList.remove("hidden");
      csvTotalRows.textContent = parsedCsvRows.length.toString();
      csvValidRows.textContent = validCount.toString();
      csvErrorRows.textContent = errorCount.toString();

      csvPreviewEmpty.classList.add("hidden");
      csvPreviewTableWrapper.classList.remove("hidden");
      csvPreviewTableBody.innerHTML = "";

      parsedCsvRows.forEach((row) => {
        const tr = document.createElement("tr");
        tr.className = row.isValid ? "hover:bg-slate-50" : "bg-red-50/50 hover:bg-red-50";

        const statusBadge = row.isValid
          ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">Ready</span>'
          : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800" title="${row.errorReason}">${row.errorReason}</span>`;

        tr.innerHTML = `
          <td class="p-2.5 font-medium text-slate-900">${row.fullName || "—"}</td>
          <td class="p-2.5 font-mono ${row.isValid ? "text-slate-700" : "text-red-700 line-through"}">${row.normalizedPhone || row.rawPhone || "—"}</td>
          <td class="p-2.5 text-slate-500">${row.roleTitle || "Field Technician"}</td>
          <td class="p-2.5 text-slate-500">${row.siteText || "— Dynamic"}</td>
          <td class="p-2.5 text-center">${statusBadge}</td>
        `;
        csvPreviewTableBody.appendChild(tr);
      });

      commitBatchImportBtn.disabled = validCount === 0;
      commitBatchBtnText.textContent = `Import ${validCount} Requesters`;
    };

    reader.readAsText(file);
  }

  /**
   * Commit parsed CSV rows in bulk to public.requesters
   */
  async function handleCommitBatchImport() {
    const validRows = parsedCsvRows.filter((r) => r.isValid);
    if (validRows.length === 0) return;

    if (!currentUserProfile || !currentUserProfile.company_id) {
      showToast("Session Error", "No active tenant company context found.", "error");
      return;
    }

    commitBatchImportBtn.disabled = true;
    commitBatchBtnText.textContent = "Importing...";

    try {
      const recordsToInsert = validRows.map((r) => ({
        company_id: currentUserProfile.company_id,
        name: r.fullName,
        phone_number: r.normalizedPhone,
        role_title: r.roleTitle || "Field Technician",
        default_site_id: r.siteId,
        is_active: true,
      }));

      const { data, error } = await supabase
        .from("requesters")
        .insert(recordsToInsert)
        .select();

      if (error) throw error;

      showToast(
        "Batch Import Complete",
        `Successfully enrolled ${data?.length || validRows.length} field requesters to your whitelist.`,
        "success"
      );

      batchImportModal.classList.add("hidden");
      csvFileInput.value = "";
      selectedFileName.textContent = "No file selected";
      parsedCsvRows = [];

      await loadRequesters();
    } catch (err) {
      console.error("Batch import commit failed:", err);
      showToast("Import Failed", err.message, "error");
    } finally {
      commitBatchImportBtn.disabled = false;
      commitBatchBtnText.textContent = "Import Valid Requesters";
    }
  }

  /**
   * Attach All Event Listeners
   */
  function attachEventListeners() {
    // Top Nav Modals & Controls
    openTeamModalBtn.addEventListener("click", () => {
      teamModal.classList.remove("hidden");
      loadRequesters();
      lucide.createIcons({ root: teamModal });
    });

    closeTeamModalBtn.addEventListener("click", () => {
      teamModal.classList.add("hidden");
    });

    // Add Requester Sub-modal
    openAddRequesterBtn.addEventListener("click", () => {
      addRequesterModal.classList.remove("hidden");
      reqFullName.focus();
      lucide.createIcons({ root: addRequesterModal });
    });

    closeAddRequesterBtn.addEventListener("click", () => {
      addRequesterModal.classList.add("hidden");
    });

    cancelAddRequesterBtn.addEventListener("click", () => {
      addRequesterModal.classList.add("hidden");
    });

    addRequesterForm.addEventListener("submit", handleAddRequester);

    // Batch CSV Sub-modal
    openBatchCsvBtn.addEventListener("click", () => {
      batchImportModal.classList.remove("hidden");
      lucide.createIcons({ root: batchImportModal });
    });

    closeBatchImportBtn.addEventListener("click", () => {
      batchImportModal.classList.add("hidden");
    });

    cancelBatchImportBtn.addEventListener("click", () => {
      batchImportModal.classList.add("hidden");
    });

    downloadTemplateBtn.addEventListener("click", handleDownloadTemplate);

    chooseCsvBtn.addEventListener("click", () => {
      csvFileInput.click();
    });

    csvFileInput.addEventListener("change", (e) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        parseAndPreviewCsv(files[0]);
      }
    });

    commitBatchImportBtn.addEventListener("click", handleCommitBatchImport);

    // Team Table Filters
    teamSearchInput.addEventListener("input", (e) => {
      teamFilters.search = e.target.value.trim();
      renderTeamTable();
    });

    teamSiteFilter.addEventListener("change", (e) => {
      teamFilters.siteId = e.target.value;
      renderTeamTable();
    });

    teamStatusFilter.addEventListener("change", (e) => {
      teamFilters.status = e.target.value;
      renderTeamTable();
    });

    // Delegate status toggling in team table
    teamTableBody.addEventListener("click", (e) => {
      const target = e.target.closest("button[data-action='toggle-status']");
      if (target) {
        const id = target.getAttribute("data-id");
        const active = target.getAttribute("data-active") === "true";
        if (id) {
          toggleRequesterStatus(id, active);
        }
      }
    });

    // Filter bar controls
    siteFilter.addEventListener("change", (e) => {
      filters.siteId = e.target.value;
      renderBoard();
    });

    urgencyFilter.addEventListener("change", (e) => {
      filters.urgency = e.target.value;
      renderBoard();
    });

    unassignedFilter.addEventListener("change", (e) => {
      filters.unassignedOnly = e.target.checked;
      renderBoard();
    });

    duplicatesOnlyFilter.addEventListener("change", (e) => {
      filters.duplicatesOnly = e.target.checked;
      renderBoard();
    });

    showArchivedClosedToggle.addEventListener("change", (e) => {
      filters.showArchivedClosed = e.target.checked;
      renderBoard();
    });

    searchInput.addEventListener("input", (e) => {
      filters.search = e.target.value.trim();
      renderBoard();
    });

    // Relief Triage Controls
    reliefToggleBtn.addEventListener("click", () => {
      reliefBanner.classList.toggle("hidden");
    });

    dismissReliefBannerBtn.addEventListener("click", () => {
      reliefBanner.classList.add("hidden");
    });

    quickClaimUnassignedBtn.addEventListener("click", async () => {
      const unassigned = allRequisitions.find((r) => !r.assigned_buyer_id && r.status === "LOGGED");
      if (unassigned) {
        openInspectionModal(unassigned);
        showToast("Claimed Requisition", `Viewing unassigned order ${unassigned.reference_code}`, "info");
      } else {
        showToast("Queue Clean", "No unassigned logged orders currently waiting in queue.", "info");
      }
    });

    // Inspection Modal Controls
    closeModalBtn.addEventListener("click", closeInspectionModal);
    inspectionModal.addEventListener("click", (e) => {
      if (e.target === inspectionModal) {
        closeInspectionModal();
      }
    });

    modalSaveDetailsBtn.addEventListener("click", saveOperationalDetails);
    modalDismissDuplicateBtn.addEventListener("click", dismissDuplicateFlag);
    modalCancelReqBtn.addEventListener("click", cancelRequisition);

    modalAdvanceStatusBtn.addEventListener("click", async () => {
      if (!selectedRequisition) return;
      const nextConfig = NEXT_STATUS[selectedRequisition.status];
      if (!nextConfig) return;
      await transitionRequisitionStatus(selectedRequisition.id, nextConfig.next);
      closeInspectionModal();
    });

    // Audio Voice Note Simulation Player
    let isPlaying = false;
    modalPlayAudioBtn.addEventListener("click", () => {
      isPlaying = !isPlaying;
      if (isPlaying) {
        modalPlayAudioBtn.innerHTML = '<i data-lucide="pause" class="w-4 h-4"></i>';
        modalPlayAudioBtn.classList.add("bg-emerald-200");
        showToast("Audio Playback", "Playing field voice note...", "info");
      } else {
        modalPlayAudioBtn.innerHTML = '<i data-lucide="play" class="w-4 h-4 ml-0.5"></i>';
        modalPlayAudioBtn.classList.remove("bg-emerald-200");
      }
      lucide.createIcons({ root: modalPlayAudioBtn });
    });

    // Sign Out
    signOutBtn.addEventListener("click", async () => {
      AppConfig.clearSession();
      const client = AppConfig.getSupabase();
      if (client) {
        await client.auth.signOut();
      }
      window.location.replace("index.html");
    });
  }

  /**
   * App Initializer
   */
  async function init() {
    // 1. Enforce Fail-Closed Session Guard
    const isSessionValid = await enforceSessionGuard();
    if (!isSessionValid) {
      return;
    }

    // 2. Attach UI and Pipeline Event Listeners
    attachEventListeners();
    setupColumnDropTargets();

    // 3. Load Sites, Requisitions and Requesters (RLS Scoped)
    await loadSites();
    await fetchRequisitions();
    await loadRequesters();

    // 4. Connect Supabase Realtime WebSocket
    setupRealtimeSync();
  }

  // Bootstrap when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
