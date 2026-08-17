const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const { logActivity, prepareLog } = require('../utils/activity');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(authenticate, attachStore);

// Join stock + category onto products, scoped to the current store.
async function rowsForStore(storeId, products) {
  const [stockRows, categories] = await Promise.all([
    db.where('product_stock', (r) => Number(r.store_id) === Number(storeId)),
    db.all('categories'),
  ]);
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));
  const stockMap = new Map(stockRows.map((r) => [db.stockKey(r.product_id, r.store_id), r]));
  return products.map((p) => {
    const s = stockMap.get(db.stockKey(p.id, storeId));
    return {
      ...p,
      category_name: p.category_id && catMap[p.category_id] ? catMap[p.category_id].name : null,
      stock_qty: s ? s.stock_qty : 0,
      reorder_level: s ? s.reorder_level : 0,
    };
  });
}

router.get('/', asyncHandler(async (req, res) => {
  const { q, category_id, low_stock } = req.query;
  let products = await db.all('products');
  if (q) {
    const needle = String(q).toLowerCase();
    products = products.filter(
      (p) =>
        (p.name || '').toLowerCase().includes(needle) ||
        (p.sku || '').toLowerCase().includes(needle) ||
        (p.barcode || '').toLowerCase().includes(needle)
    );
  }
  if (category_id) products = products.filter((p) => Number(p.category_id) === Number(category_id));
  let rows = await rowsForStore(req.storeId, products);
  if (low_stock === '1') {
    rows = rows.filter((p) => p.stock_qty <= p.reorder_level);
  }
  rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  res.json({ products: rows.slice(0, 500) });
}));

// Quick lookup by exact barcode or SKU (used by the POS scanner)
router.get('/barcode/:code', asyncHandler(async (req, res) => {
  const code = String(req.params.code);
  const products = await db.all('products');
  const product = products.find((p) => p.barcode === code || p.sku === code);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const [rows] = await Promise.all([rowsForStore(req.storeId, [product])]);
  res.json({ product: rows[0] });
}));

// Top-selling products for the POS "Quick Add" shelf (last 30 days)
router.get('/frequent', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 12, 50);
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const [invoices, items, products, categories] = await Promise.all([
    db.where('invoices', (i) => Number(i.store_id) === Number(req.storeId)),
    db.all('invoice_items'),
    db.all('products'),
    db.all('categories'),
  ]);
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));
  const productMap = new Map(products.map((p) => [p.id, p]));
  const recent = new Set(
    invoices
      .filter((i) => db.dateOf(i.created_at) >= cutoff)
      .map((i) => i.id)
  );
  const sold = new Map();
  for (const it of items) {
    if (!recent.has(it.invoice_id)) continue;
    const cur = sold.get(it.product_id) || { qty: 0 };
    cur.qty += it.qty;
    sold.set(it.product_id, cur);
  }
  const rows = [];
  for (const [pid, { qty }] of sold) {
    const p = productMap.get(pid);
    if (!p) continue;
    rows.push({ ...p, category_name: p.category_id ? (catMap[p.category_id] || {}).name : null });
    rows[rows.length - 1].sold_qty = qty;
  }
  rows.sort((a, b) => b.sold_qty - a.sold_qty || String(a.name).localeCompare(String(b.name)));
  const top = rows.slice(0, limit);
  const joined = await rowsForStore(req.storeId, top);
  res.json({ products: joined });
}));

router.post('/', authorize('admin', 'inventory'), asyncHandler(async (req, res) => {
  const {
    name,
    sku,
    barcode,
    category_id,
    unit,
    cost_price,
    selling_price,
    tax_percent,
    discount_pct,
    stock_qty,
    reorder_level,
    description,
    brand,
    hsn_code,
    mrp,
    expiry_date,
    location,
  } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });

  const now = db.now();
  const productId = await db.nextId('products');
  const product = {
    id: productId,
    name,
    sku: sku || null,
    barcode: barcode || null,
    category_id: category_id ? Number(category_id) : null,
    unit: unit || 'pcs',
    cost_price: Number(cost_price) || 0,
    selling_price: Number(selling_price) || 0,
    tax_percent: Number(tax_percent) || 0,
    discount_pct: Math.max(0, Number(discount_pct)) || 0,
    description: description || null,
    brand: brand || null,
    hsn_code: hsn_code || null,
    mrp: Number(mrp) || 0,
    expiry_date: expiry_date || null,
    location: location || null,
    created_at: now,
    updated_at: now,
  };

  // Give every store a zero-stock row, set the creating store's stock,
  // and log - all in ONE multi-path write.
  const [stores, log] = await Promise.all([
    db.all('stores'),
    prepareLog(req.user, 'product_created', `Created "${name}" (sku ${sku || '-'})`, req.storeId),
  ]);
  const paths = { [`products/${productId}`]: product };
  for (const s of stores) {
    paths[`product_stock/${db.stockKey(productId, s.id)}`] = {
      product_id: productId,
      store_id: s.id,
      stock_qty: 0,
      reorder_level: 0,
    };
  }
  paths[`product_stock/${db.stockKey(productId, req.storeId)}`] = {
    product_id: productId,
    store_id: req.storeId,
    stock_qty: Number(stock_qty) || 0,
    reorder_level: Number(reorder_level) || 0,
  };
  paths[log.key] = log.value;
  await db.patchMulti(paths);

  const [rows] = await Promise.all([rowsForStore(req.storeId, [product])]);
  res.status(201).json({ product: rows[0] });
}));

