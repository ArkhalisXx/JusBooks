const nodemailer = require("nodemailer");

/**
 * Email notification via Gmail API using nodemailer + OAuth2 (F10).
 * Setup: https://developers.google.com/gmail/api/auth/about-auth
 *
 * Required environment variables:
 *   GMAIL_USER          - your Gmail address (e.g. jusbooks@gmail.com)
 *   GMAIL_CLIENT_ID     - from Google Cloud Console OAuth2 credentials
 *   GMAIL_CLIENT_SECRET - from Google Cloud Console OAuth2 credentials
 *   GMAIL_REFRESH_TOKEN - obtained via OAuth2 playground or first-time auth
 */
class Notification {
  // ── Templates ─────────────────────────────────────────────────────────────────

  static TEMPLATES = {
    due_reminder: (data) => ({
      subject: `📚 JusBooks — Reminder: "${data.bookTitle}" is due ${data.dueDate}`,
      html   : `
        <h2>Book Due Reminder</h2>
        <p>Hi <strong>${data.memberName}</strong>,</p>
        <p>This is a reminder that your borrowed book <strong>"${data.bookTitle}"</strong>
        is due on <strong>${data.dueDate}</strong>.</p>
        <p>Please return it on time to avoid overdue fines.</p>
        <br><p>— JusBooks Library</p>
      `,
    }),

    overdue: (data) => ({
      subject: `⚠️ JusBooks — Overdue Notice: "${data.bookTitle}" (${data.daysOverdue} days)`,
      html   : `
        <h2>Overdue Notice</h2>
        <p>Hi <strong>${data.memberName}</strong>,</p>
        <p>Your book <strong>"${data.bookTitle}"</strong> is <strong>${data.daysOverdue} day(s) overdue</strong>.</p>
        <p>Current fine: <strong>₱${data.fineAmount}</strong></p>
        <p>Please return the book and settle your fine as soon as possible.
        Further borrowing is suspended until the fine is paid.</p>
        <br><p>— JusBooks Library</p>
      `,
    }),

    reservation_ready: (data) => ({
      subject: `✅ JusBooks — "${data.bookTitle}" is ready for pickup`,
      html   : `
        <h2>Reservation Ready</h2>
        <p>Hi <strong>${data.memberName}</strong>,</p>
        <p>Great news! The book you reserved, <strong>"${data.bookTitle}"</strong>,
        is now available for pickup.</p>
        <p>Your reservation will be held until <strong>${data.expiryDate}</strong>.</p>
        <br><p>— JusBooks Library</p>
      `,
    }),

    payment_confirmation: (data) => ({
      subject: `💳 JusBooks — Payment Confirmed (₱${data.amount})`,
      html   : `
        <h2>Payment Confirmed</h2>
        <p>Hi <strong>${data.memberName}</strong>,</p>
        <p>We have received your payment of <strong>₱${data.amount}</strong>
        via <strong>${data.method}</strong>.</p>
        <p>Reference ID: <code>${data.referenceID}</code></p>
        <p>Date: ${data.date}</p>
        <br><p>— JusBooks Library</p>
      `,
    }),

    membership_activated: (data) => ({
      subject: `🎉 JusBooks — Welcome! Your membership is now active`,
      html   : `
        <h2>Membership Activated</h2>
        <p>Hi <strong>${data.memberName}</strong>,</p>
        <p>Your JusBooks membership has been activated. You can now borrow books,
        make reservations, and access your account history.</p>
        <br><p>Welcome aboard!<br>— JusBooks Library</p>
      `,
    }),
  };

  // ── Constructor ───────────────────────────────────────────────────────────────

  constructor(notifID, type, recipientEmail, recipientName, data = {}) {
    this.notifID       = notifID;
    this.type          = type;
    this.recipientEmail = recipientEmail;
    this.recipientName  = recipientName;
    this.data          = data;
    this.status        = "pending";
    this.sentAt        = null;
    this.error         = null;
  }

  // ── Transport Factory ─────────────────────────────────────────────────────────

  /**
   * Creates a nodemailer transporter using Gmail OAuth2.
   * @returns {nodemailer.Transporter}
   */
  static _createTransporter() {
    return nodemailer.createTransport({
      service: "gmail",
      auth   : {
        type        : "OAuth2",
        user        : process.env.GMAIL_USER,
        clientId    : process.env.GMAIL_CLIENT_ID,
        clientSecret: process.env.GMAIL_CLIENT_SECRET,
        refreshToken: process.env.GMAIL_REFRESH_TOKEN,
      },
    });
  }

  // ── Send ──────────────────────────────────────────────────────────────────────

  /**
   * Sends the notification email.
   * @returns {Promise<boolean>}
   */
  async send() {
    const template = Notification.TEMPLATES[this.type];
    if (!template) throw new Error(`Unknown notification type: "${this.type}"`);

    const { subject, html } = template({ memberName: this.recipientName, ...this.data });

    const mailOptions = {
      from   : `"JusBooks Library" <${process.env.GMAIL_USER}>`,
      to     : this.recipientEmail,
      subject,
      html,
    };

    try {
      const transporter = Notification._createTransporter();
      const info        = await transporter.sendMail(mailOptions);

      this.status = "sent";
      this.sentAt = new Date();
      // TODO: db.logNotification(this.toJSON())
      console.log(`[Notification] ${this.type} sent to ${this.recipientEmail} — MessageID: ${info.messageId}`);
      return true;
    } catch (err) {
      this.status = "failed";
      this.error  = err.message;
      // TODO: db.logNotification(this.toJSON())
      console.error(`[Notification] Failed to send ${this.type} to ${this.recipientEmail}: ${err.message}`);
      return false;
    }
  }

  // ── Static Convenience Methods ────────────────────────────────────────────────

  static async sendDueReminder(recipientEmail, recipientName, bookTitle, dueDate) {
    const n = new Notification(null, "due_reminder", recipientEmail, recipientName, { bookTitle, dueDate });
    return n.send();
  }

  static async sendOverdueNotice(recipientEmail, recipientName, bookTitle, daysOverdue, fineAmount) {
    const n = new Notification(null, "overdue", recipientEmail, recipientName, { bookTitle, daysOverdue, fineAmount });
    return n.send();
  }

  static async sendReservationReady(recipientEmail, recipientName, bookTitle, expiryDate) {
    const n = new Notification(null, "reservation_ready", recipientEmail, recipientName, { bookTitle, expiryDate });
    return n.send();
  }

  static async sendPaymentConfirmation(recipientEmail, recipientName, amount, method, referenceID) {
    const n = new Notification(null, "payment_confirmation", recipientEmail, recipientName, {
      amount, method, referenceID, date: new Date().toLocaleString()
    });
    return n.send();
  }

  static async sendMembershipActivated(recipientEmail, recipientName) {
    const n = new Notification(null, "membership_activated", recipientEmail, recipientName, {});
    return n.send();
  }

  // ── Log ───────────────────────────────────────────────────────────────────────

  logStatus() {
    console.log(`[Notification] #${this.notifID} | Type: ${this.type} | To: ${this.recipientEmail} | Status: ${this.status}`);
  }

  toJSON() {
    return {
      notifID      : this.notifID,
      type         : this.type,
      recipientEmail: this.recipientEmail,
      status       : this.status,
      sentAt       : this.sentAt,
      error        : this.error,
    };
  }
}

module.exports = Notification;
