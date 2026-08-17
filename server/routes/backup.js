const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(authenticate, attachStore);

const TABLES = [
  'users',
  'categories',
  'products',
  'product_stock',
  'invoices',
  'invoice_items',
  'stock_adjustments',
  'suppliers',
  'customers',
  'purchases',
  'purchase_items',
  'held_bills',
  'stores',
  'expenses',
  'returns',
  'return_items',
  'stock_transfers',
  'stock_transfer_items',
  'activity_logs',
];

// Download a full JSON snapshot of the Firebase database (admin only).
router.get('/', authorize('admin'), asyncHandler(async (req, res) => {
  const raw = await db.getAll();
  const snapshot = {};
  for (const t of TABLES) {
    snapshot[t] = raw[t] || {};
  }
  snapshot.meta = raw.meta || {};
  const body = JSON.stringify(snapshot, null, 2);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="retail-pos-backup-${new Date().toISOString().slice(0, 10)}.json"`
  );
  res.send(body);
}));

module.exports = router;