router.put('/:id', authorize('admin', 'inventory'), asyncHandler(async (req, res) => {
  const id = req.params.id;
  const existing = await db.get('products', id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  const {
    name,
    sku,
    barcode,
    category_id,
    unit,
    cost_price,
    selling_price,
    tax_percent,
    discount_pct,
    stock_qty,
    reorder_level,
    description,
    brand,
    hsn_code,
    mrp,
    expiry_date,
    location,
  } = req.body || {};

  const curStock = await db.get('product_stock', db.stockKey(id, req.storeId));
  const patch = {
    name: name ?? existing.name,
    sku: sku !== undefined ? sku : existing.sku,
    barcode: barcode !== undefined ? barcode : existing.barcode,
    category_id: category_id !== undefined ? Number(category_id) : existing.category_id,
    unit: unit ?? existing.unit,
    cost_price: cost_price !== undefined ? Number(cost_price) : existing.cost_price,
    selling_price: selling_price !== undefined ? Number(selling_price) : existing.selling_price,
    tax_percent: tax_percent !== undefined ? Number(tax_percent) : existing.tax_percent,
    discount_pct:
      discount_pct !== undefined ? Math.max(0, Number(discount_pct)) : existing.discount_pct,
    description: description !== undefined ? description : existing.description,
    brand: brand !== undefined ? brand : existing.brand,
    hsn_code: hsn_code !== undefined ? hsn_code : existing.hsn_code,
    mrp: mrp !== undefined ? Number(mrp) : existing.mrp,
    expiry_date: expiry_date !== undefined ? expiry_date : existing.expiry_date,
    location: location !== undefined ? location : existing.location,
    updated_at: db.now(),
  };
  const stockPatch = {
    product_id: Number(id),
    store_id: req.storeId,
    stock_qty: stock_qty !== undefined ? Number(stock_qty) : (curStock ? curStock.stock_qty : 0),
    reorder_level:
      reorder_level !== undefined ? Number(reorder_level) : (curStock ? curStock.reorder_level : 0),
  };
  await db.patchMulti({
    [`products/${id}`]: patch,
    [`product_stock/${db.stockKey(id, req.storeId)}`]: stockPatch,
  });
  logActivity(req.user, 'product_updated', `Updated "${patch.name}"`, req.storeId);
  const [rows] = await Promise.all([rowsForStore(req.storeId, [{ ...existing, ...patch }])]);
  res.json({ product: rows[0] });
}));

router.delete('/:id', authorize('admin', 'inventory'), asyncHandler(async (req, res) => {
  const product = await db.get('products', req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const stockRows = await db.where('product_stock', (r) => Number(r.product_id) === Number(req.params.id));
  const paths = { [`products/${req.params.id}`]: null };
  for (const r of stockRows) paths[`product_stock/${db.stockKey(r.product_id, r.store_id)}`] = null;
  await db.patchMulti(paths);
  logActivity(req.user, 'product_deleted', `Deleted "${product.name}"`, req.storeId);
  res.json({ success: true });
}));

router.get('/categories/all', asyncHandler(async (req, res) => {
  const categories = await db.all('categories');
  res.json({ categories });
}));

router.post('/categories', authorize('admin', 'inventory'), asyncHandler(async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const existing = await db.where('categories', (c) => c.name.toLowerCase() === name.toLowerCase());
  if (existing.length) return res.status(409).json({ error: 'Category already exists' });
  const category = await db.insert('categories', { name });
  logActivity(req.user, 'category_created', `Created category "${name}"`, req.storeId);
  res.status(201).json({ category });
}));

router.put('/categories/:id', authorize('admin', 'inventory'), asyncHandler(async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const existing = await db.get('categories', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Category not found' });
  const updated = await db.update('categories', req.params.id, { name });
  logActivity(req.user, 'category_updated', `Renamed category "${existing.name}" to "${name}"`, req.storeId);
  res.json({ category: updated });
}));

router.delete('/categories/:id', authorize('admin', 'inventory'), asyncHandler(async (req, res) => {
  const existing = await db.get('categories', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Category not found' });
  const products = await db.where('products', (p) => Number(p.category_id) === Number(req.params.id));
  const paths = { [`categories/${req.params.id}`]: null };
  for (const p of products) paths[`products/${p.id}/category_id`] = null;
  await db.patchMulti(paths);
  logActivity(req.user, 'category_deleted', `Deleted category "${existing.name}"`, req.storeId);
  res.json({ success: true });
}));

module.exports = router;
