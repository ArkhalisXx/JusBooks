/**
 * routes/adminRoutes.js
 * Auth & RBAC Module — JusBooks
 *
 * All routes require: authenticate + authorize('librarian')
 *
 * Endpoints:
 *   GET    /api/admin/users                  — list all users
 *   GET    /api/admin/users/:userID          — get one user
 *   POST   /api/admin/users                  — create librarian account
 *   PATCH  /api/admin/users/:userID/suspend  — suspend or unsuspend a user
 *   PATCH  /api/admin/users/:userID/activate — activate or deactivate a user
 *   PATCH  /api/admin/users/:userID/role     — change a user's role
 *   DELETE /api/admin/users/:userID          — soft-delete (deactivate) a user
 *   GET    /api/admin/audit-logs             — view paginated audit log
 *
 * Mount in server.js / app.js:
 *   const adminRoutes = require('./routes/adminRoutes');
 *   app.use('/api/admin', adminRoutes);
 */

const express = require('express');
const router  = express.Router();
const { body, validationResult } = require('express-validator');

const { User }  = require('../models/User');
const db        = require('../database/db');
const { authenticate, authorize, auditLog } = require('../middleware/auth');

// All admin routes require a valid token AND librarian role
router.use(authenticate, authorize('librarian'));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/users
// Returns all users with their status. Used by librarian dashboard.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/users', (req, res) => {
  db.all(
    `SELECT user_id, username, email, role, is_active, is_suspended
     FROM users
     ORDER BY user_id DESC`,
    [],
    (err, rows) => {
      if (err) {
        console.error('List users error:', err.message);
        return res.status(500).json({ error: 'Could not fetch users.' });
      }
      return res.json({ users: rows });
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/users/:userID
// Returns a single user's details.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/users/:userID', async (req, res) => {
  try {
    const user = await User.findById(req.params.userID);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    return res.json({ user });
  } catch (err) {
    return res.status(500).json({ error: 'Could not fetch user.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/users
// Creates a librarian account (only librarians can do this).
// Self-registration always creates a 'member'; this route is for librarians.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/users', [
  body('username').trim().notEmpty().withMessage('Username is required.'),
  body('email').isEmail().withMessage('Valid email required.').normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
    .matches(/[A-Z]/).withMessage('Must contain an uppercase letter.')
    .matches(/[0-9]/).withMessage('Must contain a number.'),
  body('role')
    .isIn(['member', 'librarian']).withMessage('Role must be member or librarian.'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { username, email, password, role } = req.body;

  try {
    const existing = await User.findByEmail(email);
    if (existing) return res.status(409).json({ error: 'Email already in use.' });

    const passwordHash = await User.hashPassword(password);

    db.run(
      `INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)`,
      [username, email.toLowerCase().trim(), passwordHash, role],
      function (err) {
        if (err) return res.status(500).json({ error: 'Could not create account.' });

        auditLog({
          userID:    req.user.userID,
          action:    'ADMIN_USER_CREATED',
          ip:        req.ip,
          userAgent: req.headers['user-agent'],
          meta:      { newUserID: this.lastID, role },
        });

        return res.status(201).json({
          message: `${role} account created successfully.`,
          user: { userID: this.lastID, username, email, role },
        });
      }
    );
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/users/:userID/suspend
// Suspends or unsuspends a user.
// Body: { "suspend": true }  to suspend
//       { "suspend": false } to unsuspend
// Suspending also revokes all active tokens (forces immediate logout).
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/users/:userID/suspend', async (req, res) => {
  const { userID } = req.params;
  const suspend    = req.body.suspend !== false; // defaults to true

  // Prevent librarian from suspending themselves
  if (parseInt(userID) === req.user.userID) {
    return res.status(400).json({ error: 'You cannot suspend your own account.' });
  }

  try {
    const user = await User.findById(userID);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    await User.setSuspended(userID, suspend);

    // Force immediate logout from all devices when suspending
    if (suspend) {
      await User.revokeAllUserTokens(userID);
    }

    auditLog({
      userID:    req.user.userID,
      action:    suspend ? 'USER_SUSPENDED' : 'USER_UNSUSPENDED',
      ip:        req.ip,
      userAgent: req.headers['user-agent'],
      meta:      { targetUserID: parseInt(userID) },
    });

    return res.json({
      message: `User account ${suspend ? 'suspended' : 'unsuspended'} successfully.`,
    });
  } catch (err) {
    console.error('Suspend error:', err.message);
    return res.status(500).json({ error: 'Could not update account status.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/users/:userID/activate
// Activates or deactivates a user without full deletion.
// Body: { "active": true | false }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/users/:userID/activate', async (req, res) => {
  const { userID } = req.params;
  const active     = req.body.active !== false; // defaults to true

  if (parseInt(userID) === req.user.userID) {
    return res.status(400).json({ error: 'You cannot deactivate your own account.' });
  }

  try {
    const user = await User.findById(userID);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    await User.setActive(userID, active);

    if (!active) {
      await User.revokeAllUserTokens(userID);
    }

    auditLog({
      userID:    req.user.userID,
      action:    active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
      ip:        req.ip,
      userAgent: req.headers['user-agent'],
      meta:      { targetUserID: parseInt(userID) },
    });

    return res.json({
      message: `User account ${active ? 'activated' : 'deactivated'} successfully.`,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not update account status.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/users/:userID/role
// Changes a user's role (member ↔ librarian).
// Body: { "role": "librarian" | "member" }
// Also revokes all tokens so the user re-logs in with the new role.
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/users/:userID/role', [
  body('role').isIn(['member', 'librarian']).withMessage('Role must be member or librarian.'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { userID } = req.params;
  const { role }   = req.body;

  if (parseInt(userID) === req.user.userID) {
    return res.status(400).json({ error: 'You cannot change your own role.' });
  }

  try {
    const user = await User.findById(userID);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    db.run(
      `UPDATE users SET role = ? WHERE user_id = ?`,
      [role, userID],
      async function (err) {
        if (err) return res.status(500).json({ error: 'Could not update role.' });

        // Revoke tokens so the user must re-login with new role embedded in JWT
        await User.revokeAllUserTokens(userID);

        auditLog({
          userID:    req.user.userID,
          action:    'ROLE_CHANGED',
          ip:        req.ip,
          userAgent: req.headers['user-agent'],
          meta:      { targetUserID: parseInt(userID), newRole: role },
        });

        return res.json({
          message: `Role updated to '${role}'. User must log in again for changes to take effect.`,
        });
      }
    );
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/admin/users/:userID
// Soft-deletes a user by setting is_active = 0.
// Hard deletion is avoided to preserve FK integrity and audit trail.
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/users/:userID', async (req, res) => {
  const { userID } = req.params;

  if (parseInt(userID) === req.user.userID) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }

  try {
    const user = await User.findById(userID);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    await User.setActive(userID, false);
    await User.revokeAllUserTokens(userID);

    auditLog({
      userID:    req.user.userID,
      action:    'USER_DELETED',
      ip:        req.ip,
      userAgent: req.headers['user-agent'],
      meta:      { targetUserID: parseInt(userID) },
    });

    return res.json({ message: 'User account has been deactivated and removed from the system.' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/audit-logs
// Returns paginated audit logs with the associated user's email.
// Query params: ?page=1&limit=50&action=LOGIN_FAILED
// ─────────────────────────────────────────────────────────────────────────────
router.get('/audit-logs', (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 50);
  const offset = (page - 1) * limit;
  const action = req.query.action || null; // optional filter by action type

  const whereClause = action ? `WHERE al.action = ?` : '';
  const params      = action ? [action, limit, offset] : [limit, offset];

  db.all(
    `SELECT al.log_id, al.user_id, u.username, u.email,
            al.action, al.ip_address, al.user_agent, al.meta, al.created_at
     FROM audit_logs al
     LEFT JOIN users u ON u.user_id = al.user_id
     ${whereClause}
     ORDER BY al.created_at DESC
     LIMIT ? OFFSET ?`,
    params,
    (err, rows) => {
      if (err) {
        console.error('Audit logs error:', err.message);
        return res.status(500).json({ error: 'Could not fetch audit logs.' });
      }

      const countParams = action ? [action] : [];
      db.get(
        `SELECT COUNT(*) AS total FROM audit_logs ${whereClause}`,
        countParams,
        (err2, count) => {
          return res.json({
            logs:  rows,
            total: count?.total || 0,
            page,
            limit,
          });
        }
      );
    }
  );
});

module.exports = router;
