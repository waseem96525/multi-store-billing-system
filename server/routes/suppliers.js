const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, (req, res) => {
  res.json({ suppliers: db.prepare('SELECT * FROM suppliers ORDER BY name').all() });
});

router.post('/', authenticate, authorize('admin', 'inventory'), (req, res) => {
  const { name, phone, email, address } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db
    .prepare('INSERT INTO suppliers (name, phone, email, address) VALUES (?,?,?,?)')
    .run(name, phone || null, email || null, address || null);
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ supplier });
});

router.put('/:id', authenticate, authorize('admin', 'inventory'), (req, res) => {
  const id = req.params.id;
  const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Supplier not found' });
  const { name, phone, email, address } = req.body || {};
  db.prepare(
    'UPDATE suppliers SET name=?, phone=?, email=?, address=? WHERE id=?'
  ).run(
    name ?? existing.name,
    phone ?? existing.phone,
    email ?? existing.email,
    address ?? existing.address,
    id
  );
  res.json({ supplier: db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) });
});

router.delete('/:id', authenticate, authorize('admin', 'inventory'), (req, res) => {
  const info = db.prepare('DELETE FROM suppliers WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Supplier not found' });
  res.json({ success: true });
});

module.exports = router;
