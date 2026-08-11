const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, (req, res) => {
  const rows = db
    .prepare('SELECT id, name, phone, email FROM customers ORDER BY name')
    .all();
  res.json({ customers: rows });
});

router.post('/', authenticate, (req, res) => {
  const { name, phone, email } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db
    .prepare('INSERT INTO customers (name, phone, email) VALUES (?,?,?)')
    .run(name, phone || null, email || null);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ customer });
});

module.exports = router;
