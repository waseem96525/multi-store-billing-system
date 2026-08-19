const express = require('express');
const db = require('../db');
const { authenticate, requirePerm } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(authenticate, attachStore);

// Audit log with optional filters (admin only)
router.get('/', requirePerm('activity.view'), asyncHandler(async (req, res) => {
  const { action, user_id, limit = 300 } = req.query;
  let logs = await db.all('activity_logs');
  if (action) logs = logs.filter((l) => l.action === action);
  if (user_id) logs = logs.filter((l) => String(l.user_id) === String(user_id));
  logs.sort((a, b) => b.id - a.id);
  logs = logs.slice(0, Math.min(parseInt(limit, 10) || 300, 1000));

  const [users, stores, all] = await Promise.all([db.all('users'), db.all('stores'), db.all('activity_logs')]);
  const userMap = new Map(users.map((u) => [u.id, u]));
  const storeMap = new Map(stores.map((s) => [s.id, s]));
  const actions = [...new Set(all.map((l) => l.action))].sort();
  res.json({
    logs: logs.map((l) => ({
      ...l,
      user_name: l.user_id && userMap.get(l.user_id) ? userMap.get(l.user_id).name : null,
      store_name: l.store_id && storeMap.get(l.store_id) ? storeMap.get(l.store_id).name : null,
    })),
    actions,
  });
}));

// Distinct users who have activity entries (for the filter dropdown)
router.get('/users', requirePerm('activity.view'), asyncHandler(async (req, res) => {
  const [logs, users] = await Promise.all([db.all('activity_logs'), db.all('users')]);
  const userMap = new Map(users.map((u) => [u.id, u]));
  const seen = new Set();
  const result = [];
  for (const l of logs) {
    if (!l.user_id || seen.has(l.user_id)) continue;
    seen.add(l.user_id);
    const u = userMap.get(l.user_id);
    if (u) result.push({ id: u.id, name: u.name });
  }
  result.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  res.json({ users: result });
}));

module.exports = router;