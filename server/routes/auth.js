const express = require('express');
const db = require('../db');
const { hashPassword, verifyPassword, signToken } = require('../utils/auth');
const { authenticate, authorize } = require('../middleware/auth');
const { logActivity } = require('../utils/activity');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = signToken({
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    store_id: user.store_id,
  });
  logActivity(user, 'login', `${user.name} signed in`);
  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      store_id: user.store_id,
    },
  });
});

router.get('/me', authenticate, (req, res) => {
  const user = db
    .prepare(
      `SELECT u.id, u.name, u.username, u.role, u.active, u.store_id, u.created_at,
              s.name AS store_name
       FROM users u LEFT JOIN stores s ON s.id = u.store_id
       WHERE u.id = ?`
    )
    .get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

router.post('/register', authenticate, authorize('admin'), (req, res) => {
  const { name, username, password, role, store_id } = req.body || {};
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'name, username, password required' });
  }
  const allowedRoles = ['admin', 'cashier', 'inventory'];
  const userRole = allowedRoles.includes(role) ? role : 'cashier';
  const userStoreId = Number(store_id) || req.user.store_id || 1;
  const store = db.prepare('SELECT id FROM stores WHERE id = ?').get(userStoreId);
  if (!store) return res.status(400).json({ error: 'Invalid store' });
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Username already exists' });
  const info = db
    .prepare('INSERT INTO users (name, username, password_hash, role, store_id) VALUES (?,?,?,?,?)')
    .run(name, username, hashPassword(password), userRole, userStoreId);
  logActivity(req.user, 'user_created', `Created user "${username}" (${userRole})`);
  res.status(201).json({ id: info.lastInsertRowid, name, username, role: userRole, store_id: userStoreId });
});

router.get('/users', authenticate, authorize('admin'), (req, res) => {
  const users = db
    .prepare(
      `SELECT u.id, u.name, u.username, u.role, u.active, u.store_id, u.created_at,
              s.name AS store_name
       FROM users u LEFT JOIN stores s ON s.id = u.store_id
       ORDER BY u.id`
    )
    .all();
  res.json({ users });
});

router.patch('/users/:id', authenticate, authorize('admin'), (req, res) => {
  const { active, store_id } = req.body || {};
  const sets = [];
  const params = [];
  if (active !== undefined) {
    sets.push('active = ?');
    params.push(active ? 1 : 0);
  }
  if (store_id !== undefined) {
    const store = db.prepare('SELECT id FROM stores WHERE id = ?').get(store_id);
    if (!store) return res.status(400).json({ error: 'Invalid store' });
    sets.push('store_id = ?');
    params.push(Number(store_id));
  }
  if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
  params.push(req.params.id);
  const info = db
    .prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
    .run(...params);
  if (info.changes === 0) return res.status(404).json({ error: 'User not found' });
  logActivity(req.user, 'user_updated', `Updated user id ${req.params.id}`, req.storeId);
  res.json({ success: true });
});

module.exports = router;
