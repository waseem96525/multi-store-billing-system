const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const { logActivity, prepareLog } = require('../utils/activity');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(authenticate, attachStore);

// List returns for the current store (optional invoice filter)
router.get('/', asyncHandler(async (req, res) => {
  const { invoice_id } = req.query;
  let returns = await db.where('returns', (r) => Number(r.store_id) === Number(req.storeId));
  if (invoice_id) {
    returns = returns.filter((r) => Number(r.invoice_id) === Number(invoice_id));
  }
  returns.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id));

  const [invoices, users, allItems, products] = await Promise.all([
    db.all('invoices'),
    db.all('users'),
    db.all('return_items'),
    db.all('products'),
  ]);
  const invoiceMap = new Map(invoices.map((i) => [i.id, i]));
  const userMap = new Map(users.map((u) => [u.id, u]));
  const productMap = new Map(products.map((p) => [p.id, p]));

  for (const r of returns) {
    r.invoice_no = r.invoice_id && invoiceMap.get(r.invoice_id) ? invoiceMap.get(r.invoice_id).invoice_no : null;
    r.created_by_name = r.created_by && userMap.get(r.created_by) ? userMap.get(r.created_by).name : null;
    r.items = allItems
      .filter((it) => Number(it.return_id) === Number(r.id))
      .map((it) => ({
        ...it,
        product_name: productMap.get(it.product_id) ? productMap.get(it.product_id).name : null,
      }));
  }
  res.json({ returns });
}));

