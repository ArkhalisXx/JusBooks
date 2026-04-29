const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");

// ── Config ─────────────────────────────────────────────────────────────────────
const JWT_SECRET      = process.env.JWT_SECRET || "jusbooks_dev_secret_change_in_prod";
const JWT_EXPIRES_IN  = process.env.JWT_EXPIRES_IN || "8h";
const SALT_ROUNDS     = 12;

/**
 * Abstract base class for all JusBooks users.
 * Provides real bcrypt password hashing and JWT session management.
 *
 * Subclasses: Member, Librarian, NonMember
 */
class User {
  constructor(userID, username, email, password, role) {
    if (new.target === User) {
      throw new Error("User is abstract and cannot be instantiated directly.");
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
   * Use this before saving a new user to the DB.
   * @param {string} plainPassword
   * @returns {Promise<string>} hashed password
   */
  static async hashPassword(plainPassword) {
    if (!plainPassword || plainPassword.length < 8) {
      throw new Error("Password must be at least 8 characters.");
    }
    return bcrypt.hash(plainPassword, SALT_ROUNDS);
  }

  /**
   * Compares a plain-text password against a stored bcrypt hash.
   * @param {string} plainPassword
   * @param {string} hashedPassword
   * @returns {Promise<boolean>}
   */
  static async verifyPassword(plainPassword, hashedPassword) {
    return bcrypt.compare(plainPassword, hashedPassword);
  }

  // ── JWT Utilities ─────────────────────────────────────────────────────────────

  /**
   * Generates a signed JWT for this user.
   * Payload includes userID, username, email, and role.
   * @returns {string} signed JWT
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
   * Verifies and decodes a JWT.
   * @param {string} token
   * @returns {{ userID, username, email, role, iat, exp }}
   * @throws if token is invalid or expired
   */
  static verifyToken(token) {
    return jwt.verify(token, JWT_SECRET);
  }

  // ── Auth (implemented by subclasses) ─────────────────────────────────────────

  /**
   * Validates credentials against the DB and returns a JWT on success.
   * Must be implemented by Member and Librarian.
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{ token: string, user: object } | null>}
   */
  async login(email, password) {
    throw new Error("login() must be implemented by subclass.");
  }

  /**
   * Invalidates the current session.
   * Implementation depends on session strategy (token blacklist / DB flag).
   */
  logout() {
    throw new Error("logout() must be implemented by subclass.");
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /**
   * Returns a safe public representation — no password hash.
   * @returns {object}
   */
  toPublic() {
    return {
      userID  : this.userID,
      username: this.username,
      email   : this.email,
      role    : this.role,
    };
  }
}

module.exports = { User, JWT_SECRET, SALT_ROUNDS };
