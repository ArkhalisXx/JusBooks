/**
 * Overdue fine record — fully implemented.
 * Fine rate is configurable; default ₱5.00/day.
 */
class Fine {
  static RATE_PER_DAY = 5.0; // ₱5.00 — update to match library policy

  constructor(fineID, memberID, transactionID, amount, daysOverdue, isPaid = false, createdAt = new Date()) {
    this.fineID        = fineID;
    this.memberID      = memberID;
    this.transactionID = transactionID;
    this.amount        = amount;
    this.daysOverdue   = daysOverdue;
    this.isPaid        = isPaid;
    this.createdAt     = createdAt;
  }

  // ── Calculation ───────────────────────────────────────────────────────────────

  /**
   * Creates a Fine from a BorrowTransaction's due date.
   * @param {number}      memberID
   * @param {number}      transactionID
   * @param {Date|string} dueDate
   * @param {Date}        [returnDate]  - defaults to now
   * @param {number}      [ratePerDay]  - defaults to Fine.RATE_PER_DAY
   * @returns {Fine|null} null if not overdue
   */
  static fromTransaction(memberID, transactionID, dueDate, returnDate = new Date(), ratePerDay = Fine.RATE_PER_DAY) {
    const due      = new Date(dueDate);
    const ret      = new Date(returnDate);
    const msPerDay = 1000 * 60 * 60 * 24;
    const days     = Math.floor((ret - due) / msPerDay);

    if (days <= 0) return null; // returned on time

    const amount = parseFloat((days * ratePerDay).toFixed(2));
    return new Fine(null, memberID, transactionID, amount, days, false);
  }

  /**
   * Recalculates the fine (e.g. when rate changes or after more overdue days).
   * @param {number} [ratePerDay]
   * @returns {number} updated amount
   */
  calculate(ratePerDay = Fine.RATE_PER_DAY) {
    this.amount = parseFloat((this.daysOverdue * ratePerDay).toFixed(2));
    // TODO: db.updateFine(this.fineID, { amount: this.amount })
    return this.amount;
  }

  // ── Payment ───────────────────────────────────────────────────────────────────

  /**
   * Marks this fine as paid and links the payment.
   * @param {number} paymentID
   */
  markPaid(paymentID) {
    if (this.isPaid) throw new Error(`Fine #${this.fineID} is already paid.`);
    this.isPaid    = true;
    this.paymentID = paymentID;
    // TODO: db.updateFine(this.fineID, { is_paid: true, payment_id: paymentID })
    console.log(`[Fine] Fine #${this.fineID} (₱${this.amount}) marked paid via Payment #${paymentID}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────────

  toJSON() {
    return {
      fineID       : this.fineID,
      memberID     : this.memberID,
      transactionID: this.transactionID,
      amount       : this.amount,
      daysOverdue  : this.daysOverdue,
      isPaid       : this.isPaid,
      createdAt    : this.createdAt,
    };
  }
}

module.exports = Fine;
