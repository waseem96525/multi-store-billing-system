const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', authenticate, asyncHandler(async (req, res) => {
  const suppliers = await db.all('suppliers');
  suppliers.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  res.json({ suppliers });
}));

router.post('/', authenticate, authorize('admin', 'inventory'), asyncHandler(async (req, res) => {
  const { name, phone, email, address } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const supplier = await db.insert('suppliers', {
    name,
    phone: phone || null,
    email: email || null,
    address: address || null,
    outstanding_balance: 0,
  });
  res.status(201).json({ supplier });
}));

router.put('/:id', authenticate, authorize('admin', 'inventory'), asyncHandler(async (req, res) => {
  const id = req.params.id;
  const existing = await db.get('suppliers', id);
  if (!existing) return res.status(404).json({ error: 'Supplier not found' });
  const { name, phone, email, address } = req.body || {};
  const supplier = await db.update('suppliers', id, {
    name: name ?? existing.name,
    phone: phone ?? existing.phone,
    email: email ?? existing.email,
    address: address ?? existing.address,
  });
  res.json({ supplier });
}));

router.delete('/:id', authenticate, authorize('admin', 'inventory'), asyncHandler(async (req, res) => {
  const existing = await db.get('suppliers', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Supplier not found' });
  await db.remove('suppliers', req.params.id);
  res.json({ success: true });
}));

module.exports = router;