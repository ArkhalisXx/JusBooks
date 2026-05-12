const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const db     = require('../database/db');

// ── Config ────────────────────────────────────────────────────────────────────
const JWT_SECRET         = process.env.JWT_SECRET          || 'jusbooks_dev_secret_change_in_prod';
const JWT_EXPIRES_IN     = process.env.JWT_EXPIRES_IN      || '8h';
const REFRESH_SECRET     = process.env.JWT_REFRESH_SECRET  || 'jusbooks_refresh_secret_change_in_prod';
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
const SALT_ROUNDS        = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;

/**
 * Abstract base class for all JusBooks users.
 * Provides bcrypt password hashing and JWT session management.
 *
 * Subclasses: Member, Librarian, NonMember
 */
class User {
  constructor(userID, username, email, password, role) {
    if (new.target === User) {
      throw new Error('User is abstract and cannot be instantiated directly.');
    }
    this.userID   = userID;
    this.username = username;
    this.email    = email;
    this.password = password; // always a bcrypt hash — never plain text
    this.role     = role;
  }

  // ── Password Utilities ────────────────────────────────────────────────────────

  /**
   * Hashes a plain-text password using bcrypt.
   * Use before saving a new user to the DB.
   */
  static async hashPassword(plainPassword) {
    if (!plainPassword || plainPassword.length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }
    return bcrypt.hash(plainPassword, SALT_ROUNDS);
  }

  /**
   * Compares a plain-text password against a stored bcrypt hash.
   */
  static async verifyPassword(plainPassword, hashedPassword) {
    return bcrypt.compare(plainPassword, hashedPassword);
  }

  // ── JWT Utilities ─────────────────────────────────────────────────────────────

  /**
   * Generates a signed short-lived access JWT for this user instance.
   * Payload: { userID, username, email, role }
   */
  generateToken() {
    return jwt.sign(
      {
        userID  : this.userID,
        username: this.username,
        email   : this.email,
        role    : this.role,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
  }

  /**
   * Verifies and decodes an access JWT.
   * @returns {{ userID, username, email, role, iat, exp }}
   * @throws if invalid or expired
   */
  static verifyToken(token) {
    return jwt.verify(token, JWT_SECRET);
  }

  /**
   * Generates a signed long-lived refresh JWT.
   * @param {object} user - must have user_id or userID
   */
  static generateRefreshToken(user) {
    const userID = user.user_id || user.userID;
    return jwt.sign({ userID }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES_IN });
  }

  /**
   * Verifies and decodes a refresh JWT.
   * @returns {{ userID, iat, exp }}
   * @throws if invalid or expired
   */
  static verifyRefreshToken(token) {
    return jwt.verify(token, REFRESH_SECRET);
  }

  /**
   * SHA-256 hashes a token for safe storage in the DB.
   * Never store raw tokens — always hash first.
   */
  static hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Returns the expiry Date for a new refresh token (7 days from now).
   */
  static refreshTokenExpiry() {
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  }

  // ── Abstract Auth ─────────────────────────────────────────────────────────────

  async login(email, password) {
    throw new Error('login() must be implemented by subclass.');
  }

  logout() {
    throw new Error('logout() must be implemented by subclass.');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  toPublic() {
    return {
      userID  : this.userID,
      username: this.username,
      email   : this.email,
      role    : this.role,
    };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  AUTH & RBAC MODULE — Static DB helpers
//  These extend the User class with database operations needed for
//  authentication. They are added as static methods so the entire codebase
//  keeps using the same User import.
// ═════════════════════════════════════════════════════════════════════════════

// ── Finders ───────────────────────────────────────────────────────────────────

/**
 * Finds a user row by email (case-insensitive).
 * @returns {Promise<object|null>}
 */
User.findByEmail = function (email) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1`,
      [email.trim()],
      (err, row) => { if (err) reject(err); else resolve(row || null); }
    );
  });
};

/**
 * Finds a user row by user_id (safe public fields only).
 * @returns {Promise<object|null>}
 */
User.findById = function (userID) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT user_id, username, email, role, is_active, is_suspended
       FROM users WHERE user_id = ? LIMIT 1`,
      [userID],
      (err, row) => { if (err) reject(err); else resolve(row || null); }
    );
  });
};

// ── Refresh token operations ──────────────────────────────────────────────────

/**
 * Persists a hashed refresh token to the DB.
 */
User.saveRefreshToken = function ({ userID, tokenHash, expiresAt }) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
      [userID, tokenHash, expiresAt],
      function (err) { if (err) reject(err); else resolve(this.lastID); }
    );
  });
};

/**
 * Finds a valid (non-revoked, non-expired) refresh token by its hash.
 * @returns {Promise<object|null>}
 */
User.findRefreshToken = function (tokenHash) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM refresh_tokens
       WHERE token_hash = ? AND revoked = 0 AND expires_at > datetime('now')
       LIMIT 1`,
      [tokenHash],
      (err, row) => { if (err) reject(err); else resolve(row || null); }
    );
  });
};

/**
 * Revokes a single refresh token (used on logout or token rotation).
 */
User.revokeRefreshToken = function (tokenHash) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?`,
      [tokenHash],
      (err) => { if (err) reject(err); else resolve(); }
    );
  });
};

/**
 * Revokes ALL refresh tokens for a user.
 * Called when a user is suspended, deactivated, or has their role changed.
 * Forces immediate logout from all devices.
 */
User.revokeAllUserTokens = function (userID) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?`,
      [userID],
      (err) => { if (err) reject(err); else resolve(); }
    );
  });
};

// ── Account status updates ────────────────────────────────────────────────────

/**
 * Suspends or unsuspends a user account.
 * Should be paired with revokeAllUserTokens() when suspending.
 */
User.setSuspended = function (userID, suspended) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users SET is_suspended = ? WHERE user_id = ?`,
      [suspended ? 1 : 0, userID],
      (err) => { if (err) reject(err); else resolve(); }
    );
  });
};

/**
 * Activates or deactivates a user account (soft delete).
 * Should be paired with revokeAllUserTokens() when deactivating.
 */
User.setActive = function (userID, active) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users SET is_active = ? WHERE user_id = ?`,
      [active ? 1 : 0, userID],
      (err) => { if (err) reject(err); else resolve(); }
    );
  });
};

module.exports = { User, JWT_SECRET, SALT_ROUNDS };
