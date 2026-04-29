/**
 * Represents a book entry in the JusBooks catalog.
 * All methods are fully implemented — wire db calls where marked TODO.
 */
class Book {
  constructor(bookID, title, author, ISBN, category, quantity, availableQty, description = "") {
    this.bookID       = bookID;
    this.title        = title;
    this.author       = author;
    this.ISBN         = ISBN;
    this.category     = category;
    this.quantity     = quantity;
    this.availableQty = availableQty;
    this.description  = description;
  }

  // ── Availability ──────────────────────────────────────────────────────────────

  /** Returns true if at least one copy can be borrowed. */
  isAvailable() {
    return this.availableQty > 0;
  }

  // ── Stock Control ─────────────────────────────────────────────────────────────

  /**
   * Adjusts available stock. Use -1 on checkout, +1 on return.
   * @param {number} delta
   */
  updateStock(delta) {
    const next = this.availableQty + delta;

    if (next < 0) {
      throw new Error(
        `Stock underflow: "${this.title}" only has ${this.availableQty} copy/copies available.`
      );
    }
    if (next > this.quantity) {
      throw new Error(
        `Stock overflow: available (${next}) cannot exceed total quantity (${this.quantity}).`
      );
    }

    this.availableQty = next;
    // TODO: db.updateBookStock(this.bookID, this.availableQty)
    console.log(`[Book] "${this.title}" stock → ${this.availableQty}/${this.quantity}`);
    return this.availableQty;
  }

  // ── Details ───────────────────────────────────────────────────────────────────

  /** Returns a plain object safe for API responses. */
  getDetails() {
    return {
      bookID      : this.bookID,
      title       : this.title,
      author      : this.author,
      ISBN        : this.ISBN,
      category    : this.category,
      description : this.description,
      quantity    : this.quantity,
      availableQty: this.availableQty,
      available   : this.isAvailable(),
    };
  }

  // ── Validation ────────────────────────────────────────────────────────────────

  /**
   * Validates book data before insert/update.
   * @param {object} data
   * @throws if any required field is missing or invalid
   */
  static validate(data) {
    const required = ["title", "author", "ISBN", "category", "quantity"];
    for (const field of required) {
      if (!data[field]) throw new Error(`Book validation failed: missing "${field}".`);
    }
    if (isNaN(data.quantity) || data.quantity < 1) {
      throw new Error("Quantity must be a positive integer.");
    }
    const isbnClean = String(data.ISBN).replace(/[-\s]/g, "");
    if (![10, 13].includes(isbnClean.length)) {
      throw new Error(`Invalid ISBN length: ${isbnClean.length}. Must be 10 or 13 digits.`);
    }
  }

  // ── Search ────────────────────────────────────────────────────────────────────

  /**
   * Builds a SQL WHERE clause config from search params.
   * Pass the result to your DB adapter's search method.
   * @param {object} params - { keyword, category, available }
   * @returns {object} query config
   */
  static buildSearchQuery(params = {}) {
    const { keyword, category, available } = params;
    const conditions = [];
    const values     = [];

    if (keyword) {
      conditions.push("(title LIKE ? OR author LIKE ? OR isbn LIKE ?)");
      const k = `%${keyword}%`;
      values.push(k, k, k);
    }
    if (category) {
      conditions.push("category = ?");
      values.push(category);
    }
    if (available === true || available === "true") {
      conditions.push("available_qty > 0");
    }

    return {
      where : conditions.length ? conditions.join(" AND ") : "1=1",
      values,
    };
  }
}

module.exports = Book;
