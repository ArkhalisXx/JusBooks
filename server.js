/**
 * JusBooks — Express Server
 * Run: node server.js
 * Default port: 3000
 */

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');

const db           = require('./database/adapter');
const { User }     = require('./models/User');
const Member       = require('./models/Member');
const Librarian    = require('./models/Librarian');
const Book         = require('./models/Book');
const BorrowTransaction = require('./models/BorrowTransaction');
const Reservation  = require('./models/Reservation');
const Report       = require('./models/Report');
const Notification = require('./models/Notification');
const { authenticate, authorize } = require('./middleware/auth');

// Run DB setup on start
require('./database/setup');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Serve the frontend HTML file as root
app.use(express.static(path.join(__dirname, 'public')));

// ── Helper ────────────────────────────────────────────────────────────────────
function err(res, status, message) {
  return res.status(status).json({ error: message });
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return err(res, 400, 'Email and password required.');

    // Try member login first, then librarian
    const row = await db.findUserByEmail(email);
    if (!row) return err(res, 401, 'Invalid email or password.');

    let result;
    if (row.role === 'member') {
      result = await Member.login(email, password, db.findUserByEmail);
    } else if (row.role === 'librarian') {
      result = await Librarian.login(email, password, db.findUserByEmail);
    } else {
      return err(res, 401, 'Invalid email or password.');
    }

    res.json(result); // { token, user }
  } catch (e) {
    err(res, 401, e.message);
  }
});

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return err(res, 400, 'All fields required.');

    // Check duplicate email
    const existing = await db.findUserByEmail(email);
    if (existing) return err(res, 409, 'Email already registered.');

    const hashed = await User.hashPassword(password);
    const { userID } = await db.insertMember(username, email, hashed);

    res.status(201).json({ message: 'Registration successful. You can now log in.', userID });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// BOOKS ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/books?keyword=&category=&available=
app.get('/api/books', async (req, res) => {
  try {
    const { where, values } = Book.buildSearchQuery(req.query);
    const books = await db.getAllBooks(where, values);
    res.json(books);
  } catch (e) {
    err(res, 500, e.message);
  }
});

// GET /api/books/:id
app.get('/api/books/:id', async (req, res) => {
  try {
    const book = await db.getBookByID(req.params.id);
    if (!book) return err(res, 404, 'Book not found.');
    res.json(book);
  } catch (e) {
    err(res, 500, e.message);
  }
});

// POST /api/books — librarian only
app.post('/api/books', authenticate, authorize('librarian'), async (req, res) => {
  try {
    Book.validate(req.body);
    const { bookID } = await db.insertBook(req.body);
    const book = await db.getBookByID(bookID);
    res.status(201).json(book);
  } catch (e) {
    err(res, 400, e.message);
  }
});

// PUT /api/books/:id — librarian only
app.put('/api/books/:id', authenticate, authorize('librarian'), async (req, res) => {
  try {
    const book = await db.getBookByID(req.params.id);
    if (!book) return err(res, 404, 'Book not found.');
    Book.validate(req.body);
    await db.updateBook(req.params.id, req.body);
    const updated = await db.getBookByID(req.params.id);
    res.json(updated);
  } catch (e) {
    err(res, 400, e.message);
  }
});

