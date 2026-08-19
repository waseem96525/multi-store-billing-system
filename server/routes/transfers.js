const express = require('express');
const db = require('../db');
const { authenticate, requirePerm } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const { logActivity, prepareLog } = require('../utils/activity');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(authenticate, attachStore);

// List transfers (outgoing from this store, plus incoming to it)
router.get('/', asyncHandler(async (req, res) => {
  const [transfers, stores, users, allItems, products] = await Promise.all([
    db.all('stock_transfers'),
    db.all('stores'),
    db.all('users'),
    db.all('stock_transfer_items'),
    db.all('products'),
  ]);
  const storeMap = new Map(stores.map((s) => [s.id, s]));
  const userMap = new Map(users.map((u) => [u.id, u]));
  const productMap = new Map(products.map((p) => [p.id, p]));
  const rows = transfers
    .filter(
      (t) => Number(t.from_store_id) === Number(req.storeId) || Number(t.to_store_id) === Number(req.storeId)
    )
    .map((t) => {
      const items = allItems
        .filter((it) => Number(it.transfer_id) === Number(t.id))
        .map((it) => ({
          ...it,
          product_name: productMap.get(it.product_id) ? productMap.get(it.product_id).name : null,
          sku: productMap.get(it.product_id) ? productMap.get(it.product_id).sku : null,
        }));
      return {
        ...t,
        from_store_name: storeMap.get(t.from_store_id) ? storeMap.get(t.from_store_id).name : null,
        to_store_name: storeMap.get(t.to_store_id) ? storeMap.get(t.to_store_id).name : null,
        created_by_name: t.created_by && userMap.get(t.created_by) ? userMap.get(t.created_by).name : null,
        item_count: items.length,
        items,
      };
    });
  rows.sort((a, b) => b.id - a.id);
  res.json({ transfers: rows.slice(0, 200) });
}));

// Create a transfer from the current store to another store
router.post('/', requirePerm('transfers.create'), asyncHandler(async (req, res) => {
  const { to_store_id, note, items } = req.body || {};
  if (!to_store_id) return res.status(400).json({ error: 'to_store_id required' });
  if (Number(to_store_id) === Number(req.storeId)) {
    return res.status(400).json({ error: 'Destination store must be different' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items required' });
  }
  const store = await db.get('stores', Number(to_store_id));
  if (!store) return res.status(404).json({ error: 'Destination store not found' });

  const ids = [
    ...new Set(items.map((it) => Number(it.product_id)).filter((id) => Number.isInteger(id) && id > 0)),
  ];
  if (ids.length === 0) return res.status(400).json({ error: 'Invalid items' });

  const [allProducts, outStock, inStock] = await Promise.all([
    db.all('products'),
    db.where('product_stock', (r) => Number(r.store_id) === Number(req.storeId)),
    db.where('product_stock', (r) => Number(r.store_id) === Number(to_store_id)),
  ]);
  const productMap = new Map(allProducts.filter((p) => ids.includes(p.id)).map((p) => [p.id, p]));
  const outStockMap = new Map(outStock.map((r) => [Number(r.product_id), r]));
  const inStockMap = new Map(inStock.map((r) => [Number(r.product_id), r]));
  for (const pid of ids) {
    if (!productMap.has(pid)) return res.status(400).json({ error: 'Product not found: ' + pid });
  }

  const processed = [];
  for (const it of items) {
    const pid = Number(it.product_id);
    const product = productMap.get(pid);
    const qty = Number(it.qty);
    if (!(qty > 0)) return res.status(400).json({ error: 'Invalid quantity for ' + product.name });
    const available = outStockMap.get(pid) ? outStockMap.get(pid).stock_qty : 0;
    if (available < qty) {
      return res.status(400).json({ error: `Insufficient stock for ${product.name} (${available} available)` });
    }
    processed.push({ product_id: pid, qty });
  }

  const [transferId, log] = await Promise.all([
    db.nextId('stock_transfers'),
    prepareLog(
      req.user,
      'transfer',
      `Transfer #? · ${processed.length} item(s) · store ${req.storeId} → ${to_store_id}`,
      req.storeId
    ),
  ]);

  const outAgg = new Map();
  for (const p of processed) outAgg.set(p.product_id, (outAgg.get(p.product_id) || 0) + p.qty);

  const paths = {};
  paths[`stock_transfers/${transferId}`] = {
    id: transferId,
    from_store_id: req.storeId,
    to_store_id: Number(to_store_id),
    note: note || null,
    created_by: req.user.id,
    created_at: db.now(),
  };
  processed.forEach((p, i) => {
    paths[`stock_transfer_items/${transferId}_${i + 1}`] = {
      id: `${transferId}_${i + 1}`,
      transfer_id: transferId,
      ...p,
    };
  });
  for (const [pid, qty] of outAgg) {
    const curOut = outStockMap.get(pid);
    const curIn = inStockMap.get(pid);
    paths[`product_stock/${db.stockKey(pid, req.storeId)}`] = {
      product_id: pid,
      store_id: req.storeId,
      stock_qty: Math.max(0, (curOut ? curOut.stock_qty : 0) - qty),
      reorder_level: curOut ? curOut.reorder_level : 0,
    };
    paths[`product_stock/${db.stockKey(pid, Number(to_store_id))}`] = {
      product_id: pid,
      store_id: Number(to_store_id),
      stock_qty: (curIn ? curIn.stock_qty : 0) + qty,
      reorder_level: curIn ? curIn.reorder_level : 0,
    };
  }
  log.value.details = log.value.details.replace('#?', `#${transferId}`);
  paths[log.key] = log.value;
  await db.patchMulti(paths);

  res.status(201).json({ transfer: { id: transferId, to_store_id, note, item_count: processed.length } });
}));

module.exports = router;