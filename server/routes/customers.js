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

module.exports = router;