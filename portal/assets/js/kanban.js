/**
 * kanban.js
 * Master Kanban Pipeline Controller for Supply Conduit Backoffice Portal
 * Real-time PostgREST sync, state machine progression, and triage workflows.
 */

(function () {
  // Column definitions matching the state machine
  const COLUMNS = ["LOGGED", "PENDING_QUOTE", "PO_PLACED", "DELIVERED_TO_SITE", "CLOSED"];

  const NEXT_STATUS = {
    LOGGED: { next: "PENDING_QUOTE", label: "Request Quotes", icon: "arrow-right" },
    PENDING_QUOTE: { next: "PO_PLACED", label: "Generate & Place PO", icon: "check-circle" },
    PO_PLACED: { next: "DELIVERED_TO_SITE", label: "Confirm Site Delivery", icon: "truck" },
    DELIVERED_TO_SITE: { next: "CLOSED", label: "Reconcile & Close", icon: "archive" },
    CLOSED: null,
  };

  // State
  let supabase = null;
  let realtimeChannel = null;
  let allRequisitions = [];
  let allSites = [];
  let selectedRequisition = null;
  let filters = {
    siteId: "ALL",
    urgency: "ALL",
    unassignedOnly: false,
    duplicatesOnly: false,
    search: "",
  };

  // DOM Elements
  const connectionPill = document.getElementById("connectionStatusPill");
  const connectionDot = document.getElementById("connectionDot");
  const connectionText = document.getElementById("connectionText");
  const userEmailSpan = document.getElementById("userEmailSpan");
  const signOutBtn = document.getElementById("signOutBtn");
  const siteFilter = document.getElementById("siteFilter");
  const urgencyFilter = document.getElementById("urgencyFilter");
  const unassignedFilter = document.getElementById("unassignedFilter");
  const duplicatesOnlyFilter = document.getElementById("duplicatesOnlyFilter");
  const searchInput = document.getElementById("searchInput");
  const reliefToggleBtn = document.getElementById("reliefToggleBtn");
  const reliefBanner = document.getElementById("reliefBanner");
  const dismissReliefBannerBtn = document.getElementById("dismissReliefBannerBtn");
  const quickClaimUnassignedBtn = document.getElementById("quickClaimUnassignedBtn");
  const batchExportPastelBtn = document.getElementById("batchExportPastelBtn");
  const statsTotalCount = document.getElementById("statsTotalCount");
  const statsTotalZar = document.getElementById("statsTotalZar");

  // Inspection Modal DOM Elements
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
  const modalNotesInput = document.getElementById("modalNotesInput");
  const modalSaveSupplierBtn = document.getElementById("modalSaveSupplierBtn");
  const modalValuationSubtotal = document.getElementById("modalValuationSubtotal");
  const modalValuationVat = document.getElementById("modalValuationVat");
  const modalValuationTotal = document.getElementById("modalValuationTotal");
  const modalExportPastelBtn = document.getElementById("modalExportPastelBtn");
  const modalCancelReqBtn = document.getElementById("modalCancelReqBtn");
  const modalAdvanceStatusBtn = document.getElementById("modalAdvanceStatusBtn");
  const modalAdvanceStatusText = document.getElementById("modalAdvanceStatusText");
  const toastContainer = document.getElementById("toastContainer");

  /**
   * Show floating toast notification
   */
  function showToast(title, message, type = "info") {
    const toast = document.createElement("div");
    const colors = {
      info: "border-slate-700 bg-slate-900 text-slate-200",
      success: "border-emerald-800 bg-emerald-950/90 text-emerald-200",
      warning: "border-amber-800 bg-amber-950/90 text-amber-200",
      error: "border-red-800 bg-red-950/90 text-red-200",
    };

    toast.className = `p-3.5 rounded-xl border shadow-xl flex items-start space-x-3 pointer-events-auto transition-all transform duration-300 translate-y-2 opacity-0 max-w-sm ${
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
      setTimeout(() => toast.remove(), 300);
    }, 4500);
  }

  /**
   * Format ZAR currency
   */
  function formatCurrencyZAR(amount) {
    const num = parseFloat(amount || 0);
    return (
      "R " +
      num.toLocaleString("en-ZA", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  /**
   * Relative time formatting
   */
  function formatRelativeTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffSecs = Math.floor((now - date) / 1000);

    if (diffSecs < 60) return "Just now";
    if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
    if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
    return `${Math.floor(diffSecs / 86400)}d ago`;
  }

  /**
   * Update realtime connection status badge
   */
  function updateConnectionStatus(status) {
    if (status === "SUBSCRIBED") {
      connectionDot.className = "w-2 h-2 rounded-full bg-emerald-400";
      connectionText.textContent = "Live Pipeline Connected";
      connectionText.className = "text-emerald-300";
      connectionPill.className =
        "flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-800 text-xs font-mono";
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      connectionDot.className = "w-2 h-2 rounded-full bg-red-500 animate-pulse";
      connectionText.textContent = "Realtime Reconnecting...";
      connectionText.className = "text-red-300";
      connectionPill.className =
        "flex items-center space-x-2 px-3 py-1 rounded-full bg-red-950/60 border border-red-800 text-xs font-mono";
    } else {
      connectionDot.className = "w-2 h-2 rounded-full bg-amber-400 animate-pulse";
      connectionText.textContent = "Connecting Realtime...";
      connectionText.className = "text-slate-300";
      connectionPill.className =
        "flex items-center space-x-2 px-3 py-1 rounded-full bg-slate-950 border border-slate-800 text-xs font-mono";
    }
  }

  /**
   * Load operational sites for filtering
   */
  async function loadSites() {
    try {
      const { data, error } = await supabase
        .from("sites")
        .select("id, name, code")
        .eq("company_id", AppConfig.COMPANY_ID)
        .order("name");

      if (error) throw error;
      allSites = data || [];

      // Populate filter dropdown
      siteFilter.innerHTML = '<option value="ALL">All Operational Sites</option>';
      allSites.forEach((site) => {
        const opt = document.createElement("option");
        opt.value = site.id;
        opt.textContent = `${site.name} (${site.code})`;
        siteFilter.appendChild(opt);
      });
    } catch (err) {
      console.error("Failed to load sites:", err);
    }
  }

  /**
   * Fetch all requisitions with line items and relational metadata
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
          items:requisition_items(*)
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
            // If the modal is currently open on this requisition, refresh it
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
   * Filter requisitions based on active filter controls
   */
  function getFilteredRequisitions() {
    return allRequisitions.filter((req) => {
      // Exclude cancelled unless explicitly searching
      if (req.status === "CANCELLED" && !filters.search) {
        return false;
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
        const requesterMatch = req.requester && req.requester.name && req.requester.name.toLowerCase().includes(q);
        const textMatch = req.raw_message_text && req.raw_message_text.toLowerCase().includes(q);
        const itemMatch =
          Array.isArray(req.items) &&
          req.items.some((it) => it.item_description && it.item_description.toLowerCase().includes(q));

        if (!refMatch && !poMatch && !requesterMatch && !textMatch && !itemMatch) {
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

    // Reset columns
    const grouped = {
      LOGGED: [],
      PENDING_QUOTE: [],
      PO_PLACED: [],
      DELIVERED_TO_SITE: [],
      CLOSED: [],
    };

    let totalZar = 0;

    filtered.forEach((req) => {
      if (grouped[req.status]) {
        grouped[req.status].push(req);
      }
      totalZar += parseFloat(req.total_estimated_zar || 0);
    });

    // Update global metrics
    statsTotalCount.textContent = filtered.length;
    statsTotalZar.textContent = formatCurrencyZAR(totalZar);

    // Render each column
    COLUMNS.forEach((colKey) => {
      const container = document.getElementById(`col_${colKey}`);
      const countBadge = document.getElementById(`count_${colKey}`);
      const cards = grouped[colKey] || [];

      countBadge.textContent = cards.length;
      container.innerHTML = "";

      if (cards.length === 0) {
        container.innerHTML = `
          <div class="h-32 flex flex-col items-center justify-center border-2 border-dashed border-slate-800/80 rounded-xl text-slate-600 text-xs font-mono">
            <span>No tickets in this stage</span>
          </div>
        `;
        return;
      }

      cards.forEach((req) => {
        const cardEl = createCardElement(req);
        container.appendChild(cardEl);
      });
    });

    lucide.createIcons();
  }

  /**
   * Generate card DOM node
   */
  function createCardElement(req) {
    const card = document.createElement("div");
    const isCritical = req.urgency === "CRITICAL_BREAKDOWN";
    const isUrgent = req.urgency === "URGENT";

    // Urgency styling
    let urgencyBadge = "";
    if (isCritical) {
      urgencyBadge = `
        <span class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-red-950/80 text-red-300 border border-red-800/80 animate-pulse">
          <i data-lucide="flame" class="w-3 h-3 text-red-400"></i>
          <span>Critical Breakdown</span>
        </span>
      `;
    } else if (isUrgent) {
      urgencyBadge = `
        <span class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-950/80 text-amber-300 border border-amber-800/80">
          <i data-lucide="alert-circle" class="w-3 h-3 text-amber-400"></i>
          <span>Urgent</span>
        </span>
      `;
    } else {
      urgencyBadge = `
        <span class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase bg-slate-800 text-slate-300 border border-slate-700">
          <span>Routine</span>
        </span>
      `;
    }

    // Duplicate Badge
    let duplicateBanner = "";
    if (req.is_duplicate_suspect) {
      duplicateBanner = `
        <div class="mb-2 px-2.5 py-1 rounded-md bg-amber-950/70 border border-amber-600/50 flex items-center justify-between text-[11px] text-amber-300">
          <div class="flex items-center space-x-1.5 font-semibold">
            <i data-lucide="alert-triangle" class="w-3.5 h-3.5 text-amber-400"></i>
            <span>7-Day Duplicate Suspect</span>
          </div>
          <span class="text-[10px] underline font-mono">Inspect</span>
        </div>
      `;
    }

    // PO number badge if assigned
    let poBadge = "";
    if (req.po_number) {
      poBadge = `
        <span class="px-2 py-0.5 rounded font-mono text-[11px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 shadow-sm">
          ${req.po_number}
        </span>
      `;
    }

    // Items preview
    const items = req.items || [];
    let itemsPreview = "";
    if (items.length > 0) {
      const topItems = items.slice(0, 2);
      itemsPreview = topItems
        .map(
          (it) => `
        <div class="flex items-center justify-between text-[11px] text-slate-300 font-mono">
          <span class="truncate max-w-[190px]">&bull; ${it.quantity}x ${it.item_description}</span>
          <span class="text-slate-500">${it.pastel_item_code || ""}</span>
        </div>
      `
        )
        .join("");
      if (items.length > 2) {
        itemsPreview += `<div class="text-[10px] text-slate-500 font-mono mt-0.5">+${items.length - 2} more line items</div>`;
      }
    } else {
      itemsPreview = `<div class="text-[11px] text-slate-500 italic truncate">${req.raw_message_text || "No items listed"}</div>`;
    }

    const siteName = req.site ? req.site.name : "Unassigned Site";
    const zoneName = req.zone ? ` &bull; ${req.zone.name}` : "";
    const requesterName = req.requester ? req.requester.name : "Field Requester";

    const nextConfig = NEXT_STATUS[req.status];
    let nextActionButton = "";
    if (nextConfig) {
      nextActionButton = `
        <button
          type="button"
          class="card-advance-btn text-[11px] px-2.5 py-1 rounded bg-slate-800 hover:bg-emerald-600 hover:text-slate-950 font-semibold text-slate-300 border border-slate-700 hover:border-emerald-500 flex items-center space-x-1 transition-all"
          data-id="${req.id}"
          data-next="${nextConfig.next}"
          title="Advance to ${nextConfig.next}"
        >
          <span>${nextConfig.label}</span>
          <i data-lucide="${nextConfig.icon}" class="w-3 h-3"></i>
        </button>
      `;
    }

    card.className = `p-3.5 bg-slate-900 border ${
      isCritical ? "border-red-900/80 shadow-red-950/20" : isUrgent ? "border-amber-900/60" : "border-slate-800"
    } rounded-xl shadow-md hover:border-slate-700 transition-all cursor-pointer group flex flex-col justify-between space-y-3`;

    card.innerHTML = `
      <div>
        ${duplicateBanner}
        <div class="flex items-center justify-between gap-1 mb-2">
          <div class="flex items-center space-x-2">
            <span class="font-mono font-bold text-xs text-white group-hover:text-emerald-400 transition-colors">
              ${req.reference_code}
            </span>
            ${poBadge}
          </div>
          ${urgencyBadge}
        </div>

        <div class="text-[11px] text-slate-400 flex items-center space-x-1.5 mb-2 font-medium">
          <i data-lucide="map-pin" class="w-3 h-3 text-slate-500"></i>
          <span class="truncate">${siteName}${zoneName}</span>
        </div>

        <div class="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2.5 space-y-1 mb-2">
          ${itemsPreview}
        </div>

        <div class="flex items-center justify-between text-[11px] text-slate-400">
          <div class="flex items-center space-x-1 truncate max-w-[140px]">
            <i data-lucide="user" class="w-3 h-3 text-slate-500"></i>
            <span class="truncate">${requesterName}</span>
          </div>
          <span class="font-mono text-slate-500">${formatRelativeTime(req.created_at)}</span>
        </div>
      </div>

      <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between">
        <span class="font-mono text-xs font-bold text-emerald-400">${formatCurrencyZAR(req.total_estimated_zar)}</span>
        ${nextActionButton}
      </div>
    `;

    // Click on card body opens inspection modal
    card.addEventListener("click", (e) => {
      // Ignore click if button was clicked
      if (e.target.closest(".card-advance-btn")) return;
      openInspectionModal(req);
    });

    // Advance button click
    const advanceBtn = card.querySelector(".card-advance-btn");
    if (advanceBtn) {
      advanceBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const reqId = advanceBtn.getAttribute("data-id");
        const nextState = advanceBtn.getAttribute("data-next");
        await transitionRequisitionStatus(reqId, nextState);
      });
    }

    return card;
  }

  /**
   * Advance Requisition through the state machine
   */
  async function transitionRequisitionStatus(reqId, nextStatus) {
    try {
      // Optimistic update
      const target = allRequisitions.find((r) => r.id === reqId);
      if (!target) return;
      const prevStatus = target.status;
      target.status = nextStatus;
      renderBoard();

      const { data, error } = await supabase
        .from("requisitions")
        .update({ status: nextStatus })
        .eq("id", reqId)
        .select()
        .single();

      if (error) {
        // Rollback
        target.status = prevStatus;
        renderBoard();
        throw error;
      }

      showToast("Status Updated", `${target.reference_code} moved to ${nextStatus}`, "success");
      await fetchRequisitions();
    } catch (err) {
      console.error("Transition failed:", err);
      showToast("Update Failed", err.message, "error");
    }
  }

  /**
   * Open Requisition Inspection Modal
   */
  function openInspectionModal(req) {
    selectedRequisition = req;
    modalRefCode.textContent = req.reference_code;

    // PO Badge
    if (req.po_number) {
      modalPoBadge.textContent = req.po_number;
      modalPoBadge.classList.remove("hidden");
    } else {
      modalPoBadge.classList.add("hidden");
    }

    // Urgency Badge
    modalUrgencyBadge.textContent = req.urgency.replace("_", " ");
    modalUrgencyBadge.className = `px-2 py-0.5 rounded text-xs font-bold uppercase ${
      req.urgency === "CRITICAL_BREAKDOWN"
        ? "bg-red-950 text-red-300 border border-red-800"
        : req.urgency === "URGENT"
        ? "bg-amber-950 text-amber-300 border border-amber-800"
        : "bg-slate-800 text-slate-300 border border-slate-700"
    }`;

    // Site & Zone
    const siteName = req.site ? req.site.name : "Unassigned Site";
    const zoneName = req.zone ? ` • ${req.zone.name}` : "";
    modalSiteZone.textContent = `${siteName}${zoneName}`;

    // Requester
    const requesterName = req.requester ? req.requester.name : "Unknown Requester";
    const requesterPhone = req.requester ? ` (${req.requester.phone_number})` : "";
    modalRequesterName.textContent = `• ${requesterName}${requesterPhone}`;
    modalCreatedAt.textContent = new Date(req.created_at).toLocaleString("en-ZA");

    // WhatsApp Transcript
    modalRawText.textContent = req.raw_message_text ? `"${req.raw_message_text}"` : "No voice note transcript logged.";

    // Duplicate Suspect Details
    if (req.is_duplicate_suspect) {
      modalDuplicateWarning.classList.remove("hidden");
      modalDuplicateRef.textContent = req.duplicate_of_id ? `prior requisition (${req.duplicate_of_id.slice(0, 8)})` : "recent order";
    } else {
      modalDuplicateWarning.classList.add("hidden");
    }

    // Render Line Items
    const items = req.items || [];
    modalItemCount.textContent = `${items.length} line item${items.length === 1 ? "" : "s"}`;
    modalItemsTableBody.innerHTML = "";

    let subtotalZar = 0;

    if (items.length === 0) {
      modalItemsTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="p-4 text-center text-slate-500 italic">No line items extracted.</td>
        </tr>
      `;
    } else {
      items.forEach((item) => {
        const qty = parseFloat(item.quantity || 1.0);
        const unitPrice = parseFloat(item.unit_price_zar || 0.0);
        const lineTotal = qty * unitPrice;
        subtotalZar += lineTotal;

        const row = document.createElement("tr");
        row.className = "hover:bg-slate-900/50 transition-colors";
        row.innerHTML = `
          <td class="p-3 text-slate-200 font-sans font-medium">${item.item_description}</td>
          <td class="p-3 text-slate-300">${qty.toFixed(2)}</td>
          <td class="p-3 text-slate-400">${item.unit_of_measure || "units"}</td>
          <td class="p-3 text-slate-400">${item.part_number || "-"}</td>
          <td class="p-3 text-emerald-400 font-semibold">${item.pastel_item_code || "GEN-STOCK"}</td>
          <td class="p-3 text-right text-slate-300">${formatCurrencyZAR(unitPrice)}</td>
          <td class="p-3 text-right text-emerald-300 font-bold">${formatCurrencyZAR(lineTotal)}</td>
        `;
        modalItemsTableBody.appendChild(row);
      });
    }

    // Valuation
    const vatZar = subtotalZar * 0.15;
    const grandTotalZar = subtotalZar + vatZar;
    modalValuationSubtotal.textContent = formatCurrencyZAR(subtotalZar);
    modalValuationVat.textContent = formatCurrencyZAR(vatZar);
    modalValuationTotal.textContent = formatCurrencyZAR(grandTotalZar > 0 ? grandTotalZar : req.total_estimated_zar);

    // Supplier & Notes
    modalSupplierInput.value = req.supplier_name || "";
    modalNotesInput.value = req.notes || "";

    // Status Advance Button Config
    const nextConfig = NEXT_STATUS[req.status];
    if (nextConfig) {
      modalAdvanceStatusBtn.classList.remove("hidden");
      modalAdvanceStatusText.textContent = `Advance: ${nextConfig.label}`;
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
   * Save Supplier and Notes
   */
  async function saveSupplierAndNotes() {
    if (!selectedRequisition) return;
    const supplier_name = modalSupplierInput.value.trim();
    const notes = modalNotesInput.value.trim();

    modalSaveSupplierBtn.disabled = true;
    modalSaveSupplierBtn.textContent = "Saving...";

    try {
      const { error } = await supabase
        .from("requisitions")
        .update({ supplier_name, notes })
        .eq("id", selectedRequisition.id);

      if (error) throw error;
      selectedRequisition.supplier_name = supplier_name;
      selectedRequisition.notes = notes;
      showToast("Saved", "Supplier and notes updated.", "success");
      await fetchRequisitions();
    } catch (err) {
      showToast("Error", err.message, "error");
    } finally {
      modalSaveSupplierBtn.disabled = false;
      modalSaveSupplierBtn.textContent = "Save";
    }
  }

  /**
   * Clear Duplicate Flag
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
      showToast("Duplicate Cleared", "Requisition marked as authentic / non-duplicate.", "success");
      await fetchRequisitions();
    } catch (err) {
      showToast("Error", err.message, "error");
    }
  }

  /**
   * Cancel Requisition
   */
  async function cancelRequisition() {
    if (!selectedRequisition) return;
    if (!confirm(`Are you sure you want to cancel requisition ${selectedRequisition.reference_code}?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from("requisitions")
        .update({ status: "CANCELLED" })
        .eq("id", selectedRequisition.id);

      if (error) throw error;
      showToast("Cancelled", `${selectedRequisition.reference_code} was marked as CANCELLED`, "info");
      closeInspectionModal();
      await fetchRequisitions();
    } catch (err) {
      showToast("Error", err.message, "error");
    }
  }

  /**
   * Export Single Requisition to Sage Pastel CSV
   */
  function exportSinglePastel() {
    if (!selectedRequisition) return;
    try {
      const csv = PastelExporter.generatePastelCSV([selectedRequisition]);
      const filename = `pastel_${selectedRequisition.po_number || selectedRequisition.reference_code}_${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      PastelExporter.triggerCSVDownload(csv, filename);
      showToast("Export Successful", `Downloaded ${filename} for Sage Pastel`, "success");
    } catch (err) {
      showToast("Export Failed", err.message, "error");
    }
  }

  /**
   * Export Batch of PO_PLACED & Approved Requisitions to Sage Pastel CSV
   */
  function exportBatchPastel() {
    const candidateReqs = allRequisitions.filter(
      (r) => r.status === "PO_PLACED" || r.status === "DELIVERED_TO_SITE" || r.status === "CLOSED"
    );

    if (candidateReqs.length === 0) {
      showToast(
        "No Exportable POs",
        "There are no requisitions in 'PO_PLACED', 'DELIVERED', or 'CLOSED' status to export.",
        "warning"
      );
      return;
    }

    try {
      const csv = PastelExporter.generatePastelCSV(candidateReqs);
      const filename = `pastel_batch_${new Date().toISOString().slice(0, 10)}.csv`;
      PastelExporter.triggerCSVDownload(csv, filename);
      showToast("Batch Exported", `Generated Pastel batch with ${candidateReqs.length} orders.`, "success");
    } catch (err) {
      showToast("Export Failed", err.message, "error");
    }
  }

  /**
   * Event Listeners Setup
   */
  function attachEventListeners() {
    // Site filter
    siteFilter.addEventListener("change", () => {
      filters.siteId = siteFilter.value;
      renderBoard();
    });

    // Urgency filter
    urgencyFilter.addEventListener("change", () => {
      filters.urgency = urgencyFilter.value;
      renderBoard();
    });

    // Unassigned checkbox
    unassignedFilter.addEventListener("change", () => {
      filters.unassignedOnly = unassignedFilter.checked;
      renderBoard();
    });

    // Duplicates only checkbox
    duplicatesOnlyFilter.addEventListener("change", () => {
      filters.duplicatesOnly = duplicatesOnlyFilter.checked;
      renderBoard();
    });

    // Search query input
    searchInput.addEventListener("input", () => {
      filters.search = searchInput.value.trim();
      renderBoard();
    });

    // Relief-Admin Triage Mode toggle
    reliefToggleBtn.addEventListener("click", () => {
      const isVisible = !reliefBanner.classList.contains("hidden");
      if (isVisible) {
        reliefBanner.classList.add("hidden");
        reliefToggleBtn.classList.remove("bg-amber-500/20", "border-amber-500");
      } else {
        reliefBanner.classList.remove("hidden");
        reliefToggleBtn.classList.add("bg-amber-500/20", "border-amber-500");
      }
    });

    dismissReliefBannerBtn.addEventListener("click", () => {
      reliefBanner.classList.add("hidden");
      reliefToggleBtn.classList.remove("bg-amber-500/20", "border-amber-500");
    });

    // Quick Claim Unassigned Ticket
    quickClaimUnassignedBtn.addEventListener("click", async () => {
      const unassigned = allRequisitions.find((r) => !r.assigned_buyer_id && r.status !== "CANCELLED");
      if (!unassigned) {
        showToast("Queue Empty", "No unassigned requisitions found.", "info");
        return;
      }
      openInspectionModal(unassigned);
      showToast("Claimed Requisition", `Loaded ${unassigned.reference_code} for active review.`, "success");
    });

    // Sage Pastel Batch Export
    batchExportPastelBtn.addEventListener("click", exportBatchPastel);

    // Modal Actions
    closeModalBtn.addEventListener("click", closeInspectionModal);
    inspectionModal.addEventListener("click", (e) => {
      if (e.target === inspectionModal) closeInspectionModal();
    });

    modalSaveSupplierBtn.addEventListener("click", saveSupplierAndNotes);
    modalDismissDuplicateBtn.addEventListener("click", dismissDuplicateFlag);
    modalCancelReqBtn.addEventListener("click", cancelRequisition);
    modalExportPastelBtn.addEventListener("click", exportSinglePastel);

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
        modalPlayAudioBtn.classList.add("bg-emerald-500/40");
        showToast("Audio Playback", "Streaming Whisper audio recording...", "info");
      } else {
        modalPlayAudioBtn.innerHTML = '<i data-lucide="play" class="w-4 h-4 ml-0.5"></i>';
        modalPlayAudioBtn.classList.remove("bg-emerald-500/40");
      }
      lucide.createIcons({ root: modalPlayAudioBtn });
    });

    // Sign Out
    signOutBtn.addEventListener("click", async () => {
      AppConfig.setDemoSession(false);
      const client = AppConfig.getSupabase();
      if (client) {
        await client.auth.signOut();
      }
      window.location.href = "index.html";
    });
  }

  /**
   * App Initializer
   */
  async function init() {
    supabase = AppConfig.getSupabase();
    if (!supabase) {
      console.error("Supabase client not initialized.");
      return;
    }

    // Auth verification
    const isDemo = AppConfig.isDemoSession();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!isDemo && !session) {
      window.location.href = "index.html";
      return;
    }

    userEmailSpan.textContent = AppConfig.getActiveUserEmail();

    attachEventListeners();
    await loadSites();
    await fetchRequisitions();
    setupRealtimeSync();
  }

  // Bootstrap when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
