/**
 * pastel-export.js
 * Client-Side Sage Pastel Partner/Evolution CSV Batch Generator
 * Conforms to ADR-0004 & validated via scripts/validate-pastel-csv.py
 */

(function (window) {
  const REQUIRED_HEADERS = [
    "RecordType",
    "DocumentNumber",
    "Date",
    "SupplierCode",
    "ItemCode",
    "Description",
    "Quantity",
    "UnitPrice",
    "TaxCode",
  ];

  /**
   * Sanitizes a cell to neutralize CSV formula injection in spreadsheet viewers.
   * Prepends a single quote if the first character is =, +, -, @, or tab.
   * Encloses values in double quotes if commas, quotes, or newlines are present.
   */
  function sanitizeCell(value) {
    if (value === null || value === undefined) {
      return '""';
    }
    let str = String(value).trim();

    // Neutralize formula injection
    const firstChar = str.charAt(0);
    if (firstChar === "=" || firstChar === "+" || firstChar === "-" || firstChar === "@" || firstChar === "\t") {
      str = "'" + str;
    }

    // Escape double quotes by doubling them
    str = str.replace(/"/g, '""');

    // Quote if contains comma, quote, or newline, or always quote text
    return `"${str}"`;
  }

  /**
   * Format date into DD/MM/YYYY
   */
  function formatDateDDMMYYYY(dateInput) {
    const d = dateInput ? new Date(dateInput) : new Date();
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  /**
   * Format numeric quantities and unit prices
   */
  function formatNumeric(val, decimals = 2) {
    const n = parseFloat(val);
    if (isNaN(n)) return (0).toFixed(decimals);
    return n.toFixed(decimals);
  }

  /**
   * Generate CSV rows string from requisitions data
   * @param {Array} requisitions - List of requisition objects containing items array
   * @returns {string} CSV text formatted with CRLF line breaks
   */
  function generatePastelCSV(requisitions) {
    if (!Array.isArray(requisitions) || requisitions.length === 0) {
      throw new Error("No requisitions provided for Pastel CSV export.");
    }

    const rows = [];
    // Header row
    rows.push(REQUIRED_HEADERS.join(","));

    for (const req of requisitions) {
      const docNum = req.po_number || req.reference_code || "PO-DRAFT";
      const docDate = formatDateDDMMYYYY(req.created_at);
      const supplierCode = req.supplier_name ? req.supplier_name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 20) : "GEN_SUPP";
      const items = Array.isArray(req.items) && req.items.length > 0 ? req.items : (req.requisition_items || []);

      if (items.length === 0) {
        // Fallback row if no child line items exist
        const row = [
          "DETAIL",
          sanitizeCell(docNum),
          sanitizeCell(docDate),
          sanitizeCell(supplierCode),
          sanitizeCell("GEN-STOCK"),
          sanitizeCell(req.raw_message_text ? req.raw_message_text.slice(0, 80) : "General Requisition Spares"),
          formatNumeric(1.0, 2),
          formatNumeric(req.total_estimated_zar || 0.0, 2),
          "01",
        ];
        rows.push(row.join(","));
      } else {
        for (const item of items) {
          const itemCode = item.pastel_item_code || item.part_number || "GEN-STOCK";
          const desc = item.item_description || "Requisition Line Item";
          const qty = formatNumeric(item.quantity || 1.0, 2);
          const unitPrice = formatNumeric(item.unit_price_zar || 0.0, 2);

          const row = [
            "DETAIL",
            sanitizeCell(docNum),
            sanitizeCell(docDate),
            sanitizeCell(supplierCode),
            sanitizeCell(itemCode),
            sanitizeCell(desc),
            qty,
            unitPrice,
            "01", // Standard 15% SA VAT Tax Code
          ];
          rows.push(row.join(","));
        }
      }
    }

    return rows.join("\r\n") + "\r\n";
  }

  /**
   * Trigger client-side browser file download
   */
  function triggerCSVDownload(csvContent, filename) {
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename || `pastel_batch_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // Export functions to global scope
  window.PastelExporter = {
    REQUIRED_HEADERS,
    generatePastelCSV,
    triggerCSVDownload,
    sanitizeCell,
    formatDateDDMMYYYY,
  };
})(typeof window !== "undefined" ? window : globalThis);
