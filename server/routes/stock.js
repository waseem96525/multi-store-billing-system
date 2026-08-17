const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const { logActivity, prepareLog } = require('../utils/activity');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(authenticate, attachStore);

// Record a manual stock adjustment (correction, damage, return, etc.)
router.post('/adjust', authorize('admin', 'inventory'), asyncHandler(async (req, res) => {
  const { product_id, change_qty, reason } = req.body || {};
  if (!product_id) return res.status(400).json({ error: 'product_id required' });
  const change = Number(change_qty);
  if (!change) return res.status(400).json({ error: 'change_qty must be non-zero' });
  const product = await db.get('products', product_id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const cur = await db.get('product_stock', db.stockKey(product_id, req.storeId));
  const curQty = cur ? cur.stock_qty : 0;
  const newQty = Math.max(0, curQty + change);
  const actualChange = newQty - curQty;

  const [adjId, log] = await Promise.all([
    db.nextId('stock_adjustments'),
    prepareLog(
      req.user,
      'stock_adjustment',
      `"${product.name}" ${actualChange > 0 ? '+' : ''}${actualChange} ${product.unit || 'pcs'}${reason ? ` (${reason})` : ''} → ${newQty}`,
      req.storeId
    ),
  ]);
  await db.patchMulti({
    [`product_stock/${db.stockKey(product_id, req.storeId)}`]: {
      product_id: Number(product_id),
      store_id: req.storeId,
      stock_qty: newQty,
      reorder_level: cur ? cur.reorder_level : 0,
    },
    [`stock_adjustments/${adjId}`]: {
      id: adjId,
      product_id: Number(product_id),
      change_qty: actualChange,
      reason: reason || null,
      adjusted_by: req.user.id,
      store_id: req.storeId,
      created_at: db.now(),
    },
    [log.key]: log.value,
  });
  res.status(201).json({ product: { ...product, stock_qty: newQty } });
}));

// Audit trail of stock adjustments (optionally filtered by product)
router.get('/', asyncHandler(async (req, res) => {
  const { product_id } = req.query;
  let adjustments = await db.where(
    'stock_adjustments',
    (a) => Number(a.store_id) === Number(req.storeId)
  );
  if (product_id) {
    adjustments = adjustments.filter((a) => Number(a.product_id) === Number(product_id));
  }
  adjustments.sort((a, b) => b.id - a.id);
  adjustments = adjustments.slice(0, 300);

  const [products, users] = await Promise.all([db.all('products'), db.all('users')]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const userMap = new Map(users.map((u) => [u.id, u]));
  res.json({
    adjustments: adjustments.map((a) => ({
      ...a,
      product_name: productMap.get(a.product_id) ? productMap.get(a.product_id).name : null,
      adjusted_by_name: userMap.get(a.adjusted_by) ? userMap.get(a.adjusted_by).name : null,
    })),
  });
}));

module.exports = router;