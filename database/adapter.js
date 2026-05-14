/**
 * JusBooks DB Adapter
 * Wraps raw sqlite3 callback API into Promises.
 * All server routes use this — never call db directly from routes.
 */

const db = require('./db');

// ── Generic helpers ──────────────────────────────────────────────────────────

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Generic query used by Report.generate()
function query(sql, params = []) {
  return all(sql, params);
}

// ── Users ────────────────────────────────────────────────────────────────────

async function findUserByEmail(email) {
  const row = await get(
    `SELECT user_id AS userID, username, email, password, role,
            membership_status AS membershipStatus,
            borrow_limit AS borrowLimit,
            outstanding_fines AS outstandingFines,
            staff_id AS staffID, department
     FROM users WHERE email = ?`,
    [email]
  );
  return row;
}

async function findUserByID(userID) {
  return get(
    `SELECT user_id AS userID, username, email, role,
            membership_status AS membershipStatus,
            borrow_limit AS borrowLimit,
            outstanding_fines AS outstandingFines
     FROM users WHERE user_id = ?`,
    [userID]
  );
}

async function insertMember(username, email, hashedPassword) {
  const { lastID } = await run(
    `INSERT INTO users (username, email, password, role, membership_status, borrow_limit, outstanding_fines)
     VALUES (?, ?, ?, 'member', 'pending', 5, 0)`,
    [username, email, hashedPassword]
  );
  return { userID: lastID };
}

async function updateMemberStatus(memberID, status) {
  return run(`UPDATE users SET membership_status = ? WHERE user_id = ?`, [status, memberID]);
}

async function updateMemberFines(memberID, delta) {
  return run(
    `UPDATE users SET outstanding_fines = MAX(0, outstanding_fines + ?) WHERE user_id = ?`,
    [delta, memberID]
  );
}

async function getAllMembers() {
  return all(
    `SELECT user_id AS userID, username, email, role,
            membership_status AS membershipStatus,
            borrow_limit AS borrowLimit,
            outstanding_fines AS outstandingFines
     FROM users WHERE role = 'member' ORDER BY username`
  );
}

async function deleteMember(memberID) {
  await run(`DELETE FROM return_requests WHERE member_id = ?`, [memberID]);
  await run(`DELETE FROM borrow_requests WHERE member_id = ?`, [memberID]);
  await run(`DELETE FROM reservations WHERE member_id = ?`, [memberID]);
  await run(`DELETE FROM fines WHERE member_id = ?`, [memberID]);
  await run(`DELETE FROM payments WHERE member_id = ?`, [memberID]);
  await run(`DELETE FROM notifications WHERE member_id = ?`, [memberID]);
  await run(`DELETE FROM borrow_transactions WHERE member_id = ?`, [memberID]);
  return run(`DELETE FROM users WHERE user_id = ? AND role = 'member'`, [memberID]);
}

async function updateMember(memberID, fields) {
  const allowed = ['username', 'email'];
  const sets = [];
  const vals = [];
  for (const f of allowed) {
    if (fields[f] !== undefined) { sets.push(`${f} = ?`); vals.push(fields[f]); }
  }
  if (!sets.length) return;
  vals.push(memberID);
  return run(`UPDATE users SET ${sets.join(', ')} WHERE user_id = ?`, vals);
}

// ── Books ────────────────────────────────────────────────────────────────────

async function getAllBooks(where = '1=1', values = []) {
  return all(
    `SELECT book_id AS bookID, title, author, isbn AS ISBN,
            category, quantity, available_qty AS availableQty, description
     FROM books WHERE ${where} ORDER BY title`,
    values
  );
}

async function getBookByID(bookID) {
  return get(
    `SELECT book_id AS bookID, title, author, isbn AS ISBN,
            category, quantity, available_qty AS availableQty, description
     FROM books WHERE book_id = ?`,
    [bookID]
  );
}