// DELETE /api/books/:id — librarian only
app.delete('/api/books/:id', authenticate, authorize('librarian'), async (req, res) => {
  try {
    const book = await db.getBookByID(req.params.id);
    if (!book) return err(res, 404, 'Book not found.');
    await db.deleteBook(req.params.id);
    res.json({ message: 'Book deleted.' });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MEMBERS ROUTES (librarian management)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/members — librarian only
app.get('/api/members', authenticate, authorize('librarian'), async (req, res) => {
  try {
    const members = await db.getAllMembers();
    res.json(members);
  } catch (e) {
    err(res, 500, e.message);
  }
});

// PUT /api/members/:id/status — librarian only (suspend / activate)
app.put('/api/members/:id/status', authenticate, authorize('librarian'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active','suspended','pending'].includes(status))
      return err(res, 400, 'Invalid status.');
    await db.updateMemberStatus(req.params.id, status);
    res.json({ message: `Member status updated to ${status}.` });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// DELETE /api/members/:id — librarian only
app.delete('/api/members/:id', authenticate, authorize('librarian'), async (req, res) => {
  try {
    await db.deleteMember(req.params.id);
    res.json({ message: 'Member deleted.' });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// BORROW / RETURN ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/borrow — member only
app.post('/api/borrow', authenticate, authorize('member'), async (req, res) => {
  try {
    const { bookID } = req.body;
    if (!bookID) return err(res, 400, 'bookID required.');

    // Load member and book from DB
    const memberRow = await db.findUserByID(req.user.userID);
    if (!memberRow) return err(res, 404, 'Member not found.');

    const bookRow = await db.getBookByID(bookID);
    if (!bookRow) return err(res, 404, 'Book not found.');

    const member  = new Member(
      memberRow.userID, memberRow.username, memberRow.email, '',
      memberRow.membershipStatus, memberRow.borrowLimit, memberRow.outstandingFines
    );

    const borrowCount = await db.getBorrowCountByMember(req.user.userID);
    const record      = member.borrowBook(bookRow, borrowCount);

    // Persist via BorrowTransaction
    const tx = new BorrowTransaction(null, record.memberID, record.bookID, record.issueDate, record.dueDate);
    await tx.recordBorrow(db);

    // Send email notification (non-blocking)
    Notification.sendDueReminder(
      memberRow.email, memberRow.username, bookRow.title,
      tx.dueDate.toDateString()
    ).catch(() => {});

    res.status(201).json(tx.toJSON());
  } catch (e) {
    err(res, 400, e.message);
  }
});

// POST /api/return/:transactionID — member or librarian
app.post('/api/return/:transactionID', authenticate, async (req, res) => {
  try {
    const txRow = await db.getTransactionByID(req.params.transactionID);
    if (!txRow) return err(res, 404, 'Transaction not found.');

    // Members can only return their own books
    if (req.user.role === 'member' && txRow.memberID !== req.user.userID)
      return err(res, 403, 'You can only return your own books.');

    const tx   = new BorrowTransaction(
      txRow.transactionID, txRow.memberID, txRow.bookID,
      txRow.issueDate, txRow.dueDate, txRow.returnDate, txRow.status
    );
    const fine = await tx.recordReturn(db);

    // If overdue, send email
    if (fine) {
      const memberRow = await db.findUserByID(txRow.memberID);
      if (memberRow) {
        const bookRow = await db.getBookByID(txRow.bookID);
        Notification.sendOverdueNotice(
          memberRow.email, memberRow.username,
          bookRow?.title || 'your book', fine.daysOverdue, fine.amount
        ).catch(() => {});
      }
    }

    res.json({ message: fine ? `Returned late. Fine: ₱${fine.amount}` : 'Returned on time.', fine });
  } catch (e) {
    err(res, 400, e.message);
  }
});

// GET /api/transactions — librarian only
app.get('/api/transactions', authenticate, authorize('librarian'), async (req, res) => {
  try {
    const rows = await db.getAllTransactions();
    res.json(rows);
  } catch (e) {
    err(res, 500, e.message);
  }
});

// GET /api/my/borrows — member: own active borrows
app.get('/api/my/borrows', authenticate, authorize('member'), async (req, res) => {
  try {
    const rows = await db.getActiveTransactionsByMember(req.user.userID);
    res.json(rows);
  } catch (e) {
    err(res, 500, e.message);
  }
});

// GET /api/my/history — member: full history
app.get('/api/my/history', authenticate, authorize('member'), async (req, res) => {
  try {
    const rows = await db.getMemberHistory(req.user.userID);
    res.json(rows);
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// FINES ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/fines — librarian only
app.get('/api/fines', authenticate, authorize('librarian'), async (req, res) => {
  try {
    res.json(await db.getAllFines());
  } catch (e) {
    err(res, 500, e.message);
  }
});

// GET /api/my/fines — member: own fines
app.get('/api/my/fines', authenticate, authorize('member'), async (req, res) => {
  try {
    res.json(await db.getFinesByMember(req.user.userID));
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PAYMENT ROUTES (mock — simulates payment, saves to DB)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/pay — member only
app.post('/api/pay', authenticate, authorize('member'), async (req, res) => {
  try {
    const { amount, method, type } = req.body;
    if (!amount || !method || !type) return err(res, 400, 'amount, method, and type required.');
    if (amount <= 0) return err(res, 400, 'Amount must be greater than 0.');

    const memberRow = await db.findUserByID(req.user.userID);
    if (!memberRow) return err(res, 404, 'Member not found.');

    // Counter payments are pending until librarian confirms
    const isCounter = method === 'counter';
    const status    = isCounter ? 'pending' : 'confirmed';

    const refPrefix = { gcash: 'GC', paypal: 'PP', card: 'CD', counter: 'CT' }[method] || 'TX';
    const referenceID = `${refPrefix}-${Date.now().toString().slice(-6)}`;

    const { paymentID } = await db.insertPayment({
      memberID: req.user.userID, fineID: null,
      amount, method, type, status, referenceID,
    });

    // Only clear fines immediately for digital payments
    if (!isCounter) {
      if (type === 'fine') {
        await db.markFinesPaid(req.user.userID);
        await db.updateMemberFines(req.user.userID, -memberRow.outstandingFines);
      }
      if (type === 'membership') {
        await db.updateMemberStatus(req.user.userID, 'active');
      }
      Notification.sendPaymentConfirmation(
        memberRow.email, memberRow.username, amount, method, referenceID
      ).catch(() => {});
    }

    res.json({
      message: isCounter
        ? 'Counter payment submitted. Please visit the library desk for confirmation.'
        : 'Payment confirmed.',
      paymentID, referenceID, status,
    });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// POST /api/pay/confirm/:paymentID — librarian confirms counter payment
app.post('/api/pay/confirm/:paymentID', authenticate, authorize('librarian'), async (req, res) => {
  try {
    const { memberID } = req.body;
    if (!memberID) return err(res, 400, 'memberID required.');

    // Confirm the payment
    await db.confirmPayment(req.params.paymentID);

    // Clear fines
    const memberRow = await db.findUserByID(memberID);
    if (memberRow) {
      await db.markFinesPaid(memberID);
      await db.updateMemberFines(memberID, -memberRow.outstandingFines);

      const payment = await db.getPaymentByID(req.params.paymentID);

      Notification.sendPaymentConfirmation(
        memberRow.email, memberRow.username,
        payment?.amount || 0, 'Cash (Counter)', payment?.reference_id || ''
      ).catch(() => {});
    }

    res.json({ message: 'Counter payment confirmed.' });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// GET /api/payments — librarian only
app.get('/api/payments', authenticate, authorize('librarian'), async (req, res) => {
  try {
    res.json(await db.getAllPayments());
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// RESERVATIONS ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/reserve — member only
app.post('/api/reserve', authenticate, authorize('member'), async (req, res) => {
  try {
    const { bookID } = req.body;
    if (!bookID) return err(res, 400, 'bookID required.');

    const memberRow = await db.findUserByID(req.user.userID);
    if (!memberRow || memberRow.membershipStatus !== 'active')
      return err(res, 403, 'Only active members can reserve books.');

    const bookRow = await db.getBookByID(bookID);
    if (!bookRow) return err(res, 404, 'Book not found.');

    const res2 = new Reservation(
      null, req.user.userID, bookID,
      memberRow.email, memberRow.username, bookRow.title
    );
    await res2.reserve(db);

    res.status(201).json(res2.toJSON());
  } catch (e) {
    err(res, 400, e.message);
  }
});

// DELETE /api/reserve/:id — member cancels own reservation
app.delete('/api/reserve/:id', authenticate, authorize('member'), async (req, res) => {
  try {
    await db.updateReservationStatus(req.params.id, 'cancelled');
    res.json({ message: 'Reservation cancelled.' });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// GET /api/my/reserves — member: own reservations
app.get('/api/my/reserves', authenticate, authorize('member'), async (req, res) => {
  try {
    res.json(await db.getReservationsByMember(req.user.userID));
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/notifications — librarian only
app.get('/api/notifications', authenticate, authorize('librarian'), async (req, res) => {
  try {
    res.json(await db.getAllNotifications());
  } catch (e) {
    err(res, 500, e.message);
  }
});

// POST /api/notifications/send — librarian manually sends notification
app.post('/api/notifications/send', authenticate, authorize('librarian'), async (req, res) => {
  try {
    const { type, memberID } = req.body;
    if (!type || !memberID) return err(res, 400, 'type and memberID required.');

    const memberRow = await db.findUserByID(memberID);
    if (!memberRow) return err(res, 404, 'Member not found.');

    let sent = false;
    if (type === 'due_reminder') {
      const borrows = await db.getActiveTransactionsByMember(memberID);
      if (borrows.length) {
        sent = await Notification.sendDueReminder(
          memberRow.email, memberRow.username,
          borrows[0].bookTitle, new Date(borrows[0].dueDate).toDateString()
        );
      }
    } else if (type === 'overdue') {
      sent = await Notification.sendOverdueNotice(
        memberRow.email, memberRow.username,
        'your overdue book(s)', 0, memberRow.outstandingFines
      );
    } else if (type === 'membership_activated') {
      sent = await Notification.sendMembershipActivated(memberRow.email, memberRow.username);
    }

    await db.logNotification({ memberID, recipientEmail: memberRow.email, type });
    res.json({ message: sent ? 'Email sent.' : 'Email queued (check Gmail config if not received).' });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTS ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/reports/:type?format=csv — librarian only
app.get('/api/reports/:type', authenticate, authorize('librarian'), async (req, res) => {
  try {
    const { type } = req.params;
    const format    = req.query.format === 'json' ? 'json' : 'csv';

    const rawDB = {
      query: (sql, values) => require('./database/adapter').query(sql, values),
    };

    const report = new Report(null, type, req.user.userID);
    await report.generate(rawDB);

    const content  = report.export(format);
    const filename = report.getFilename(format);

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/json');
    res.send(content);
  } catch (e) {
    err(res, 400, e.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD ROUTE
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/dashboard — librarian only
app.get('/api/dashboard', authenticate, authorize('librarian'), async (req, res) => {
  try {
    const [stats, activity] = await Promise.all([
      db.getDashboardStats(),
      db.getRecentActivity(),
    ]);
    res.json({ stats, activity });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  JusBooks server running at http://localhost:${PORT}`);
  console.log(`   Frontend: http://localhost:${PORT}`);
  console.log(`   API:      http://localhost:${PORT}/api\n`);
});
