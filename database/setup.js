const db = require('./db');

// ── USERS TABLE ───────────────────────────────────────────────────────────────
// Added: is_active, is_suspended for Auth & RBAC module
const usersTable = `
CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL,
    membership_status TEXT DEFAULT 'active',
    borrow_limit INTEGER DEFAULT 5,
    outstanding_fines REAL DEFAULT 0,
    staff_id TEXT,
    department TEXT
);
`;

// ── BOOKS TABLE ───────────────────────────────────────────────────────────────
const booksTable = `
CREATE TABLE IF NOT EXISTS books (
    book_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT    NOT NULL,
    author        TEXT    NOT NULL,
    isbn          TEXT    UNIQUE NOT NULL,
    category      TEXT    NOT NULL,
    quantity      INTEGER NOT NULL,
    available_qty INTEGER NOT NULL,
    description   TEXT
);
`;

// ── BORROW TRANSACTIONS TABLE ─────────────────────────────────────────────────
const borrowTable = `
CREATE TABLE IF NOT EXISTS borrow_transactions (
    transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id      INTEGER NOT NULL,
    book_id        INTEGER NOT NULL,
    issue_date     TEXT    NOT NULL,
    due_date       TEXT    NOT NULL,
    return_date    TEXT,
    status         TEXT    DEFAULT 'active',
    FOREIGN KEY(member_id) REFERENCES users(user_id),
    FOREIGN KEY(book_id)   REFERENCES books(book_id)
);
`;

// ── FINES TABLE ───────────────────────────────────────────────────────────────
const finesTable = `
CREATE TABLE IF NOT EXISTS fines (
    fine_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id      INTEGER NOT NULL,
    transaction_id INTEGER NOT NULL,
    amount         REAL    NOT NULL,
    days_overdue   INTEGER NOT NULL,
    is_paid        INTEGER DEFAULT 0,
    created_at     TEXT,
    FOREIGN KEY(member_id)      REFERENCES users(user_id),
    FOREIGN KEY(transaction_id) REFERENCES borrow_transactions(transaction_id)
);
`;

// ── PAYMENTS TABLE ────────────────────────────────────────────────────────────
const paymentsTable = `
CREATE TABLE IF NOT EXISTS payments (
    payment_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id    INTEGER NOT NULL,
    fine_id      INTEGER,
    amount       REAL    NOT NULL,
    method       TEXT,
    type         TEXT,
    status       TEXT,
    reference_id TEXT,
    timestamp    TEXT,
    FOREIGN KEY(member_id) REFERENCES users(user_id),
    FOREIGN KEY(fine_id)   REFERENCES fines(fine_id)
);
`;

// ── RESERVATIONS TABLE ────────────────────────────────────────────────────────
const reservationsTable = `
CREATE TABLE IF NOT EXISTS reservations (
    reservation_id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id      INTEGER NOT NULL,
    book_id        INTEGER NOT NULL,
    reserved_at    TEXT,
    expiry_date    TEXT,
    status         TEXT DEFAULT 'pending',
    FOREIGN KEY(member_id) REFERENCES users(user_id),
    FOREIGN KEY(book_id)   REFERENCES books(book_id)
);
`;

// ── NOTIFICATIONS TABLE ───────────────────────────────────────────────────────
const notificationsTable = `
CREATE TABLE IF NOT EXISTS notifications (
    notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id       INTEGER,
    message         TEXT,
    type            TEXT,
    created_at      TEXT
);
`;

// ── BORROW REQUESTS TABLE ─────────────────────────────────────────────────────
const borrowRequestsTable = `
CREATE TABLE IF NOT EXISTS borrow_requests (
    request_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id      INTEGER NOT NULL,
    book_id        INTEGER NOT NULL,
    loan_days      INTEGER DEFAULT 14,
    requested_at   TEXT    DEFAULT (datetime('now')),
    status         TEXT    DEFAULT 'pending',
    FOREIGN KEY(member_id) REFERENCES users(user_id),
    FOREIGN KEY(book_id)   REFERENCES books(book_id)
);
`;

// ── RETURN REQUESTS TABLE ─────────────────────────────────────────────────────
const returnRequestsTable = `
CREATE TABLE IF NOT EXISTS return_requests (
    request_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL,
    member_id      INTEGER NOT NULL,
    requested_at   TEXT    DEFAULT (datetime('now')),
    status         TEXT    DEFAULT 'pending',
    fine_amount    REAL    DEFAULT 0,
    days_overdue   INTEGER DEFAULT 0,
    fine_paid      INTEGER DEFAULT 0,
    payment_method TEXT,
    FOREIGN KEY(transaction_id) REFERENCES borrow_transactions(transaction_id),
    FOREIGN KEY(member_id)      REFERENCES users(user_id)
);
`;

// ── REFRESH TOKENS TABLE ──────────────────────────────────────────────────────
// Auth & RBAC Module — stores hashed refresh tokens for secure session rotation
const refreshTokensTable = `
CREATE TABLE IF NOT EXISTS refresh_tokens (
    token_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    token_hash TEXT    NOT NULL UNIQUE,
    expires_at TEXT    NOT NULL,
    revoked    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
`;

// ── AUDIT LOGS TABLE ──────────────────────────────────────────────────────────
// Auth & RBAC Module — records all auth events and admin actions
const auditLogsTable = `
CREATE TABLE IF NOT EXISTS audit_logs (
    log_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    action     TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    meta       TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
`;

// ── Run all table creations in order ─────────────────────────────────────────
const queries = [
  usersTable,
  booksTable,
  borrowTable,
  finesTable,
  paymentsTable,
  reservationsTable,
  notificationsTable,
  borrowRequestsTable,
  returnRequestsTable,
  refreshTokensTable,
  auditLogsTable,
];

queries.forEach((query) => {
  db.run(query, (err) => {
    if (err) console.error('Table creation error:', err.message);
  });
});

console.log('Database tables created successfully.');