// Detailed return (for the receipt/print view)
router.get('/:id', asyncHandler(async (req, res) => {
  const ret = await db.get('returns', req.params.id);
  if (!ret || Number(ret.store_id) !== Number(req.storeId)) {
    return res.status(404).json({ error: 'Return not found' });
  }
  const [invoice, user, store, allItems, products] = await Promise.all([
    ret.invoice_id ? db.get('invoices', ret.invoice_id) : null,
    ret.created_by ? db.get('users', ret.created_by) : null,
    db.get('stores', ret.store_id),
    db.all('return_items'),
    db.all('products'),
  ]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  ret.invoice_no = invoice ? invoice.invoice_no : null;
  ret.created_by_name = user ? user.name : null;
  ret.store_name = store ? store.name : null;
  ret.address = store ? store.address : null;
  ret.phone = store ? store.phone : null;
  ret.gstin = store ? store.gstin : null;
  ret.items = allItems
    .filter((it) => Number(it.return_id) === Number(ret.id))
    .map((it) => ({
      ...it,
      product_name: productMap.get(it.product_id) ? productMap.get(it.product_id).name : null,
    }));
  res.json({ return: ret });
}));

// Get an invoice's returnable items
router.get('/invoice/:invoiceId/items', asyncHandler(async (req, res) => {
  const invoice = await db.get('invoices', req.params.invoiceId);
  if (!invoice || Number(invoice.store_id) !== Number(req.storeId)) {
    return res.status(404).json({ error: 'Invoice not found' });
  }
  const [allItems, products, allReturns, allReturnItems] = await Promise.all([
    db.all('invoice_items'),
    db.all('products'),
    db.all('returns'),
    db.all('return_items'),
  ]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const items = allItems
    .filter((it) => Number(it.invoice_id) === Number(invoice.id))
    .map((it) => {
      const p = productMap.get(it.product_id);
      return {
        invoice_item_id: it.id,
        product_id: it.product_id,
        product_name: p ? p.name : null,
        sku: p ? p.sku : null,
        sold_qty: it.qty,
        unit_price: it.unit_price,
      };
    });
  const returnIds = new Set(
    allReturns.filter((r) => Number(r.invoice_id) === Number(invoice.id)).map((r) => r.id)
  );
  const returnedMap = new Map();
  for (const ri of allReturnItems) {
    if (!returnIds.has(ri.return_id)) continue;
    returnedMap.set(ri.product_id, (returnedMap.get(ri.product_id) || 0) + ri.qty);
  }
  for (const it of items) {
    it.already_returned = returnedMap.get(it.product_id) || 0;
    it.returnable_qty = Math.max(0, it.sold_qty - it.already_returned);
  }
  res.json({ invoice, items });
}));

router.post('/', authorize('admin', 'inventory'), asyncHandler(async (req, res) => {
  const { invoice_id, reason, items } = req.body || {};
  if (!invoice_id) return res.status(400).json({ error: 'invoice_id required' });
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one item is required' });
  }

  const invoice = await db.get('invoices', invoice_id);
  if (!invoice || Number(invoice.store_id) !== Number(req.storeId)) {
    return res.status(404).json({ error: 'Invoice not found' });
  }

  // Validate requested quantities against sold minus already returned
  const [allInvoiceItems, allReturns, allReturnItems, stockRows] = await Promise.all([
    db.all('invoice_items'),
    db.all('returns'),
    db.all('return_items'),
    db.where('product_stock', (r) => Number(r.store_id) === Number(req.storeId)),
  ]);
  const invoiceItems = allInvoiceItems.filter((it) => Number(it.invoice_id) === Number(invoice.id));
  const soldMap = new Map();
  const unitPriceMap = new Map();
  for (const it of invoiceItems) {
    soldMap.set(it.product_id, (soldMap.get(it.product_id) || 0) + it.qty);
    if (!unitPriceMap.has(it.product_id)) unitPriceMap.set(it.product_id, it.unit_price);
  }
  const returnIds = new Set(
    allReturns.filter((r) => Number(r.invoice_id) === Number(invoice.id)).map((r) => r.id)
  );
  const returnedMap = new Map();
  for (const ri of allReturnItems) {
    if (!returnIds.has(ri.return_id)) continue;
    returnedMap.set(ri.product_id, (returnedMap.get(ri.product_id) || 0) + ri.qty);
  }

  const lineItems = [];
  for (const it of items) {
    const productId = Number(it.product_id);
    const qty = Number(it.qty);
    if (!productId || !qty || qty <= 0) {
      return res.status(400).json({ error: 'Invalid item quantity' });
    }
    const sold = soldMap.get(productId) || 0;
    const returned = returnedMap.get(productId) || 0;
    if (qty > sold - returned) {
      return res.status(400).json({ error: `Cannot return more than ${sold - returned} of this item` });
    }
    lineItems.push({
      product_id: productId,
      qty,
      unit_price: unitPriceMap.get(productId) || 0,
      line_total: qty * (unitPriceMap.get(productId) || 0),
    });
  }

  const totalRefund = lineItems.reduce((sum, l) => sum + l.line_total, 0);
  const [returnId, log] = await Promise.all([
    db.nextId('returns'),
    prepareLog(
      req.user,
      'return',
      `Return #? on ${invoice.invoice_no} · ${lineItems.length} item(s) · refund ₹${totalRefund.toFixed(2)}`,
      req.storeId
    ),
  ]);

  const stockAgg = new Map();
  for (const l of lineItems) stockAgg.set(l.product_id, (stockAgg.get(l.product_id) || 0) + l.qty);
  const stockMap = new Map(stockRows.map((r) => [r.product_id, r]));

  const now = db.now();
  const paths = {};
  paths[`returns/${returnId}`] = {
    id: returnId,
    store_id: req.storeId,
    invoice_id: invoice.id,
    reason: reason || null,
    total_refund: totalRefund,
    created_by: req.user.id,
    created_at: now,
  };
  lineItems.forEach((l, i) => {
    paths[`return_items/${returnId}_${i + 1}`] = {
      id: `${returnId}_${i + 1}`,
      return_id: returnId,
      ...l,
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
  log.value.details = log.value.details.replace('#?', `#${returnId}`);
  paths[log.key] = log.value;
  await db.patchMulti(paths);

  const ret = { id: returnId, store_id: req.storeId, invoice_id: invoice.id, reason: reason || null, total_refund: totalRefund, created_by: req.user.id, created_at: now };
  res.status(201).json({ return: ret });
}));

module.exports = router;