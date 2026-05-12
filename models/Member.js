const { User } = require("./User");

/**
 * Registered library member.
 * login() is fully implemented — wire db.findUserByEmail() to your DB adapter.
 */
class Member extends User {
  constructor(userID, username, email, password, membershipStatus = "pending", borrowLimit = 5, outstandingFines = 0.0) {
    super(userID, username, email, password, "member");
    this.membershipStatus = membershipStatus;
    this.borrowLimit      = borrowLimit;
    this.outstandingFines = outstandingFines;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────────

  /**
   * Logs in a member.
   * @param {string} email
   * @param {string} plainPassword
   * @param {Function} findUserByEmail  - async (email) => { userID, username, email, password, membershipStatus, borrowLimit, outstandingFines }
   * @returns {Promise<{ token: string, user: object }>}
   */
  static async login(email, plainPassword, findUserByEmail) {
    if (!email || !plainPassword) {
      throw new Error("Email and password are required.");
    }

    const row = await findUserByEmail(email);
    if (!row) throw new Error("Invalid email or password.");
    if (row.role !== "member") throw new Error("Invalid email or password.");

    const valid = await User.verifyPassword(plainPassword, row.password);
    if (!valid) throw new Error("Invalid email or password.");

    if (row.membershipStatus === "suspended") {
      throw new Error("Account suspended. Please settle outstanding fines to reactivate.");
    }
    if (row.membershipStatus === "pending") {
      throw new Error("Membership payment pending. Please complete payment to activate.");
    }

    const member = new Member(
      row.userID, row.username, row.email, row.password,
      row.membershipStatus, row.borrowLimit, row.outstandingFines
    );

    const token = member.generateToken();
    return { token, user: member.toPublic() };
  }

  logout() {
    // For stateless JWT: client discards token.
    // For stateful: add token to a blacklist table in DB.
    console.log(`Member ${this.username} logged out.`);
  }

  // ── Eligibility Check ─────────────────────────────────────────────────────────

  /**
   * Returns true if member can borrow more books.
   * @param {number} currentBorrowCount - fetched from DB
   * @returns {{ eligible: boolean, reason: string|null }}
   */
  checkEligibility(currentBorrowCount) {
    if (this.membershipStatus !== "active") {
      return { eligible: false, reason: `Membership is ${this.membershipStatus}.` };
    }
    if (this.outstandingFines > 0) {
      return { eligible: false, reason: `Outstanding fines of ₱${this.outstandingFines.toFixed(2)} must be paid first.` };
    }
    if (currentBorrowCount >= this.borrowLimit) {
      return { eligible: false, reason: `Borrow limit of ${this.borrowLimit} books reached.` };
    }
    return { eligible: true, reason: null };
  }

  // ── Borrowing ─────────────────────────────────────────────────────────────────

  /**
   * Borrows a book. Validates eligibility and book availability.
   * @param {object} book              - Book instance or plain object with { bookID, title, availableQty }
   * @param {number} currentBorrowCount
   * @param {number} [loanDays=14]     - loan period in days
   * @returns {{ transactionID: null, memberID, bookID, issueDate, dueDate, status }}
   */
  borrowBook(book, currentBorrowCount, loanDays = 14) {
    const { eligible, reason } = this.checkEligibility(currentBorrowCount);
    if (!eligible) throw new Error(reason);

    if (!book || book.availableQty <= 0) {
      throw new Error(`"${book?.title || "Book"}" is not available.`);
    }

    const issueDate = new Date();
    const dueDate   = new Date();
    dueDate.setDate(dueDate.getDate() + loanDays);

    const record = {
      transactionID: null,
      memberID     : this.userID,
      bookID       : book.bookID,
      issueDate,
      dueDate,
      returnDate   : null,
      status       : "active",
    };

    console.log(`Member ${this.username} borrowed "${book.title}". Due: ${dueDate.toDateString()}`);
    return record;
  }

  /**
   * Returns a borrowed book and calculates any overdue fine.
   * @param {object} transaction - { transactionID, dueDate, bookID }
   * @returns {{ fineAmount: number, daysOverdue: number }}
   */
  returnBook(transaction) {
    const returnDate  = new Date();
    const msPerDay    = 1000 * 60 * 60 * 24;
    const daysOverdue = Math.max(0, Math.floor((returnDate - new Date(transaction.dueDate)) / msPerDay));
    const FINE_RATE   = 5.0; // ₱5 per day
    const fineAmount  = daysOverdue * FINE_RATE;

    if (fineAmount > 0) {
      this.outstandingFines += fineAmount;
      console.log(`"${this.username}" returned book late by ${daysOverdue} day(s). Fine: ₱${fineAmount}`);
    } else {
      console.log(`Book returned on time by ${this.username}.`);
    }

    return { fineAmount, daysOverdue, returnDate };
  }

  /**
   * Pays outstanding fines. Returns a Payment record ready to be processed.
   * @param {number} amount
   * @param {string} method - 'gcash' | 'paymaya' | 'paypal' | 'card'
   */
  payFine(amount, method) {
    if (this.outstandingFines <= 0) throw new Error("No outstanding fines. Current balance: ₱0.00");
    if (amount <= 0 || amount > this.outstandingFines) {
      throw new Error(`Invalid amount. Outstanding: ₱${this.outstandingFines.toFixed(2)}`);
    }

    return {
      paymentID  : null,
      memberID   : this.userID,
      amount,
      method,
      timestamp  : new Date(),
      status     : "pending",
      referenceID: null,
      type       : "fine",
    };
  }

  /**
   * Creates a reservation record for a book.
   * @param {object} book - { bookID, title }
   */
  reserveBook(book) {
    if (this.membershipStatus !== "active") {
      throw new Error("Only active members can reserve books.");
    }

    const reservedAt  = new Date();
    const expiryDate  = new Date();
    expiryDate.setDate(expiryDate.getDate() + 3); // 3-day hold

    const record = {
      reservationID: null,
      memberID     : this.userID,
      bookID       : book.bookID,
      reservedAt,
      expiryDate,
      status       : "pending",
    };

    console.log(`Member ${this.username} reserved "${book.title}". Expires: ${expiryDate.toDateString()}`);
    return record;
  }

  /**
   * Fetches borrow history. Delegates to DB.
   * @param {Function} fetchHistory - async (memberID) => BorrowTransaction[]
   */
  async viewHistory(fetchHistory) {
    return fetchHistory(this.userID);
  }

  toPublic() {
    return {
      ...super.toPublic(),
      membershipStatus: this.membershipStatus,
      borrowLimit     : this.borrowLimit,
      outstandingFines: this.outstandingFines,
    };
  }
}

module.exports = Member;
