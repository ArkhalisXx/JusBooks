/**
 * Administrative report generation and export (F11).
 * generate() builds the query and fetches data via the db adapter.
 * export() converts to CSV or JSON.
 */
class Report {
  constructor(reportID, reportType, generatedBy, generatedAt = new Date(), content = null) {
    this.reportID    = reportID;
    this.reportType  = reportType;  // 'borrowed' | 'overdue' | 'frequent' | 'payments'
    this.generatedBy = generatedBy; // librarianID
    this.generatedAt = generatedAt;
    this.content     = content;     // raw array from DB after generate()
  }

  // ── Generate ──────────────────────────────────────────────────────────────────

  /**
   * Fetches report data from the DB.
   * @param {object} db       - db adapter with a query(sql, values) method
   * @param {object} [opts]   - { startDate, endDate, limit }
   * @returns {Promise<Report>}
   */
  async generate(db, opts = {}) {
    const { sql, values } = this._buildQuery(opts);

    const rows = await db.query(sql, values);
    this.content     = rows;
    this.generatedAt = new Date();

    console.log(`[Report] "${this.reportType}" — ${rows.length} row(s) fetched.`);
    return this;
  }

  // ── Query Builders ────────────────────────────────────────────────────────────

  _buildQuery(opts = {}) {
    const { startDate, endDate, limit = 500 } = opts;
    const dateFilter = startDate && endDate
      ? "AND bt.issue_date BETWEEN ? AND ?"
      : "";
    const dateValues = startDate && endDate ? [startDate, endDate] : [];

    switch (this.reportType) {

      case "borrowed":
        return {
          sql: `
            SELECT
              bt.transaction_id,
              m.username     AS member_name,
              m.email        AS member_email,
              b.title        AS book_title,
              b.isbn,
              bt.issue_date,
              bt.due_date,
              bt.status
            FROM borrow_transactions bt
            JOIN users m ON m.user_id = bt.member_id
            JOIN books b ON b.book_id  = bt.book_id
            WHERE bt.status IN ('active', 'overdue')
            ${dateFilter}
            ORDER BY bt.issue_date DESC
            LIMIT ?
          `,
          values: [...dateValues, limit],
        };

      case "overdue":
        return {
          sql: `
            SELECT
              bt.transaction_id,
              m.username    AS member_name,
              m.email       AS member_email,
              b.title       AS book_title,
              bt.due_date,
              CAST((julianday('now') - julianday(bt.due_date)) AS INTEGER) AS days_overdue,
              ROUND(CAST((julianday('now') - julianday(bt.due_date)) AS REAL) * 5.00, 2) AS projected_fine
            FROM borrow_transactions bt
            JOIN users m ON m.user_id = bt.member_id
            JOIN books b ON b.book_id  = bt.book_id
            WHERE bt.status = 'overdue'
               OR (bt.status = 'active' AND bt.due_date < datetime('now'))
            ORDER BY days_overdue DESC
            LIMIT ?
          `,
          values: [limit],
        };

      case "frequent":
        return {
          sql: `
            SELECT
              b.book_id,
              b.title,
              b.author,
              b.category,
              COUNT(bt.transaction_id) AS borrow_count
            FROM borrow_transactions bt
            JOIN books b ON b.book_id = bt.book_id
            ${dateFilter ? `WHERE bt.issue_date IS NOT NULL ${dateFilter}` : ""}
            GROUP BY b.book_id
            ORDER BY borrow_count DESC
            LIMIT ?
          `,
          values: [...dateValues, limit],
        };

      case "payments":
        return {
          sql: `
            SELECT
              p.payment_id,
              m.username    AS member_name,
              m.email       AS member_email,
              p.amount,
              p.method,
              p.type,
              p.status,
              p.reference_id,
              p.timestamp
            FROM payments p
            JOIN users m ON m.user_id = p.member_id
            WHERE p.status = 'confirmed'
            ORDER BY p.timestamp DESC
            LIMIT ?
          `,
          values: [limit],
        };

      default:
        throw new Error(`Unknown report type: "${this.reportType}". Use: borrowed, overdue, frequent, payments.`);
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────────

  /**
   * Exports report content to CSV or JSON string.
   * @param {'csv'|'json'} format
   * @returns {string}
   */
  export(format = "csv") {
    if (!this.content || this.content.length === 0) {
      throw new Error("No data to export. Run generate() first.");
    }

    if (format === "json") {
      return JSON.stringify({ reportType: this.reportType, generatedAt: this.generatedAt, data: this.content }, null, 2);
    }

    if (format === "csv") {
      const headers = Object.keys(this.content[0]);
      const escape  = (val) => {
        if (val === null || val === undefined) return "";
        const str = String(val).replace(/"/g, '""');
        return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str}"` : str;
      };

      const rows = this.content.map(row =>
        headers.map(h => escape(row[h])).join(",")
      );

      return [headers.join(","), ...rows].join("\n");
    }

    throw new Error(`Unsupported export format: "${format}". Use 'csv' or 'json'.`);
  }

  /**
   * Returns filename for download.
   * @param {'csv'|'json'} format
   */
  getFilename(format = "csv") {
    const ts = new Date().toISOString().slice(0, 10);
    return `jusbooks_${this.reportType}_report_${ts}.${format}`;
  }

  toJSON() {
    return {
      reportID   : this.reportID,
      reportType : this.reportType,
      generatedBy: this.generatedBy,
      generatedAt: this.generatedAt,
      rowCount   : this.content?.length ?? 0,
    };
  }
}

module.exports = Report;
