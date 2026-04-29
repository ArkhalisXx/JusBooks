const Notification = require("./Notification");

/**
 * Book reservation lifecycle — fully implemented.
 * Wire db.* calls to your DB adapter.
 */
class Reservation {
  static HOLD_DAYS = 3; // days before reservation expires

  constructor(reservationID, memberID, bookID, memberEmail = null, memberName = null,
              bookTitle = null, reservedAt = new Date(), expiryDate = null, status = "pending") {
    this.reservationID = reservationID;
    this.memberID      = memberID;
    this.bookID        = bookID;
    this.memberEmail   = memberEmail;
    this.memberName    = memberName;
    this.bookTitle     = bookTitle;
    this.reservedAt    = new Date(reservedAt);
    this.expiryDate    = expiryDate ? new Date(expiryDate) : this._calcExpiry(this.reservedAt);
    this.status        = status;
  }

  _calcExpiry(from) {
    const d = new Date(from);
    d.setDate(d.getDate() + Reservation.HOLD_DAYS);
    return d;
  }

  // ── Create ────────────────────────────────────────────────────────────────────

  /**
   * Saves reservation to DB.
   * @param {object} db - db.insertReservation(record) → Promise<{ reservationID }>
   * @returns {Promise<Reservation>}
   */
  async reserve(db) {
    const record = {
      memberID  : this.memberID,
      bookID    : this.bookID,
      reservedAt: this.reservedAt,
      expiryDate: this.expiryDate,
      status    : "pending",
    };

    const { reservationID } = await db.insertReservation(record);
    this.reservationID = reservationID;

    console.log(`[Reservation] #${this.reservationID} — Member #${this.memberID} reserved Book #${this.bookID}. Expires: ${this.expiryDate.toDateString()}`);
    return this;
  }

  // ── Cancel ────────────────────────────────────────────────────────────────────

  /**
   * Cancels this reservation.
   * @param {object} db - db.updateReservationStatus(id, status) → Promise<void>
   */
  async cancel(db) {
    if (this.status === "fulfilled" || this.status === "cancelled") {
      throw new Error(`Reservation #${this.reservationID} cannot be cancelled (status: ${this.status}).`);
    }
    this.status = "cancelled";
    await db.updateReservationStatus(this.reservationID, "cancelled");
    console.log(`[Reservation] #${this.reservationID} cancelled.`);
  }

  // ── Notify Availability ───────────────────────────────────────────────────────

  /**
   * Marks reservation as 'ready' and emails the member.
   * Called when a returned book matches a pending reservation.
   * @param {object} db
   */
  async notifyAvailability(db) {
    this.status = "ready";
    await db.updateReservationStatus(this.reservationID, "ready");

    if (this.memberEmail && this.memberName && this.bookTitle) {
      await Notification.sendReservationReady(
        this.memberEmail,
        this.memberName,
        this.bookTitle,
        this.expiryDate.toDateString()
      );
    } else {
      console.warn(`[Reservation] #${this.reservationID} — member/book details missing, skipping email.`);
    }
  }

  // ── Fulfil ────────────────────────────────────────────────────────────────────

  /**
   * Marks reservation as fulfilled when the member actually checks out.
   * @param {object} db
   */
  async fulfil(db) {
    if (this.status !== "ready") {
      throw new Error(`Reservation #${this.reservationID} must be 'ready' before fulfilling.`);
    }
    this.status = "fulfilled";
    await db.updateReservationStatus(this.reservationID, "fulfilled");
    console.log(`[Reservation] #${this.reservationID} fulfilled.`);
  }

  // ── Expiry Check ──────────────────────────────────────────────────────────────

  /**
   * Returns true if the reservation has expired without pickup.
   */
  isExpired() {
    return this.status === "ready" && new Date() > this.expiryDate;
  }

  toJSON() {
    return {
      reservationID: this.reservationID,
      memberID     : this.memberID,
      bookID       : this.bookID,
      reservedAt   : this.reservedAt,
      expiryDate   : this.expiryDate,
      status       : this.status,
    };
  }
}

module.exports = Reservation;
