const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const { logActivity } = require('../utils/activity');

const router = express.Router();

router.use(authenticate);
router.use(attachStore);

// All stores (for the admin store switcher)
router.get('/', authorize('admin'), (req, res) => {
  const stores = db.prepare('SELECT * FROM stores ORDER BY name').all();
  res.json({ stores });
});

// Current store details + settings (also usable by non-admins)
router.get('/current', (req, res) => {
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(req.storeId);
  if (!store) return res.status(404).json({ error: 'Store not found' });
  res.json({ store });
});

router.post('/', authorize('admin'), (req, res) => {
  const { name, address, phone, gstin, receipt_footer } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db
    .prepare(
      'INSERT INTO stores (name, address, phone, gstin, receipt_footer) VALUES (?,?,?,?,?)'
    )
    .run(name, address || null, phone || null, gstin || null, receipt_footer || null);
  // Give every existing product opening stock at the new store
  db.prepare(
    `INSERT OR IGNORE INTO product_stock (product_id, store_id, stock_qty, reorder_level)
     SELECT id, ?, 0, 0 FROM products`
  ).run(info.lastInsertRowid);
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(info.lastInsertRowid);
  logActivity(req.user, 'store_created', `Created store "${store.name}"`);
  res.status(201).json({ store });
});

// Update settings for the current store (admin only)
router.put('/current', authorize('admin'), (req, res) => {
  const { name, address, phone, gstin, receipt_footer } = req.body || {};
  const existing = db.prepare('SELECT * FROM stores WHERE id = ?').get(req.storeId);
  if (!existing) return res.status(404).json({ error: 'Store not found' });
  db.prepare(
    'UPDATE stores SET name=?, address=?, phone=?, gstin=?, receipt_footer=? WHERE id=?'
  ).run(
    name ?? existing.name,
    address ?? existing.address,
    phone ?? existing.phone,
    gstin ?? existing.gstin,
    receipt_footer ?? existing.receipt_footer,
    req.storeId
  );
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(req.storeId);
  logActivity(req.user, 'store_updated', `Updated settings for "${store.name}"`, req.storeId);
  res.json({ store });
});

router.put('/:id', authorize('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, address, phone, gstin, receipt_footer } = req.body || {};
  const existing = db.prepare('SELECT * FROM stores WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Store not found' });
  db.prepare(
    'UPDATE stores SET name=?, address=?, phone=?, gstin=?, receipt_footer=? WHERE id=?'
  ).run(
    name ?? existing.name,
    address ?? existing.address,
    phone ?? existing.phone,
    gstin ?? existing.gstin,
    receipt_footer ?? existing.receipt_footer,
    id
  );
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(id);
  logActivity(req.user, 'store_updated', `Updated store "${store.name}"`, req.storeId);
  res.json({ store });
});

module.exports = router;
