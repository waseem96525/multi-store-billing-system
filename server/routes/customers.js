const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', authenticate, asyncHandler(async (req, res) => {
  const customers = await db.all('customers');
  customers.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  res.json({ customers: customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email })) });
}));

router.post('/', authenticate, asyncHandler(async (req, res) => {
  const { name, phone, email } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const customer = await db.insert('customers', {
    name,
    phone: phone || null,
    email: email || null,
    created_at: db.now(),
  });
  res.status(201).json({ customer });
}));

router.put('/:id', authenticate, asyncHandler(async (req, res) => {
  const existing = await db.get('customers', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Customer not found' });
  const { name, phone, email } = req.body || {};
  const updated = await db.update('customers', req.params.id, {
    name: name !== undefined && name !== '' ? name : existing.name,
    phone: phone !== undefined ? phone : existing.phone,
    email: email !== undefined ? email : existing.email,
  });
  res.json({ customer: { id: updated.id, name: updated.name, phone: updated.phone, email: updated.email } });
}));

module.exports = router;