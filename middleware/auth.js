/**
 * middleware/auth.js
 * Auth & RBAC Module — JusBooks
 *
 * Exports:
 *   authenticate    — verify JWT; blocks suspended/deactivated accounts live
 *   optionalAuth    — like authenticate but never blocks (for public routes)
 *   authorize       — restrict route to specific role(s)
 *   ownDataOnly     — member can only access their own data; librarian bypasses
 *   auditLog        — write an event to audit_logs table
 *
 * ── How other modules use this ────────────────────────────────────────────────
 *
 *   const { authenticate, authorize, ownDataOnly, optionalAuth, auditLog }
 *     = require('../middleware/auth');
 *
 *   // Anyone logged in
 *   router.get('/profile', authenticate, handler);
 *
 *   // Librarian only
 *   router.post('/books', authenticate, authorize('librarian'), handler);
 *
 *   // Member only
 *   router.post('/borrow', authenticate, authorize('member'), handler);
 *
 *   // Either role
 *   router.get('/history', authenticate, authorize('member','librarian'), handler);
 *
 *   // Member can only see their own data; librarian sees all
 *   router.get('/members/:userID', authenticate, ownDataOnly('userID'), handler);
 *
 *   // Public route — guests can read, logged-in users get req.user populated
 *   router.get('/books', optionalAuth, handler);
 *
 *   // Log a custom event from another module
 *   auditLog({ userID: req.user.userID, action: 'BOOK_BORROWED', ip: req.ip,
 *               meta: { bookID: 5 } });
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { User } = require('../models/User');
const db        = require('../database/db');

// ── authenticate ──────────────────────────────────────────────────────────────
/**
 * Verifies the Bearer JWT from the Authorization header.
 * After decoding, does a LIVE database check to catch accounts that were
 * suspended or deactivated after the token was issued.
 *
 * On success:  attaches decoded payload to req.user and calls next().
 * On failure:  responds with 401 or 403 immediately.
 *
 * req.user shape: { userID, username, email, role, iat, exp }
 */
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided. Please log in.' });
  }

  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = User.verifyToken(token);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    return res.status(401).json({ error: 'Invalid token.' });
  }

  // Live DB check — catches suspensions/deactivations that happened after login
  db.get(
    `SELECT user_id FROM users WHERE user_id = ?`,
    [decoded.userID],
    (err, row) => {
      if (err || !row) {
        return res.status(401).json({ error: 'User account not found.' });
      }
      req.user = decoded;
      next();
    }
  );
}

// ── optionalAuth ──────────────────────────────────────────────────────────────
/**
 * Like authenticate but NEVER blocks the request.
 * Use on public routes where guests (non-members) are allowed to read,
 * but logged-in users should have req.user populated.
 *
 * Example: GET /books — guests can browse, members see personalised data.
 *
 * req.user will be:
 *   - decoded JWT payload  → if a valid token was provided
 *   - null                 → if no token or invalid token (guest)
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = User.verifyToken(token);
  } catch {
    req.user = null;
    return next();
  }

  // Still do a live check — don't let deleted users get member-level data
  db.get(
    `SELECT user_id FROM users WHERE user_id = ?`,
    [decoded.userID],
    (err, row) => {
      if (err || !row) {
        req.user = null;
      } else {
        req.user = decoded;
      }
      next();
    }
  );
}

// ── authorize ─────────────────────────────────────────────────────────────────
/**
 * Restricts a route to one or more specific roles.
 * Must be used AFTER authenticate().
 *
 * @param {...string} roles - e.g. authorize('librarian') or authorize('member','librarian')
 *
 * Example:
 *   router.post('/books', authenticate, authorize('librarian'), addBook);
 *   router.get('/reports', authenticate, authorize('librarian'), getReports);
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Required role(s): ${roles.join(', ')}. Your role: ${req.user.role}`,
      });
    }
    next();
  };
}

// ── ownDataOnly ───────────────────────────────────────────────────────────────
/**
 * Ensures a member can only access their own data.
 * Librarians bypass this check and can access any member's data.
 * Must be used AFTER authenticate().
 *
 * @param {string} paramName - the req.params key that holds the target userID
 *
 * Example:
 *   router.get('/members/:userID/history', authenticate, ownDataOnly('userID'), handler);
 *   router.get('/fines/:userID',           authenticate, ownDataOnly('userID'), handler);
 */
function ownDataOnly(paramName = 'userID') {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    // Librarians can access anyone's data
    if (req.user.role === 'librarian') return next();

    const targetID = parseInt(req.params[paramName]);
    if (req.user.userID !== targetID) {
      return res.status(403).json({ error: 'You can only access your own data.' });
    }
    next();
  };
}

// ── auditLog ──────────────────────────────────────────────────────────────────
/**
 * Writes an event to the audit_logs table.
 * Fire-and-forget — never throws, never blocks the request.
 *
 * Called automatically by authRoutes and adminRoutes for all auth events.
 * Other modules (Borrowing, Payments, etc.) can also import and call this
 * to log significant events.
 *
 * @param {object}      opts
 * @param {number|null} opts.userID    - the user who performed the action
 * @param {string}      opts.action    - e.g. 'LOGIN_SUCCESS', 'BOOK_BORROWED'
 * @param {string}      [opts.ip]      - req.ip
 * @param {string}      [opts.userAgent] - req.headers['user-agent']
 * @param {object}      [opts.meta]    - any extra context (will be JSON-stringified)
 *
 * Example:
 *   auditLog({ userID: req.user.userID, action: 'BOOK_BORROWED',
 *               ip: req.ip, meta: { bookID: 3 } });
 */
function auditLog({ userID = null, action, ip = null, userAgent = null, meta = null }) {
  db.run(
    `INSERT INTO audit_logs (user_id, action, ip_address, user_agent, meta)
     VALUES (?, ?, ?, ?, ?)`,
    [userID, action, ip, userAgent, meta ? JSON.stringify(meta) : null],
    (err) => {
      if (err) console.error('Audit log error:', err.message);
    }
  );
}

module.exports = { authenticate, optionalAuth, authorize, ownDataOnly, auditLog };
