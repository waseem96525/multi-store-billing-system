const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const { logActivity, prepareLog } = require('../utils/activity');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(authenticate, attachStore);

// Auto-reorder suggestions: products below/at their reorder level for this store,
// with a suggested order quantity and estimated cost.
router.get('/suggestions', asyncHandler(async (req, res) => {
  const [products, stockRows, categories] = await Promise.all([
    db.all('products'),
    db.where('product_stock', (r) => Number(r.store_id) === Number(req.storeId)),
    db.all('categories'),
  ]);
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));
  const stockMap = new Map(stockRows.map((r) => [Number(r.product_id), r]));
  const rows = [];
  for (const p of products) {
    const s = stockMap.get(p.id);
    if (!s || s.stock_qty > s.reorder_level) continue;
    rows.push({
      ...p,
      stock_qty: s.stock_qty,
      reorder_level: s.reorder_level,
      category_name: p.category_id && catMap[p.category_id] ? catMap[p.category_id].name : null,
    });
  }
  rows.sort(
    (a, b) =>
      a.stock_qty - a.reorder_level - (b.stock_qty - b.reorder_level) ||
      String(a.name).localeCompare(String(b.name))
  );
  const suggestions = rows.map((p) => {
    const suggested_qty = Math.max(1, Math.ceil(p.reorder_level * 2 - p.stock_qty));
    return {
      ...p,
      suggested_qty,
      est_cost: Number((p.cost_price || 0) * suggested_qty).toFixed(2),
    };
  });
  const total_est_cost = suggestions.reduce((sum, s) => sum + Number(s.est_cost), 0);
  res.json({ suggestions, count: suggestions.length, total_est_cost });
}));

router.post('/', authorize('admin', 'inventory'), asyncHandler(async (req, res) => {
  const { supplier_id, invoice_ref, items } = req.body || {};
  if (!supplier_id) return res.status(400).json({ error: 'supplier_id required' });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items required' });
  }

  const ids = [
    ...new Set(items.map((it) => Number(it.product_id)).filter((id) => Number.isInteger(id) && id > 0)),
  ];
  if (ids.length === 0) return res.status(400).json({ error: 'Invalid items' });

  const [allProducts, supplier, stockRows] = await Promise.all([
    db.all('products'),
    db.get('suppliers', Number(supplier_id)),
    db.where('product_stock', (r) => Number(r.store_id) === Number(req.storeId)),
  ]);
  if (!supplier) return res.status(400).json({ error: 'Supplier not found' });
  const productMap = new Map(allProducts.filter((p) => ids.includes(p.id)).map((p) => [p.id, p]));
  const stockMap = new Map(stockRows.map((r) => [Number(r.product_id), r]));
  for (const pid of ids) {
    if (!productMap.has(pid)) return res.status(400).json({ error: 'Product not found: ' + pid });
  }

  let total = 0;
  const processed = [];
  for (const it of items) {
    const pid = Number(it.product_id);
    const product = productMap.get(pid);
    const qty = Number(it.qty);
    if (!(qty > 0)) return res.status(400).json({ error: 'Invalid quantity for ' + product.name });
    const cost = Number(it.cost_price ?? product.cost_price);
    total += cost * qty;
    processed.push({ product_id: pid, qty, cost_price: cost });
  }

  const [purchaseId, log] = await Promise.all([
    db.nextId('purchases'),
    prepareLog(req.user, 'purchase', `Purchase #? · ${processed.length} item(s) · ₹${total.toFixed(2)}`, req.storeId),
  ]);

  const stockAgg = new Map();
  for (const p of processed) stockAgg.set(p.product_id, (stockAgg.get(p.product_id) || 0) + p.qty);

  const now = db.now();
  const paths = {};
  paths[`purchases/${purchaseId}`] = {
    id: purchaseId,
    supplier_id: Number(supplier_id),
    invoice_ref: invoice_ref || null,
    total_amount: total,
    created_by: req.user.id,
    store_id: req.storeId,
    created_at: now,
  };
  processed.forEach((p, i) => {
    paths[`purchase_items/${purchaseId}_${i + 1}`] = {
      id: `${purchaseId}_${i + 1}`,
      purchase_id: purchaseId,
      ...p,
    };
  });
  for (const [pid, qty] of stockAgg) {
    const cur = stockMap.get(pid);
    paths[`product_stock/${db.stockKey(pid, req.storeId)}`] = {
      product_id: pid,
      store_id: req.storeId,
      stock_qty: (cur ? cur.stock_qty : 0) + qty,
      reorder_level: cur ? cur.reorder_level : 0,
    };
  }
  paths[`suppliers/${Number(supplier_id)}/outstanding_balance`] =
    (supplier.outstanding_balance || 0) + total;
  log.value.details = log.value.details.replace('#?', `#${purchaseId}`);
  paths[log.key] = log.value;
  await db.patchMulti(paths);

  res.status(201).json({
    purchase: { id: purchaseId, supplier_id, invoice_ref, total_amount: total },
  });
}));

router.get('/', asyncHandler(async (req, res) => {
  const [purchases, suppliers] = await Promise.all([
    db.where('purchases', (p) => Number(p.store_id) === Number(req.storeId)),
    db.all('suppliers'),
  ]);
  const supplierMap = new Map(suppliers.map((s) => [s.id, s]));
  purchases.sort((a, b) => b.id - a.id);
  res.json({
    purchases: purchases.slice(0, 200).map((p) => ({
      ...p,
      supplier_name: supplierMap.get(p.supplier_id) ? supplierMap.get(p.supplier_id).name : null,
    })),
  });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const purchase = await db.get('purchases', req.params.id);
  if (!purchase || Number(purchase.store_id) !== Number(req.storeId)) {
    return res.status(404).json({ error: 'Purchase not found' });
  }
  const [supplier, allItems, products] = await Promise.all([
    db.get('suppliers', purchase.supplier_id),
    db.all('purchase_items'),
    db.all('products'),
  ]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const items = allItems
    .filter((it) => Number(it.purchase_id) === Number(purchase.id))
    .map((it) => ({
      ...it,
      product_name: productMap.get(it.product_id) ? productMap.get(it.product_id).name : null,
    }));
  res.json({ purchase: { ...purchase, supplier_name: supplier ? supplier.name : null }, items });
}));

module.exports = router;