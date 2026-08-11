const express = require('express');
const db = require('../db');
const { hashPassword, verifyPassword, signToken } = require('../utils/auth');
const { authenticate, authorize } = require('../middleware/auth');

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
  });
  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
    },
  });
});

router.get('/me', authenticate, (req, res) => {
  const user = db
    .prepare('SELECT id, name, username, role, active, created_at FROM users WHERE id = ?')
    .get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

router.post('/register', authenticate, authorize('admin'), (req, res) => {
  const { name, username, password, role } = req.body || {};
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'name, username, password required' });
  }
  const allowedRoles = ['admin', 'cashier', 'inventory'];
  const userRole = allowedRoles.includes(role) ? role : 'cashier';
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Username already exists' });
  const info = db
    .prepare('INSERT INTO users (name, username, password_hash, role) VALUES (?,?,?,?)')
    .run(name, username, hashPassword(password), userRole);
  res.status(201).json({ id: info.lastInsertRowid, name, username, role: userRole });
});

router.get('/users', authenticate, authorize('admin'), (req, res) => {
  const users = db
    .prepare('SELECT id, name, username, role, active, created_at FROM users ORDER BY id')
    .all();
  res.json({ users });
});

router.patch('/users/:id', authenticate, authorize('admin'), (req, res) => {
  const { active } = req.body || {};
  const info = db
    .prepare('UPDATE users SET active = ? WHERE id = ?')
    .run(active ? 1 : 0, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'User not found' });
  res.json({ success: true });
});

module.exports = router;
