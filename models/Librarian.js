const { User } = require("./User");

/**
 * Library staff with administrative privileges.
 * RBAC enforced: only librarians can manage books, members, and reports.
 */
class Librarian extends User {
  constructor(userID, username, email, password, staffID, department) {
    super(userID, username, email, password, "librarian");
    this.staffID    = staffID;
    this.department = department;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────────

  /**
   * Logs in a librarian. Same pattern as Member.login().
   * @param {string}   email
   * @param {string}   plainPassword
   * @param {Function} findUserByEmail - async (email) => user row
   * @returns {Promise<{ token: string, user: object }>}
   */
  static async login(email, plainPassword, findUserByEmail) {
    if (!email || !plainPassword) throw new Error("Email and password are required.");

    const row = await findUserByEmail(email);
    if (!row) throw new Error("Invalid email or password.");
    if (row.role !== "librarian") throw new Error("Invalid email or password.");

    const valid = await User.verifyPassword(plainPassword, row.password);
    if (!valid) throw new Error("Invalid email or password.");

    const librarian = new Librarian(
      row.userID, row.username, row.email, row.password,
      row.staffID, row.department
    );

    const token = librarian.generateToken();
    return { token, user: librarian.toPublic() };
  }

  logout() {
    console.log(`Librarian ${this.username} logged out.`);
  }

  // ── Book Management (F1) ──────────────────────────────────────────────────────

  /**
   * Validates and prepares a book record for DB persistence.
   * @param {'add'|'edit'|'delete'} action
   * @param {object} bookData - { title, author, ISBN, category, description, quantity }
   * @param {number} [bookID] - required for edit/delete
   * @returns {object} validated book payload
   */
  manageBooks(action, bookData, bookID = null) {
    this._assertRole("librarian");

    if (action === "add") {
      const required = ["title", "author", "ISBN", "category", "quantity"];
      for (const field of required) {
        if (!bookData[field]) throw new Error(`Missing required field: ${field}`);
      }
      if (bookData.quantity < 1) throw new Error("Quantity must be at least 1.");

      // TODO: db.insertBook({ ...bookData, availableQty: bookData.quantity })
      return {
        action,
        payload: { ...bookData, availableQty: bookData.quantity },
      };
    }

    if (action === "edit") {
      if (!bookID) throw new Error("bookID is required for edit.");
      // TODO: db.updateBook(bookID, bookData)
      return { action, bookID, payload: bookData };
    }

    if (action === "delete") {
      if (!bookID) throw new Error("bookID is required for delete.");
      // TODO: check no active borrows before deleting
      // TODO: db.deleteBook(bookID)
      return { action, bookID };
    }

    throw new Error(`Unknown action: ${action}. Use 'add', 'edit', or 'delete'.`);
  }

  // ── Member Management (F9) ────────────────────────────────────────────────────

  /**
   * Manages member accounts.
   * @param {'register'|'update'|'suspend'|'activate'|'delete'} action
   * @param {object} memberData
   * @param {number} [memberID]
   * @returns {object} action payload
   */
  manageMembers(action, memberData, memberID = null) {
    this._assertRole("librarian");

    if (action === "register") {
      const required = ["username", "email", "password"];
      for (const field of required) {
        if (!memberData[field]) throw new Error(`Missing required field: ${field}`);
      }
      // Password will be hashed before DB insert — do NOT hash here twice
      // TODO: hash memberData.password via User.hashPassword(), then db.insertMember()
      return { action, payload: memberData };
    }

    if (["update", "suspend", "activate", "delete"].includes(action)) {
      if (!memberID) throw new Error("memberID is required.");
      if (action === "suspend") {
        // TODO: db.updateMemberStatus(memberID, 'suspended')
        return { action, memberID, status: "suspended" };
      }
      if (action === "activate") {
        // TODO: db.updateMemberStatus(memberID, 'active')
        return { action, memberID, status: "active" };
      }
      if (action === "update") {
        // TODO: db.updateMember(memberID, memberData)
        return { action, memberID, payload: memberData };
      }
      if (action === "delete") {
        // TODO: soft-delete or db.deleteMember(memberID)
        return { action, memberID };
      }
    }

    throw new Error(`Unknown action: ${action}.`);
  }

  // ── Report Generation (F11) ───────────────────────────────────────────────────

  /**
   * Builds a report query config. Pass to Report.generate().
   * @param {'borrowed'|'overdue'|'frequent'|'payments'} reportType
   * @param {object} [options] - { startDate, endDate }
   * @returns {object} report config
   */
  generateReport(reportType, options = {}) {
    this._assertRole("librarian");
    const validTypes = ["borrowed", "overdue", "frequent", "payments"];
    if (!validTypes.includes(reportType)) {
      throw new Error(`Invalid report type. Choose from: ${validTypes.join(", ")}`);
    }
    // TODO: pass this config to new Report(null, reportType).generate(db, options)
    return { reportType, requestedBy: this.userID, options };
  }

  // ── Internal ──────────────────────────────────────────────────────────────────

  _assertRole(expectedRole) {
    if (this.role !== expectedRole) {
      throw new Error(`Access denied. Required role: ${expectedRole}`);
    }
  }

  toPublic() {
    return { ...super.toPublic(), staffID: this.staffID, department: this.department };
  }
}

module.exports = Librarian;
