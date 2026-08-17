const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const { logActivity } = require('../utils/activity');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(authenticate, attachStore);

// All stores (for the admin store switcher)
router.get('/', authorize('admin'), asyncHandler(async (req, res) => {
  const stores = await db.all('stores');
  stores.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  res.json({ stores });
}));

// Current store details + settings (also usable by non-admins)
router.get('/current', asyncHandler(async (req, res) => {
  const store = await db.get('stores', req.storeId);
  if (!store) return res.status(404).json({ error: 'Store not found' });
  res.json({ store });
}));

router.post('/', authorize('admin'), asyncHandler(async (req, res) => {
  const { name, address, phone, gstin, receipt_footer } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const [store, products] = await Promise.all([
    db.insert('stores', {
      name,
      address: address || null,
      phone: phone || null,
      gstin: gstin || null,
      receipt_footer: receipt_footer || null,
      created_at: db.now(),
    }),
    db.all('products'),
  ]);
  // Give every product zero stock at the new store (one multi-path write)
  const paths = {};
  for (const p of products) {
    paths[`product_stock/${db.stockKey(p.id, store.id)}`] = {
      product_id: p.id,
      store_id: store.id,
      stock_qty: 0,
      reorder_level: 0,
    };
  }
  if (products.length) await db.patchMulti(paths);
  logActivity(req.user, 'store_created', `Created store "${store.name}"`);
  res.status(201).json({ store });
}));

// Update settings for the current store (admin only)
router.put('/current', authorize('admin'), asyncHandler(async (req, res) => {
  const { name, address, phone, gstin, receipt_footer } = req.body || {};
  const existing = await db.get('stores', req.storeId);
  if (!existing) return res.status(404).json({ error: 'Store not found' });
  const store = await db.update('stores', req.storeId, {
    name: name ?? existing.name,
    address: address ?? existing.address,
    phone: phone ?? existing.phone,
    gstin: gstin ?? existing.gstin,
    receipt_footer: receipt_footer ?? existing.receipt_footer,
  });
  logActivity(req.user, 'store_updated', `Updated settings for "${store.name}"`, req.storeId);
  res.json({ store });
}));

router.put('/:id', authorize('admin'), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, address, phone, gstin, receipt_footer } = req.body || {};
  const existing = await db.get('stores', id);
  if (!existing) return res.status(404).json({ error: 'Store not found' });
  const store = await db.update('stores', id, {
    name: name ?? existing.name,
    address: address ?? existing.address,
    phone: phone ?? existing.phone,
    gstin: gstin ?? existing.gstin,
    receipt_footer: receipt_footer ?? existing.receipt_footer,
  });
  logActivity(req.user, 'store_updated', `Updated store "${store.name}"`, req.storeId);
  res.json({ store });
}));

module.exports = router;