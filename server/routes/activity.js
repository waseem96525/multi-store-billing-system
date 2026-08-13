const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');

const router = express.Router();

router.use(authenticate, attachStore);

// Audit log with optional filters (admin only)
router.get('/', authorize('admin'), (req, res) => {
  const { action, user_id, limit = 300 } = req.query;
  let sql = `SELECT a.*, u.name AS user_name, s.name AS store_name
             FROM activity_logs a
             LEFT JOIN users u ON u.id = a.user_id
             LEFT JOIN stores s ON s.id = a.store_id
             WHERE 1=1`;
  const params = [];
  if (action) {
    sql += ' AND a.action = ?';
    params.push(action);
  }
  if (user_id) {
    sql += ' AND a.user_id = ?';
    params.push(Number(user_id));
  }
  sql += ' ORDER BY a.id DESC LIMIT ?';
  params.push(Math.min(parseInt(limit, 10) || 300, 1000));

  const logs = db.prepare(sql).all(...params);
  const actions = db
    .prepare('SELECT DISTINCT action FROM activity_logs ORDER BY action')
    .all()
    .map((r) => r.action);
  res.json({ logs, actions });
});

// Distinct users who have activity entries (for the filter dropdown)
router.get('/users', authorize('admin'), (req, res) => {
  const users = db
    .prepare(
      `SELECT DISTINCT u.id, u.name FROM activity_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE u.id IS NOT NULL ORDER BY u.name`
    )
    .all();
  res.json({ users });
});

module.exports = router;
