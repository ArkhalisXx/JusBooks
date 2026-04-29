const Fine = require("./Fine");

/**
 * Records a borrowing transaction.
 * recordBorrow() and recordReturn() are fully implemented.
 * Wire the db.* calls to your DB adapter.
 */
class BorrowTransaction {
  constructor(transactionID, memberID, bookID, issueDate, dueDate, returnDate = null, status = "active") {
    this.transactionID = transactionID;
    this.memberID      = memberID;
    this.bookID        = bookID;
    this.issueDate     = new Date(issueDate);
    this.dueDate       = new Date(dueDate);
    this.returnDate    = returnDate ? new Date(returnDate) : null;
    this.status        = status;
  }

  // ── Check-out ─────────────────────────────────────────────────────────────────

  /**
   * Persists a new borrow record and decrements book stock.
   * @param {object} db - your DB adapter exposing:
   *   db.insertTransaction(record)     → Promise<{ transactionID }>
   *   db.decrementBookStock(bookID)    → Promise<void>
   * @returns {Promise<BorrowTransaction>}
   */
  async recordBorrow(db) {
    const record = {
      memberID : this.memberID,
      bookID   : this.bookID,
      issueDate: this.issueDate,
      dueDate  : this.dueDate,
      status   : "active",
    };

    const { transactionID } = await db.insertTransaction(record);
    this.transactionID = transactionID;

    await db.decrementBookStock(this.bookID);

    console.log(`[Borrow] TX #${this.transactionID} — Member #${this.memberID} borrowed Book #${this.bookID}. Due: ${this.dueDate.toDateString()}`);
    return this;
  }

  // ── Check-in ──────────────────────────────────────────────────────────────────

  /**
   * Marks the book as returned, updates inventory, and generates a fine if overdue.
   * @param {object} db - your DB adapter exposing:
   *   db.updateTransaction(id, data)   → Promise<void>
   *   db.incrementBookStock(bookID)    → Promise<void>
   *   db.insertFine(fineData)          → Promise<{ fineID }>
   *   db.updateMemberFines(memberID, amount) → Promise<void>
   * @returns {Promise<Fine|null>}
   */
  async recordReturn(db) {
    if (this.status === "returned") {
      throw new Error(`Transaction #${this.transactionID} is already returned.`);
    }

    this.returnDate = new Date();
    this.status     = "returned";

    await db.updateTransaction(this.transactionID, {
      returnDate: this.returnDate,
      status    : "returned",
    });

    await db.incrementBookStock(this.bookID);

    const fine = Fine.fromTransaction(
      this.memberID,
      this.transactionID,
      this.dueDate,
      this.returnDate
    );

    if (fine) {
      const { fineID } = await db.insertFine(fine.toJSON());
      fine.fineID = fineID;
      await db.updateMemberFines(this.memberID, fine.amount);
      console.log(`[Return] TX #${this.transactionID} — Book #${this.bookID} returned LATE. Fine: ₱${fine.amount} (${fine.daysOverdue} days)`);
    } else {
      console.log(`[Return] TX #${this.transactionID} — Book #${this.bookID} returned on time.`);
    }

    return fine;
  }

  // ── Status ────────────────────────────────────────────────────────────────────

  /**
   * Checks current overdue status without returning.
   * @returns {{ isOverdue: boolean, daysOverdue: number, projectedFine: number }}
   */
  checkOverdueStatus() {
    const now        = new Date();
    const msPerDay   = 1000 * 60 * 60 * 24;
    const daysOverdue = Math.max(0, Math.floor((now - this.dueDate) / msPerDay));
    const isOverdue  = this.status === "active" && daysOverdue > 0;

    if (isOverdue) this.status = "overdue";

    return {
      isOverdue,
      daysOverdue,
      projectedFine: parseFloat((daysOverdue * Fine.RATE_PER_DAY).toFixed(2)),
    };
  }

  toJSON() {
    return {
      transactionID: this.transactionID,
      memberID     : this.memberID,
      bookID       : this.bookID,
      issueDate    : this.issueDate,
      dueDate      : this.dueDate,
      returnDate   : this.returnDate,
      status       : this.status,
    };
  }
}

module.exports = BorrowTransaction;
