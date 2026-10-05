// Combo (bundle) pricing. A combo is a named set of products sold at a
// single price for the current store. The POS quick-adds the whole bundle
// and applies the price difference as item discounts, so stock, taxes and
// invoicing all keep working exactly like a normal sale.
const express = require('express');
const db = require('../db');
const { authenticate, requirePerm } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const { logActivity } = require('../utils/activity');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(authenticate, attachStore);

function parseCombo(body) {
  const name = String((body && body.name) || '').trim();
  const price = Number(body && body.price);
  if (!name) return { error: 'Combo name required' };
  if (Number.isNaN(price) || price <= 0) return { error: 'Valid combo price required' };
  const raw = Array.isArray(body && body.items) ? body.items : [];
  const byProduct = new Map();
  for (const it of raw) {
    const pid = Number(it && it.product_id);
    const qty = Math.max(1, Math.floor(Number(it && it.qty) || 1));
    if (!Number.isInteger(pid) || pid <= 0) return { error: 'Invalid item in combo' };
    byProduct.set(pid, (byProduct.get(pid) || 0) + qty);
  }
  if (!byProduct.size) return { error: 'At least one item required' };
  const items = [];
  for (const [product_id, qty] of byProduct) items.push({ product_id, qty });
  return {
    name,
    price: Math.round(price * 100) / 100,
    items,
    active: body ? body.active !== false : true,
  };
}

async function withDetails(combo, storeId) {
  const [products, stock] = await Promise.all([db.all('products'), db.all('product_stock')]);
  const pmap = new Map(products.map((p) => [p.id, p]));
  const smap = new Map(stock.map((s) => [`${s.product_id}_${s.store_id}`, s]));
  return {
    ...combo,
    items: (combo.items || []).map((it) => {
      const p = pmap.get(Number(it.product_id));
      const s = smap.get(`${it.product_id}_${storeId}`);
      return {
        product_id: Number(it.product_id),
        qty: Number(it.qty) || 1,
        name: p ? p.name : '(deleted product)',
        unit: p ? p.unit : null,
        selling_price: p ? Number(p.selling_price) || 0 : 0,
        tax_percent: p ? Number(p.tax_percent) || 0 : 0,
        stock_qty: s ? Number(s.stock_qty) || 0 : 0,
        exists: !!p,
      };
    }),
  };
}

router.get('/', requirePerm('inventory.view'), asyncHandler(async (req, res) => {
  const combos = await db.where('combos', (c) => Number(c.store_id) === Number(req.storeId));
  combos.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  res.json({ combos: await Promise.all(combos.map((c) => withDetails(c, req.storeId))) });
}));

router.post('/', requirePerm('inventory.edit'), asyncHandler(async (req, res) => {
  const parsed = parseCombo(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const combo = await db.insert('combos', {
    store_id: req.storeId,
    name: parsed.name,
    price: parsed.price,
    items: parsed.items,
    active: parsed.active,
    created_at: db.now(),
  });
  logActivity(req.user, 'combo_created', `Created combo "${combo.name}" (₹${combo.price})`, req.storeId);
  res.status(201).json({ combo: await withDetails(combo, req.storeId) });
}));

router.put('/:id', requirePerm('inventory.edit'), asyncHandler(async (req, res) => {
  const existing = await db.get('combos', req.params.id);
  if (!existing || Number(existing.store_id) !== Number(req.storeId)) {
    return res.status(404).json({ error: 'Combo not found' });
  }
  const parsed = parseCombo(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const combo = await db.update('combos', req.params.id, {
    name: parsed.name,
    price: parsed.price,
    items: parsed.items,
    active: parsed.active,
  });
  logActivity(req.user, 'combo_updated', `Updated combo "${combo.name}" (₹${combo.price})`, req.storeId);
  res.json({ combo: await withDetails(combo, req.storeId) });
}));

router.delete('/:id', requirePerm('inventory.edit'), asyncHandler(async (req, res) => {
  const existing = await db.get('combos', req.params.id);
  if (!existing || Number(existing.store_id) !== Number(req.storeId)) {
    return res.status(404).json({ error: 'Combo not found' });
  }
  await db.remove('combos', req.params.id);
  logActivity(req.user, 'combo_deleted', `Deleted combo "${existing.name}"`, req.storeId);
  res.json({ success: true });
}));

module.exports = router;
