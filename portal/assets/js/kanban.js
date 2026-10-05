/**
 * kanban.js
 * Master Operational Tracker & Kanban Pipeline Controller for Supply Conduit
 * Real-time PostgREST sync, HTML5 drag-and-drop, 14-day archival, and automated delivery alerts.
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
  let realtimeChannel = null;
  let allRequisitions = [];
  let allSites = [];
  let selectedRequisition = null;
  let filters = {
    siteId: "ALL",
    urgency: "ALL",
    unassignedOnly: false,
    duplicatesOnly: false,
    showArchivedClosed: false,
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
  const showArchivedClosedToggle = document.getElementById("showArchivedClosedToggle");
  const searchInput = document.getElementById("searchInput");
  const reliefToggleBtn = document.getElementById("reliefToggleBtn");
  const reliefBanner = document.getElementById("reliefBanner");
  const dismissReliefBannerBtn = document.getElementById("dismissReliefBannerBtn");
  const quickClaimUnassignedBtn = document.getElementById("quickClaimUnassignedBtn");
  const statsTotalCount = document.getElementById("statsTotalCount");

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
  
  // Operational Inputs in Modal
  const modalSupplierInput = document.getElementById("modalSupplierInput");
  const modalPoNumberInput = document.getElementById("modalPoNumberInput");
  const modalNotesInput = document.getElementById("modalNotesInput");
  const modalSaveDetailsBtn = document.getElementById("modalSaveDetailsBtn");

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
    const date = new Date(dateString);
    const now = new Date();
    const diffSecs = Math.floor((now - date) / 1000);

    if (diffSecs < 60) return "Just now";
    if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
    if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
    return `${Math.floor(diffSecs / 86400)}d ago`;
  }

  /**
   * Formats multi-tier location: [Site Name] • [Zone Name] ([Location Detail]) or [Site Name] • [Zone Name / Detail]
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
        const diffDays = (now - completedDate) / (1000 * 60 * 60 * 24);
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

    // Update global metrics
    statsTotalCount.textContent = filtered.length;

    // Render each column
    COLUMNS.forEach((colKey) => {
      const container = document.getElementById(`col_${colKey}`);
      const countBadge = document.getElementById(`count_${colKey}`);
      const cards = grouped[colKey] || [];

      countBadge.textContent = cards.length;
      container.innerHTML = "";

      if (cards.length === 0) {
        container.innerHTML = `
          <div class="h-28 flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-xl text-slate-400 text-xs font-mono">
            <span>No orders in this stage</span>
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
   * Generate card DOM node with HTML5 drag-and-drop
   */
  function createCardElement(req) {
    const card = document.createElement("div");
    card.setAttribute("draggable", "true");
    card.classList.add("kanban-card");
    card.dataset.id = req.id;
    card.dataset.status = req.status;

    const isCritical = req.urgency === "CRITICAL_BREAKDOWN";
    const isUrgent = req.urgency === "URGENT";

    // Urgency styling
    let urgencyBadge = "";
    if (isCritical) {
      urgencyBadge = `
        <span class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-red-50 text-red-700 border border-red-200 animate-pulse">
          <i data-lucide="flame" class="w-3 h-3 text-red-500"></i>
          <span>Critical</span>
        </span>
      `;
    } else if (isUrgent) {
      urgencyBadge = `
        <span class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-50 text-amber-800 border border-amber-200">
          <i data-lucide="alert-circle" class="w-3 h-3 text-amber-600"></i>
          <span>Urgent</span>
        </span>
      `;
    } else {
      urgencyBadge = `
        <span class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase bg-slate-100 text-slate-600 border border-slate-200">
          <span>Routine</span>
        </span>
      `;
    }

    // Duplicate Badge
    let duplicateBanner = "";
    if (req.is_duplicate_suspect) {
      duplicateBanner = `
        <div class="mb-2 px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 flex items-center justify-between text-[11px] text-amber-800">
          <div class="flex items-center space-x-1.5 font-semibold">
            <i data-lucide="alert-triangle" class="w-3.5 h-3.5 text-amber-600"></i>
            <span>7-Day Duplicate Suspect</span>
          </div>
          <span class="text-[10px] underline font-mono">Inspect</span>
        </div>
      `;
    }

    // PO number / Supplier badge
    let poBadge = "";
    if (req.po_number) {
      poBadge = `
        <span class="px-2 py-0.5 rounded font-mono text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200 shadow-2xs">
          ${req.po_number}
        </span>
      `;
    }

    // Items preview (clean text without accounting codes)
    const items = req.items || [];
    let itemsPreview = "";
    if (items.length > 0) {
      const topItems = items.slice(0, 2);
      itemsPreview = topItems
        .map(
          (it) => `
        <div class="flex items-center justify-between text-[11px] text-slate-700">
          <span class="truncate max-w-[210px] font-medium">&bull; ${it.quantity} ${it.unit_of_measure || "units"} ${it.item_description}</span>
        </div>
      `
        )
        .join("");
      if (items.length > 2) {
        itemsPreview += `<div class="text-[10px] text-slate-400 font-medium mt-0.5">+${items.length - 2} more item${items.length - 2 > 1 ? "s" : ""}</div>`;
      }
    } else {
      itemsPreview = `<div class="text-[11px] text-slate-400 italic truncate">${req.raw_message_text || "No items listed"}</div>`;
    }

    const requesterName = req.requester ? req.requester.name : "Field Requester";
    const formattedLocationHtml = formatRequisitionLocation(req, true);

    const nextConfig = NEXT_STATUS[req.status];
    let nextActionButton = "";
    if (nextConfig) {
      nextActionButton = `
        <button
          type="button"
          class="card-advance-btn text-[11px] px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-emerald-600 hover:text-white font-semibold text-slate-700 border border-slate-200 hover:border-emerald-600 flex items-center space-x-1 transition-all shadow-2xs"
          data-id="${req.id}"
          data-next="${nextConfig.next}"
          title="Advance to ${nextConfig.next}"
        >
          <span>${nextConfig.label}</span>
          <i data-lucide="${nextConfig.icon}" class="w-3 h-3"></i>
        </button>
      `;
    }

    card.className = `p-3.5 bg-white border ${
      isCritical ? "border-red-300 shadow-red-100" : isUrgent ? "border-amber-300" : "border-slate-200"
    } rounded-xl shadow-xs hover:shadow-md hover:border-slate-300 transition-all cursor-pointer group flex flex-col justify-between space-y-2.5`;

    card.innerHTML = `
      <div>
        ${duplicateBanner}
        <div class="flex items-center justify-between gap-1 mb-1.5">
          <div class="flex items-center space-x-2">
            <span class="font-mono font-bold text-xs text-slate-900 group-hover:text-emerald-700 transition-colors">
              ${req.reference_code}
            </span>
            ${poBadge}
          </div>
          ${urgencyBadge}
        </div>

        <div class="text-[11px] text-slate-500 flex items-center space-x-1.5 mb-2 font-medium">
          <i data-lucide="map-pin" class="w-3 h-3 text-slate-400"></i>
          <span class="truncate">${formattedLocationHtml}</span>
        </div>

        <div class="bg-slate-50 border border-slate-100 rounded-lg p-2.5 space-y-1 mb-2">
          ${itemsPreview}
        </div>

        <div class="flex items-center justify-between text-[11px] text-slate-500">
          <div class="flex items-center space-x-1 truncate max-w-[150px]">
            <i data-lucide="user" class="w-3 h-3 text-slate-400"></i>
            <span class="truncate font-medium text-slate-600">${requesterName}</span>
          </div>
          <span class="font-mono text-slate-400">${formatRelativeTime(req.created_at)}</span>
        </div>
      </div>

      <div class="pt-2 border-t border-slate-100 flex items-center justify-between">
        <span class="text-[11px] font-semibold text-slate-500 truncate max-w-[120px]">${req.supplier_name || "Unassigned Vendor"}</span>
        ${nextActionButton}
      </div>
    `;

    // Click card opens inspection modal
    card.addEventListener("click", (e) => {
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

    // HTML5 Drag Event Handlers
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", req.id);
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("is-dragging");
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("is-dragging");
    });

    return card;
  }

  /**
   * Advance Requisition through the state machine and trigger automated delivery alert if delivered
   */
  async function transitionRequisitionStatus(reqId, nextStatus) {
    try {
      const target = allRequisitions.find((r) => r.id === reqId);
      if (!target) return;
      const prevStatus = target.status;
      target.status = nextStatus;
      renderBoard();

      const { data, error } = await supabase
        .from("requisitions")
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
        .eq("id", reqId)
        .select()
        .single();

      if (error) {
        target.status = prevStatus;
        renderBoard();
        throw error;
      }

      showToast("Status Updated", `${target.reference_code} moved to ${nextStatus}`, "success");

      // Automated Delivery Alert: if transitioned to DELIVERED_TO_SITE, dispatch WhatsApp arrival alert
      if (nextStatus === "DELIVERED_TO_SITE") {
        console.log(`[Delivery Alert] Triggering delivery arrival alert for ${target.reference_code}...`);
        supabase.functions
          .invoke("notify-field-manager", {
            body: { id: reqId, status: "DELIVERED_TO_SITE" },
          })
          .then((res) => {
            if (res.error) {
              console.warn("[Delivery Alert] notify-field-manager warning:", res.error);
            } else {
              showToast("Delivery Alert Dispatched", "WhatsApp delivery arrival message sent to requester.", "info");
            }
          })
          .catch((err) => {
            console.warn("[Delivery Alert] Outbound error:", err);
          });
      }

      await fetchRequisitions();
    } catch (err) {
      console.error("Transition failed:", err);
      showToast("Update Failed", err.message, "error");
    }
  }

  /**
   * Setup Native HTML5 Drop Targets on Kanban Columns
   */
  function setupColumnDropTargets() {
    COLUMNS.forEach((colKey) => {
      const colEl = document.getElementById(`col_${colKey}`);
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

        const target = allRequisitions.find((r) => r.id === reqId);
        if (target && target.status !== colKey) {
          await transitionRequisitionStatus(reqId, colKey);
        }
      });
    });
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
        ? "bg-red-50 text-red-700 border border-red-200"
        : req.urgency === "URGENT"
        ? "bg-amber-50 text-amber-800 border border-amber-200"
        : "bg-slate-100 text-slate-700 border border-slate-200"
    }`;

    // Site & Zone
    modalSiteZone.textContent = formatRequisitionLocation(req, false);

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

    // Render Streamlined Line Items (Description, Quantity, UOM only)
    const items = req.items || [];
    modalItemCount.textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
    modalItemsTableBody.innerHTML = "";

    if (items.length === 0) {
      modalItemsTableBody.innerHTML = `
        <tr>
          <td colspan="3" class="p-4 text-center text-slate-400 italic">No line items extracted.</td>
        </tr>
      `;
    } else {
      items.forEach((item) => {
        const qty = parseFloat(item.quantity || 1.0);
        const row = document.createElement("tr");
        row.className = "hover:bg-slate-50 transition-colors";
        row.innerHTML = `
          <td class="p-3 text-slate-800 font-medium">${item.item_description}</td>
          <td class="p-3 text-slate-700 font-mono">${qty.toFixed(2)}</td>
          <td class="p-3 text-slate-500 font-mono">${item.unit_of_measure || "units"}</td>
        `;
        modalItemsTableBody.appendChild(row);
      });
    }

    // Populate Operational Inputs
    modalSupplierInput.value = req.supplier_name || "";
    modalPoNumberInput.value = req.po_number || "";
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
   * Save Operational Details (Supplier, Invoice/PO Ref, Notes)
   */
  async function saveOperationalDetails() {
    if (!selectedRequisition) return;
    const supplier_name = modalSupplierInput.value.trim();
    const po_number = modalPoNumberInput.value.trim();
    const notes = modalNotesInput.value.trim();

    modalSaveDetailsBtn.disabled = true;
    modalSaveDetailsBtn.textContent = "Saving...";

    try {
      const { error } = await supabase
        .from("requisitions")
        .update({
          supplier_name: supplier_name || null,
          po_number: po_number || null,
          notes: notes || null,
        })
        .eq("id", selectedRequisition.id);

      if (error) throw error;

      selectedRequisition.supplier_name = supplier_name;
      selectedRequisition.po_number = po_number;
      selectedRequisition.notes = notes;

      showToast("Details Saved", "Supplier and operational notes updated.", "success");
      await fetchRequisitions();
    } catch (err) {
      showToast("Save Error", err.message, "error");
    } finally {
      modalSaveDetailsBtn.disabled = false;
      modalSaveDetailsBtn.textContent = "Save Details";
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

    // Archived closed toggle (14-day retention rule)
    if (showArchivedClosedToggle) {
      showArchivedClosedToggle.addEventListener("change", () => {
        filters.showArchivedClosed = showArchivedClosedToggle.checked;
        renderBoard();
      });
    }

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
        reliefToggleBtn.classList.remove("bg-amber-100", "border-amber-300");
      } else {
        reliefBanner.classList.remove("hidden");
        reliefToggleBtn.classList.add("bg-amber-100", "border-amber-300");
      }
    });

    dismissReliefBannerBtn.addEventListener("click", () => {
      reliefBanner.classList.add("hidden");
      reliefToggleBtn.classList.remove("bg-amber-100", "border-amber-300");
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

    // Modal Actions
    closeModalBtn.addEventListener("click", closeInspectionModal);
    inspectionModal.addEventListener("click", (e) => {
      if (e.target === inspectionModal) closeInspectionModal();
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
    setupColumnDropTargets();
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
