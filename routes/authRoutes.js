/**
 * routes/authRoutes.js
 * Auth & RBAC Module — JusBooks
 *
 * Endpoints:
 *   POST /api/auth/register   — create a member account
 *   POST /api/auth/login      — login; returns access token + sets refresh cookie
 *   POST /api/auth/refresh    — rotate refresh token; returns new access token
 *   POST /api/auth/logout     — revoke refresh token + clear cookie
 *   GET  /api/auth/me         — get current user's profile
 *
 * Mount in server.js / app.js:
 *   const authRoutes = require('./routes/authRoutes');
 *   app.use('/api/auth', authRoutes);
 */

const express   = require('express');
const router    = express.Router();
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const { User }  = require('../models/User');
const Member    = require('../models/Member');
const db        = require('../database/db');
const { authenticate, auditLog } = require('../middleware/auth');

// ── Rate limiter — brute-force protection on auth endpoints ───────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  message:  { error: 'Too many attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ── Validation rules ──────────────────────────────────────────────────────────
const registerRules = [
  body('username')
    .trim()
    .notEmpty().withMessage('Username is required.')
    .isLength({ max: 50 }).withMessage('Username must be under 50 characters.'),
  body('email')
    .isEmail().withMessage('A valid email is required.')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter.')
    .matches(/[0-9]/).withMessage('Password must contain at least one number.'),
];

const loginRules = [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required.'),
];

// ── Helper: set secure httpOnly refresh token cookie ─────────────────────────
function setRefreshCookie(res, token) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days in ms
  });
}

// ── Helper: find user by email (passed to Member.login) ──────────────────────
function findUserByEmail(email) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1`,
      [email.trim()],
      (err, row) => { if (err) reject(err); else resolve(row || null); }
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/register
// Public. Creates a new member account. Role is always 'member'.
// Librarians must be promoted via the admin panel after registration.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/register', authLimiter, registerRules, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array() });
  }

  const { username, email, password } = req.body;

  try {
    // Check for duplicate email
    const existing = await User.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const passwordHash = await User.hashPassword(password);

    db.run(
      `INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)`,
      [username, email.toLowerCase().trim(), passwordHash, 'member'],
      function (err) {
        if (err) {
          console.error('Register DB error:', err.message);
          return res.status(500).json({ error: 'Could not create account. Please try again.' });
        }

        auditLog({
          userID:    this.lastID,
          action:    'REGISTER',
          ip:        req.ip,
          userAgent: req.headers['user-agent'],
        });

        return res.status(201).json({
          message: 'Registration successful. You can now log in.',
          user: { userID: this.lastID, username, email: email.toLowerCase().trim(), role: 'member' },
        });
      }
    );
  } catch (err) {
    console.error('Register error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login
// Public. Validates credentials using Member.login(), issues access token
// and sets a httpOnly refresh token cookie.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/login', authLimiter, loginRules, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array() });
  }

  const { email, password } = req.body;

  try {
    // Member.login handles: password verify, role check, membership status check
    const { token: accessToken, user } = await Member.login(email, password, findUserByEmail);

    // Fetch full row to get user_id for refresh token
    const row = await User.findByEmail(email);

    // Check is_active / is_suspended (Member.login doesn't check these columns)
    if (row.is_active === 0) {
      return res.status(403).json({ error: 'Account has been deactivated. Contact the librarian.' });
    }
    if (row.is_suspended === 1) {
      return res.status(403).json({ error: 'Account is suspended. Please settle outstanding obligations.' });
    }

    // Issue and store refresh token
    const refreshToken = User.generateRefreshToken(row);
    await User.saveRefreshToken({
      userID:    row.user_id,
      tokenHash: User.hashToken(refreshToken),
      expiresAt: User.refreshTokenExpiry(),
    });

    auditLog({
      userID:    row.user_id,
      action:    'LOGIN_SUCCESS',
      ip:        req.ip,
      userAgent: req.headers['user-agent'],
    });

    setRefreshCookie(res, refreshToken);

    return res.json({
      message: 'Login successful.',
      accessToken,
      user,
    });
  } catch (err) {
    // Member.login throws descriptive errors — pass them to the client
    auditLog({
      action: 'LOGIN_FAILED',
      ip:     req.ip,
      meta:   { email },
    });
    return res.status(401).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/refresh
// Public (uses cookie). Validates the refresh token, rotates it,
// and returns a new short-lived access token.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (!token) {
    return res.status(401).json({ error: 'No refresh token provided. Please log in.' });
  }

  try {
    const decoded   = User.verifyRefreshToken(token);
    const tokenHash = User.hashToken(token);
    const stored    = await User.findRefreshToken(tokenHash);

    if (!stored || stored.user_id !== decoded.userID) {
      return res.status(403).json({ error: 'Invalid or expired refresh token. Please log in again.' });
    }

    // Revoke old token (rotation — prevents reuse)
    await User.revokeRefreshToken(tokenHash);

    // Fetch latest user state
    const user = await User.findById(decoded.userID);
    if (!user) {
      return res.status(403).json({ error: 'User account not found.' });
    }
    if (user.is_active === 0) {
      return res.status(403).json({ error: 'Account has been deactivated.' });
    }
    if (user.is_suspended === 1) {
      return res.status(403).json({ error: 'Account is suspended.' });
    }

    // Build a temporary User-like object to call generateToken()
    // (We can't instantiate User directly — it's abstract)
    const tempUser = Object.assign(Object.create(User.prototype), {
      userID  : user.user_id,
      username: user.username,
      email   : user.email,
      role    : user.role,
    });

    const newAccessToken = tempUser.generateToken();
    const newRefresh     = User.generateRefreshToken(user);

    await User.saveRefreshToken({
      userID:    user.user_id,
      tokenHash: User.hashToken(newRefresh),
      expiresAt: User.refreshTokenExpiry(),
    });

    setRefreshCookie(res, newRefresh);

    return res.json({ accessToken: newAccessToken });
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired refresh token. Please log in again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/logout
// Semi-protected. Revokes the refresh token and clears the cookie.
// Works even if no token is present (safe to call anytime).
// ─────────────────────────────────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
  const token = req.cookies?.refreshToken;

  if (token) {
    await User.revokeRefreshToken(User.hashToken(token)).catch(() => {});

    // Log event if we can identify the user from the token
    try {
      const decoded = User.verifyRefreshToken(token);
      auditLog({
        userID:    decoded.userID,
        action:    'LOGOUT',
        ip:        req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch {
      // Token may be expired — still clear cookie
    }
  }

  res.clearCookie('refreshToken');
  return res.json({ message: 'Logged out successfully.' });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/me
// Protected. Returns the current user's profile.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.userID);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    return res.json({
      user: {
        userID  : user.user_id,
        username: user.username,
        email   : user.email,
        role    : user.role,
      },
    });
  } catch (err) {
    console.error('GET /me error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
