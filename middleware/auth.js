const { User } = require("../models/User");

/**
 * RBAC Middleware for Express.js (S5, NF2).
 *
 * Usage:
 *   const { authenticate, authorize } = require('./middleware/auth');
 *
 *   router.get('/books',         authenticate, anyoneLoggedIn);
 *   router.post('/books',        authenticate, authorize('librarian'), librarianOnly);
 *   router.post('/borrow',       authenticate, authorize('member'),    memberOnly);
 *   router.get('/admin/reports', authenticate, authorize('librarian'), librarianOnly);
 */

/**
 * Verifies the JWT from the Authorization header.
 * Attaches decoded payload to req.user on success.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided. Please log in." });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = User.verifyToken(token);
    req.user = decoded; // { userID, username, email, role, iat, exp }
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }
    return res.status(401).json({ error: "Invalid token." });
  }
}

/**
 * Restricts a route to specific roles.
 * @param {...string} roles - e.g. authorize('librarian') or authorize('member', 'librarian')
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated." });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Required role(s): ${roles.join(", ")}. Your role: ${req.user.role}`,
      });
    }
    next();
  };
}

/**
 * Ensures a member can only access their own data (not another member's).
 * Librarians bypass this check.
 * Use after authenticate().
 *
 * @param {string} paramName - req.params key holding the target memberID
 */
function ownDataOnly(paramName = "memberID") {
  return (req, res, next) => {
    if (req.user.role === "librarian") return next(); // librarians see all

    const targetID = parseInt(req.params[paramName]);
    if (req.user.userID !== targetID) {
      return res.status(403).json({ error: "You can only access your own data." });
    }
    next();
  };
}

module.exports = { authenticate, authorize, ownDataOnly };
