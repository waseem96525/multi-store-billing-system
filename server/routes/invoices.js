const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const { logActivity, prepareLog } = require('../utils/activity');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(authenticate, attachStore);

// ---- Held bills (park a cart and resume later) ----
router.post('/hold', asyncHandler(async (req, res) => {
  const { payload, label } = req.body || {};
  if (!payload || !Array.isArray(payload.items)) {
    return res.status(400).json({ error: 'Invalid cart payload' });
  }
  const held = await db.insert('held_bills', {
    payload: JSON.stringify(payload),
    label: label || null,
    created_by: req.user.id,
    store_id: req.storeId,
    created_at: db.now(),
  });
  res.status(201).json({ heldBill: { ...held, payload: JSON.parse(held.payload) } });
}));

router.get('/held', asyncHandler(async (req, res) => {
  const rows = await db.where('held_bills', (h) => Number(h.store_id) === Number(req.storeId));
  rows.sort((a, b) => b.id - a.id);
  res.json({ heldBills: rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) })) });
}));

router.post('/retrieve/:id', asyncHandler(async (req, res) => {
  const held = await db.get('held_bills', req.params.id);
  if (!held || Number(held.store_id) !== Number(req.storeId)) {
    return res.status(404).json({ error: 'Held bill not found' });
  }
  res.json({ heldBill: { ...held, payload: JSON.parse(held.payload) } });
}));

router.delete('/held/:id', asyncHandler(async (req, res) => {
  const held = await db.get('held_bills', req.params.id);
  if (!held || Number(held.store_id) !== Number(req.storeId)) {
    return res.status(404).json({ error: 'Held bill not found' });
  }
  await db.remove('held_bills', req.params.id);
  res.json({ success: true });
}));

router.post('/', asyncHandler(async (req, res) => {
  const {
    items,
    discount = 0,
    payment_mode = 'cash',
    customer_id = null,
    amount_paid = 0,
    status = 'paid',
    due_date = null,
    payment_breakdown = null,
  } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items required' });
  }
  if (!['cash', 'card', 'upi', 'mixed'].includes(payment_mode)) {
    return res.status(400).json({ error: 'Invalid payment mode' });
  }
  if (!['paid', 'credit'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  if (due_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(due_date))) {
    return res.status(400).json({ error: 'Invalid due date' });
  }

  // Split payments: e.g. [{ mode: 'cash', amount: 500 }, { mode: 'upi', amount: 250 }]
  let breakdown = null;
  if (payment_breakdown) {
    if (!Array.isArray(payment_breakdown)) {
      return res.status(400).json({ error: 'Invalid payment breakdown' });
    }
    breakdown = [];
    for (const b of payment_breakdown) {
      const mode = String(b.mode || '').toLowerCase();
      const amt = Number(b.amount);
      if (!['cash', 'card', 'upi'].includes(mode) || !(amt > 0)) {
        return res.status(400).json({ error: 'Invalid payment breakdown' });
      }
      breakdown.push({ mode, amount: amt });
    }
    if (breakdown.length === 0) breakdown = null;
  }

  const ids = [
    ...new Set(items.map((it) => Number(it.product_id)).filter((id) => Number.isInteger(id) && id > 0)),
  ];
  if (ids.length === 0) return res.status(400).json({ error: 'Invalid items' });

  // All reads in 3 parallel round trips
  const [allProducts, stockRows, store] = await Promise.all([
    db.all('products'),
    db.where('product_stock', (r) => Number(r.store_id) === Number(req.storeId)),
    db.get('stores', req.storeId),
  ]);
  const productMap = new Map(allProducts.filter((p) => ids.includes(p.id)).map((p) => [p.id, p]));
  const stockMap = new Map(stockRows.map((r) => [Number(r.product_id), r.stock_qty]));
  for (const pid of ids) {
    if (!productMap.has(pid)) return res.status(400).json({ error: 'Product not found: ' + pid });
  }

  const invoiceNo = 'INV-' + String((await db.nextId('invoice_no'))).padStart(4, '0');

  let subtotal = 0;
  let taxTotal = 0;
  let itemDiscTotal = 0;
  const processed = [];
  for (const it of items) {
    const pid = Number(it.product_id);
    const product = productMap.get(pid);
    const qty = Number(it.qty);
    if (!(qty > 0)) return res.status(400).json({ error: 'Invalid quantity for ' + product.name });
    if ((stockMap.get(pid) || 0) < qty) {
      return res.status(400).json({ error: 'Insufficient stock for ' + product.name });
    }
    const unitPrice = Number(it.unit_price ?? product.selling_price);
    const lineDiscount = Math.min(Number(it.discount ?? 0), unitPrice * qty);
    const lineTaxPct = Number(it.tax_percent ?? product.tax_percent);
    const taxableAmt = unitPrice * qty - lineDiscount;
    const taxAmount = taxableAmt * (lineTaxPct / 100);
    const lineTotal = taxableAmt + taxAmount;
    subtotal += unitPrice * qty;
    itemDiscTotal += lineDiscount;
    taxTotal += taxAmount;
    processed.push({
      product_id: pid,
      qty,
      unit_price: unitPrice,
      discount: lineDiscount,
      tax_percent: lineTaxPct,
      tax_amount: taxAmount,
      line_total: lineTotal,
      cost_price: product.cost_price || 0,
    });
  }
  const grandTotal =
    Math.round((subtotal - itemDiscTotal - Number(discount) + taxTotal) * 100) / 100;
  const cid = customer_id ? Number(customer_id) : null;
  const amtPaid = breakdown ? breakdown.reduce((s, b) => s + b.amount, 0) : Number(amount_paid) || 0;
  const modeLabel = breakdown
    ? breakdown.map((b) => `${b.mode} ₹${b.amount}`).join(' + ')
    : payment_mode;
  const now = db.now();

  // Reserve ids and build ONE multi-path write: invoice, items, stock
  // deductions, invoice-number counter and activity log.
  const [invoiceId, log] = await Promise.all([
    db.nextId('invoices'),
    prepareLog(
      req.user,
      'sale',
      `${invoiceNo} · ${processed.length} item(s) · ${modeLabel} · ₹${grandTotal.toFixed(2)}${status === 'credit' ? ' · CREDIT' : ''}`,
      req.storeId
    ),
  ]);

  const stockAgg = new Map();
  for (const p of processed) stockAgg.set(p.product_id, (stockAgg.get(p.product_id) || 0) + p.qty);

  const paths = {};
  paths[`invoices/${invoiceId}`] = {
    id: invoiceId,
    invoice_no: invoiceNo,
    customer_id: cid,
    subtotal,
    discount: Number(discount),
    item_discount: itemDiscTotal,
    tax_total: taxTotal,
    grand_total: grandTotal,
    payment_mode,
    created_by: req.user.id,
    amount_paid: amtPaid,
    status,
    due_date: due_date || null,
    store_id: req.storeId,
    created_at: now,
    payment_breakdown: breakdown ? JSON.stringify(breakdown) : null,
  };
  processed.forEach((p, i) => {
    paths[`invoice_items/${invoiceId}_${i + 1}`] = { id: `${invoiceId}_${i + 1}`, invoice_id: invoiceId, ...p };
  });
  for (const [pid, qty] of stockAgg) {
    const cur = stockMap.get(pid) || 0;
    paths[`product_stock/${db.stockKey(pid, req.storeId)}`] = {
      product_id: pid,
      store_id: req.storeId,
      stock_qty: Math.max(0, cur - qty),
      reorder_level: 0,
    };
  }
  paths[log.key] = log.value;
  await db.patchMulti(paths);

  const receiptItems = processed.map((p) => {
    const product = productMap.get(p.product_id);
    return {
      product_name: product ? product.name : 'Item',
      qty: p.qty,
      unit_price: p.unit_price,
      discount: p.discount,
      line_total: p.line_total,
    };
  });

  let customer = null;
  if (cid) {
    const c = await db.get('customers', cid);
    if (c) customer = { id: c.id, name: c.name, phone: c.phone, email: c.email };
  }

  res.status(201).json({
    invoice: {
      invoiceId,
      invoiceNo,
      subtotal,
      discount: Number(discount),
      itemDiscount: itemDiscTotal,
      taxTotal,
      grandTotal,
    },
    receipt: {
      invoice: {
        invoice_no: invoiceNo,
        created_at: now,
        status,
        subtotal,
        tax_total: taxTotal,
        discount: Number(discount),
        item_discount: itemDiscTotal,
        grand_total: grandTotal,
        payment_mode,
        amount_paid: amtPaid,
        payment_breakdown: breakdown,
      },
      items: receiptItems,
      cashier: { name: req.user.name },
      customer,
      store: store || null,
    },
  });
}));