async function insertBook(data) {
  const { lastID } = await run(
    `INSERT INTO books (title, author, isbn, category, quantity, available_qty, description)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [data.title, data.author, data.ISBN, data.category, data.quantity, data.quantity, data.description || '']
  );
  return { bookID: lastID };
}

async function updateBook(bookID, data) {
  return run(
    `UPDATE books SET title=?, author=?, isbn=?, category=?, quantity=?, available_qty=?, description=? WHERE book_id=?`,
    [data.title, data.author, data.ISBN, data.category, data.quantity, data.availableQty ?? data.quantity, data.description || '', bookID]
  );
}

async function deleteBook(bookID) {
  return run(`DELETE FROM books WHERE book_id = ?`, [bookID]);
}

async function decrementBookStock(bookID) {
  return run(`UPDATE books SET available_qty = available_qty - 1 WHERE book_id = ? AND available_qty > 0`, [bookID]);
}

async function incrementBookStock(bookID) {
  return run(`UPDATE books SET available_qty = MIN(quantity, available_qty + 1) WHERE book_id = ?`, [bookID]);
}

// ── Borrow Transactions ───────────────────────────────────────────────────────

async function insertTransaction(record) {
  const { lastID } = await run(
    `INSERT INTO borrow_transactions (member_id, book_id, issue_date, due_date, status)
     VALUES (?, ?, ?, ?, 'active')`,
    [record.memberID, record.bookID,
     record.issueDate instanceof Date ? record.issueDate.toISOString() : record.issueDate,
     record.dueDate   instanceof Date ? record.dueDate.toISOString()   : record.dueDate]
  );
  return { transactionID: lastID };
}

async function updateTransaction(transactionID, data) {
  return run(
    `UPDATE borrow_transactions SET return_date=?, status=? WHERE transaction_id=?`,
    [data.returnDate instanceof Date ? data.returnDate.toISOString() : data.returnDate,
     data.status, transactionID]
  );
}

async function getTransactionByID(transactionID) {
  return get(
    `SELECT transaction_id AS transactionID, member_id AS memberID, book_id AS bookID,
            issue_date AS issueDate, due_date AS dueDate, return_date AS returnDate, status
     FROM borrow_transactions WHERE transaction_id = ?`,
    [transactionID]
  );
}

async function getActiveTransactionsByMember(memberID) {
  return all(
    `SELECT bt.transaction_id AS transactionID, bt.member_id AS memberID,
            bt.book_id AS bookID, b.title AS bookTitle,
            bt.issue_date AS issueDate, bt.due_date AS dueDate,
            bt.return_date AS returnDate, bt.status
     FROM borrow_transactions bt
     JOIN books b ON b.book_id = bt.book_id
     WHERE bt.member_id = ? AND bt.status IN ('active','overdue')
     ORDER BY bt.due_date`,
    [memberID]
  );
}

async function getBorrowCountByMember(memberID) {
  const row = await get(
    `SELECT COUNT(*) AS cnt FROM borrow_transactions
     WHERE member_id = ? AND status IN ('active','overdue')`,
    [memberID]
  );
  return row ? row.cnt : 0;
}

async function getAllTransactions() {
  return all(
    `SELECT bt.transaction_id AS transactionID,
            bt.member_id AS memberID, u.username AS memberName,
            bt.book_id AS bookID, b.title AS bookTitle,
            bt.issue_date AS issueDate, bt.due_date AS dueDate,
            bt.return_date AS returnDate, bt.status
     FROM borrow_transactions bt
     JOIN users b2 ON b2.user_id = bt.member_id
     JOIN books b  ON b.book_id  = bt.book_id
     JOIN users u  ON u.user_id  = bt.member_id
     ORDER BY bt.issue_date DESC LIMIT 200`
  );
}

async function getMemberHistory(memberID) {
  return all(
    `SELECT bt.transaction_id AS transactionID,
            bt.book_id AS bookID, b.title AS bookTitle,
            bt.issue_date AS issueDate, bt.due_date AS dueDate,
            bt.return_date AS returnDate, bt.status
     FROM borrow_transactions bt
     JOIN books b ON b.book_id = bt.book_id
     WHERE bt.member_id = ?
     ORDER BY bt.issue_date DESC`,
    [memberID]
  );
}

// ── Fines ────────────────────────────────────────────────────────────────────

async function insertFine(data) {
  const { lastID } = await run(
    `INSERT INTO fines (member_id, transaction_id, amount, days_overdue, is_paid, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [data.memberID, data.transactionID, data.amount, data.daysOverdue,
     data.isPaid ? 1 : 0, new Date().toISOString()]
  );
  return { fineID: lastID };
}

async function getFinesByMember(memberID) {
  return all(
    `SELECT f.fine_id AS fineID, f.member_id AS memberID,
            f.transaction_id AS transactionID, f.amount, f.days_overdue AS daysOverdue,
            f.is_paid AS isPaid, b.title AS bookTitle
     FROM fines f
     JOIN borrow_transactions bt ON bt.transaction_id = f.transaction_id
     JOIN books b ON b.book_id = bt.book_id
     WHERE f.member_id = ? ORDER BY f.created_at DESC`,
    [memberID]
  );
}

async function getAllFines() {
  return all(
    `SELECT f.fine_id AS fineID, f.member_id AS memberID, u.username AS memberName,
            f.transaction_id AS transactionID, f.amount,
            f.days_overdue AS daysOverdue, f.is_paid AS isPaid,
            b.title AS bookTitle
     FROM fines f
     JOIN users u ON u.user_id = f.member_id
     JOIN borrow_transactions bt ON bt.transaction_id = f.transaction_id
     JOIN books b ON b.book_id = bt.book_id
     ORDER BY f.created_at DESC`
  );
}

async function markFinesPaid(memberID) {
  return run(`UPDATE fines SET is_paid = 1 WHERE member_id = ? AND is_paid = 0`, [memberID]);
}

// ── Payments ──────────────────────────────────────────────────────────────────

async function insertPayment(data) {
  const { lastID } = await run(
    `INSERT INTO payments (member_id, fine_id, amount, method, type, status, reference_id, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.memberID, data.fineID || null, data.amount, data.method,
     data.type, data.status, data.referenceID,
     new Date().toISOString()]
  );
  return { paymentID: lastID };
}

async function getAllPayments() {
  return all(
    `SELECT p.payment_id AS paymentID, p.member_id AS memberID,
            u.username AS memberName, p.amount, p.method, p.type,
            p.status, p.reference_id AS referenceID, p.timestamp
     FROM payments p
     JOIN users u ON u.user_id = p.member_id
     ORDER BY p.timestamp DESC LIMIT 200`
  );
}

// ── Reservations ──────────────────────────────────────────────────────────────

async function insertReservation(record) {
  const { lastID } = await run(
    `INSERT INTO reservations (member_id, book_id, reserved_at, expiry_date, status)
     VALUES (?, ?, ?, ?, 'pending')`,
    [record.memberID, record.bookID,
     record.reservedAt instanceof Date ? record.reservedAt.toISOString() : record.reservedAt,
     record.expiryDate instanceof Date ? record.expiryDate.toISOString() : record.expiryDate]
  );
  return { reservationID: lastID };
}

async function updateReservationStatus(reservationID, status, expiryDate = null) {
  if (status === 'ready' && expiryDate) {
    return run(
      `UPDATE reservations SET status = ?, expiry_date = ? WHERE reservation_id = ?`,
      [status, expiryDate, reservationID]
    );
  }
  return run(`UPDATE reservations SET status = ? WHERE reservation_id = ?`, [status, reservationID]);
}

async function getReservationsByMember(memberID) {
  return all(
    `SELECT r.reservation_id AS reservationID, r.member_id AS memberID,
            r.book_id AS bookID, b.title AS bookTitle,
            r.reserved_at AS reservedAt, r.expiry_date AS expiryDate, r.status
     FROM reservations r
     JOIN books b ON b.book_id = r.book_id
     WHERE r.member_id = ? AND r.status NOT IN ('cancelled','fulfilled')
     ORDER BY r.reserved_at DESC`,
    [memberID]
  );
}

async function getAllReservations() {
  return all(
    `SELECT r.reservation_id AS reservationID,
            r.member_id AS memberID, u.username AS memberName,
            r.book_id AS bookID, b.title AS bookTitle,
            r.reserved_at AS reservedAt, r.expiry_date AS expiryDate, r.status
     FROM reservations r
     JOIN users u ON u.user_id = r.member_id
     JOIN books b ON b.book_id = r.book_id
     ORDER BY r.reserved_at DESC LIMIT 200`
  );
}

// ── Notifications log ─────────────────────────────────────────────────────────

async function logNotification(data) {
  return run(
    `INSERT INTO notifications (member_id, message, type, created_at)
     VALUES (?, ?, ?, ?)`,
    [data.memberID || null, data.recipientEmail, data.type, new Date().toISOString()]
  );
}

async function getAllNotifications() {
  return all(
    `SELECT notification_id AS notifID, member_id AS memberID,
            message AS recipient, type, created_at AS sentAt
     FROM notifications ORDER BY created_at DESC LIMIT 200`
  );
}

// ── Dashboard stats ───────────────────────────────────────────────────────────

async function getDashboardStats() {
  const [books, members, active, overdue, fines] = await Promise.all([
    get(`SELECT COUNT(*) AS cnt FROM books`),
    get(`SELECT COUNT(*) AS cnt FROM users WHERE role='member' AND membership_status='active'`),
    get(`SELECT COUNT(*) AS cnt FROM borrow_transactions WHERE status IN ('active','overdue')`),
    get(`SELECT COUNT(*) AS cnt FROM borrow_transactions WHERE status='overdue'
          OR (status='active' AND due_date < datetime('now'))`),
    get(`SELECT COALESCE(SUM(amount),0) AS total FROM fines WHERE is_paid=0`),
  ]);
  return {
    totalBooks   : books.cnt,
    activeMembers: members.cnt,
    activeBorrows: active.cnt,
    overdueBooks : overdue.cnt,
    unpaidFines  : fines.total,
  };
}

async function getRecentActivity() {
  return all(
    `SELECT 'borrow' AS type,
            u.username AS actor, b.title AS target,
            bt.issue_date AS ts
     FROM borrow_transactions bt
     JOIN users u ON u.user_id = bt.member_id
     JOIN books b ON b.book_id = bt.book_id
     UNION ALL
     SELECT 'return', u.username, b.title, bt.return_date
     FROM borrow_transactions bt
     JOIN users u ON u.user_id = bt.member_id
     JOIN books b ON b.book_id = bt.book_id
     WHERE bt.return_date IS NOT NULL
     ORDER BY ts DESC LIMIT 10`
  );
}

// ── BORROW REQUESTS ───────────────────────────────────────────────────────────

async function insertBorrowRequest({ memberID, bookID, loanDays }) {
  const { lastID } = await run(
    `INSERT INTO borrow_requests (member_id, book_id, loan_days) VALUES (?, ?, ?)`,
    [memberID, bookID, loanDays || 14]
  );
  return { requestID: lastID };
}

async function getBorrowRequests() {
  return all(
    `SELECT br.request_id AS requestID, br.member_id AS memberID,
            br.book_id AS bookID, br.loan_days AS loanDays,
            br.requested_at AS requestedAt, br.status,
            u.username, u.email,
            b.title AS bookTitle, b.available_qty AS availableQty
     FROM borrow_requests br
     JOIN users u ON u.user_id = br.member_id
     JOIN books b ON b.book_id = br.book_id
     ORDER BY br.requested_at ASC`
  );
}

async function getBorrowRequestByID(requestID) {
  return get(
    `SELECT br.*, u.email, u.username, b.title AS bookTitle, b.available_qty AS availableQty
     FROM borrow_requests br
     JOIN users u ON u.user_id = br.member_id
     JOIN books b ON b.book_id = br.book_id
     WHERE br.request_id = ?`, [requestID]
  );
}

async function updateBorrowRequest(requestID, status) {
  return run(`UPDATE borrow_requests SET status = ? WHERE request_id = ?`, [status, requestID]);
}

async function countActiveReservationsForBook(bookID) {
  const row = await get(
    `SELECT COUNT(*) AS total FROM reservations
     WHERE book_id = ? AND status IN ('pending', 'ready')`,
    [bookID]
  );
  return row ? row.total : 0;
}

async function getNextReservationForBook(bookID) {
  return get(
    `SELECT r.reservation_id AS reservationID, r.member_id AS memberID,
            r.book_id AS bookID, r.reserved_at AS reservedAt,
            r.expiry_date AS expiryDate, r.status,
            u.email AS memberEmail, u.username AS memberName,
            b.title AS bookTitle
     FROM reservations r
     JOIN users u ON u.user_id = r.member_id
     JOIN books b ON b.book_id = r.book_id
     WHERE r.book_id = ? AND r.status IN ('pending', 'ready')
     ORDER BY r.reserved_at ASC
     LIMIT 1`,
    [bookID]
  );
}

// ── RETURN REQUESTS ───────────────────────────────────────────────────────────

async function insertReturnRequest({ transactionID, memberID, fineAmount, daysOverdue }) {
  const result = await run(
    `INSERT INTO return_requests (transaction_id, member_id, fine_amount, days_overdue, status)
     VALUES (?, ?, ?, ?, 'pending')`,
    [transactionID, memberID, fineAmount || 0, daysOverdue || 0]
  );
  return { requestID: result.lastID };
}

async function getReturnRequests() {
  return all(
    `SELECT rr.request_id AS requestID, rr.transaction_id AS transactionID,
            rr.member_id AS memberID, rr.requested_at AS requestedAt,
            rr.status, rr.fine_amount AS fineAmount, rr.days_overdue AS daysOverdue,
            rr.fine_paid AS finePaid, rr.payment_method AS paymentMethod,
            u.username, u.email,
            b.title AS bookTitle
     FROM return_requests rr
     JOIN users u ON u.user_id = rr.member_id
     JOIN borrow_transactions bt ON bt.transaction_id = rr.transaction_id
     JOIN books b ON b.book_id = bt.book_id
     ORDER BY rr.requested_at DESC`
  );
}

async function getReturnRequestByID(requestID) {
  return get(
    `SELECT rr.*, bt.book_id AS bookID, bt.due_date AS dueDate,
            u.email, u.username, b.title AS bookTitle
     FROM return_requests rr
     JOIN borrow_transactions bt ON bt.transaction_id = rr.transaction_id
     JOIN users u ON u.user_id = rr.member_id
     JOIN books b ON b.book_id = bt.book_id
     WHERE rr.request_id = ?`, [requestID]
  );
}

async function updateReturnRequest(requestID, data) {
  const fields = Object.keys(data).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(data), requestID];
  return run(`UPDATE return_requests SET ${fields} WHERE request_id = ?`, values);
}

module.exports = {
  query,
  findUserByEmail, findUserByID,
  insertMember, updateMemberStatus, updateMemberFines, getAllMembers, deleteMember, updateMember,
  getAllBooks, getBookByID, insertBook, updateBook, deleteBook, decrementBookStock, incrementBookStock,
  insertTransaction, updateTransaction, getTransactionByID,
  getActiveTransactionsByMember, getBorrowCountByMember, getAllTransactions, getMemberHistory,
  insertFine, getFinesByMember, getAllFines, markFinesPaid,
  insertPayment, getAllPayments,
  insertReservation, updateReservationStatus, getReservationsByMember, getAllReservations,
  logNotification, getAllNotifications,
  getDashboardStats, getRecentActivity,
  insertReturnRequest, getReturnRequests, getReturnRequestByID, updateReturnRequest,
  insertBorrowRequest, getBorrowRequests, getBorrowRequestByID, updateBorrowRequest, getNextReservationForBook, countActiveReservationsForBook,
};