router.get('/', asyncHandler(async (req, res) => {
  const { q } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 200);
  let invoices = await db.where('invoices', (i) => Number(i.store_id) === Number(req.storeId));
  if (q) invoices = invoices.filter((i) => (i.invoice_no || '').includes(String(q)));
  invoices.sort((a, b) => b.id - a.id);
  invoices = invoices.slice(0, limit);
  const [users, items] = await Promise.all([db.all('users'), db.all('invoice_items')]);
  const userMap = new Map(users.map((u) => [u.id, u]));
  const countMap = new Map();
  for (const it of items) countMap.set(it.invoice_id, (countMap.get(it.invoice_id) || 0) + 1);
  res.json({
    invoices: invoices.map((i) => ({
      ...i,
      cashier_name: i.created_by && userMap.get(i.created_by) ? userMap.get(i.created_by).name : null,
      item_count: countMap.get(i.id) || 0,
    })),
  });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const invoice = await db.get('invoices', req.params.id);
  if (!invoice || Number(invoice.store_id) !== Number(req.storeId)) {
    return res.status(404).json({ error: 'Invoice not found' });
  }
  if (invoice.payment_breakdown) {
    try { invoice.payment_breakdown = JSON.parse(invoice.payment_breakdown); } catch (e) { invoice.payment_breakdown = null; }
  } else {
    invoice.payment_breakdown = null;
  }
  const [allItems, products, cashier, store] = await Promise.all([
    db.all('invoice_items'),
    db.all('products'),
    invoice.created_by ? db.get('users', invoice.created_by) : null,
    db.get('stores', invoice.store_id),
  ]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const items = allItems
    .filter((it) => Number(it.invoice_id) === Number(invoice.id))
    .map((it) => ({
      ...it,
      product_name: productMap.get(it.product_id) ? productMap.get(it.product_id).name : null,
      sku: productMap.get(it.product_id) ? productMap.get(it.product_id).sku : null,
    }));
  let customer = null;
  if (invoice.customer_id) {
    const c = await db.get('customers', invoice.customer_id);
    if (c) customer = { id: c.id, name: c.name, phone: c.phone, email: c.email };
  }
  res.json({
    invoice,
    items,
    cashier: cashier ? { name: cashier.name, username: cashier.username } : null,
    customer,
    store,
  });
}));

module.exports = router;