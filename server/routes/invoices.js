const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const { logActivity } = require('../utils/activity');

const router = express.Router();

router.use(authenticate, attachStore);

// ---- Held bills (park a cart and resume later) ----
router.post('/hold', (req, res) => {
  const { payload, label } = req.body || {};
  if (!payload || !Array.isArray(payload.items)) {
    return res.status(400).json({ error: 'Invalid cart payload' });
  }
  const info = db
    .prepare('INSERT INTO held_bills (payload, label, created_by, store_id) VALUES (?,?,?,?)')
    .run(JSON.stringify(payload), label || null, req.user.id, req.storeId);
  const held = db.prepare('SELECT * FROM held_bills WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ heldBill: { ...held, payload: JSON.parse(held.payload) } });
});

router.get('/held', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM held_bills WHERE store_id = ? ORDER BY id DESC')
    .all(req.storeId);
  res.json({
    heldBills: rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) })),
  });
});

router.post('/retrieve/:id', (req, res) => {
  const held = db
    .prepare('SELECT * FROM held_bills WHERE id = ? AND store_id = ?')
    .get(req.params.id, req.storeId);
  if (!held) return res.status(404).json({ error: 'Held bill not found' });
  res.json({ heldBill: { ...held, payload: JSON.parse(held.payload) } });
});

router.delete('/held/:id', (req, res) => {
  const info = db
    .prepare('DELETE FROM held_bills WHERE id = ? AND store_id = ?')
    .run(req.params.id, req.storeId);
  if (info.changes === 0) return res.status(404).json({ error: 'Held bill not found' });
  res.json({ success: true });
});

router.post('/', (req, res) => {
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

  // Keep the number of remote (Turso) round trips small: all reads go into a
  // few queries, and every write happens inside ONE transaction script.
  // A 5-item bill used to take ~25 sequential round trips (~10s); now ~6.
  const ids = [
    ...new Set(
      items.map((it) => Number(it.product_id)).filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];
  if (ids.length === 0) return res.status(400).json({ error: 'Invalid items' });
  const ph = ids.map(() => '?').join(',');

  // All reads in as few round trips as possible (products + stock in one join)
  let rows, store, last;
  try {
    rows = db
      .prepare(
        `SELECT p.*, ps.stock_qty FROM products p
         LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.store_id = ?
         WHERE p.id IN (${ph})`
      )
      .all(req.storeId, ...ids);
    store = db.prepare('SELECT * FROM stores WHERE id = ?').get(req.storeId);
    last = db.prepare('SELECT invoice_no FROM invoices ORDER BY id DESC LIMIT 1').get();
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const productMap = new Map(rows.map((p) => [p.id, p]));
  const stockMap = new Map(rows.map((p) => [p.id, p.stock_qty]));
  const lastNum = last ? parseInt(String(last.invoice_no).replace(/\D/g, ''), 10) || 0 : 0;
  const invoiceNo = 'INV-' + String(lastNum + 1).padStart(4, '0');

  let subtotal = 0;
  let taxTotal = 0;
  const processed = [];
  for (const it of items) {
    const pid = Number(it.product_id);
    const product = productMap.get(pid);
    if (!product) return res.status(400).json({ error: 'Product not found: ' + pid });
    const qty = Number(it.qty);
    if (!(qty > 0)) return res.status(400).json({ error: 'Invalid quantity for ' + product.name });
    if ((stockMap.get(pid) || 0) < qty) {
      return res.status(400).json({ error: 'Insufficient stock for ' + product.name });
    }
    const unitPrice = Number(it.unit_price ?? product.selling_price);
    const lineDiscount = Number(it.discount ?? 0);
    const lineTaxPct = Number(it.tax_percent ?? product.tax_percent);
    const taxableAmt = unitPrice * qty - lineDiscount;
    const taxAmount = taxableAmt * (lineTaxPct / 100);
    const lineTotal = taxableAmt + taxAmount;
    subtotal += unitPrice * qty;
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
  const grandTotal = subtotal - Number(discount) + taxTotal;
  const cid = customer_id ? Number(customer_id) : null;
  const amtPaid = breakdown ? breakdown.reduce((s, b) => s + b.amount, 0) : Number(amount_paid) || 0;
  const modeLabel = breakdown
    ? breakdown.map((b) => `${b.mode} ₹${b.amount}`).join(' + ')
    : payment_mode;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const esc = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const num = (n) => (Number.isFinite(Number(n)) ? String(Number(n)) : '0');

  // Aggregate stock deductions per product (one row per product in the cart)
  const stockAgg = new Map();
  for (const p of processed) stockAgg.set(p.product_id, (stockAgg.get(p.product_id) || 0) + p.qty);
  const stockUpdate =
    `UPDATE product_stock SET stock_qty = MAX(0, stock_qty - CASE product_id ` +
    [...stockAgg].map(([pid, qty]) => `WHEN ${pid} THEN ${num(qty)}`).join(' ') +
    ` END) WHERE store_id = ${req.storeId} AND product_id IN (${[...stockAgg.keys()].join(',')});`;

  // All items in one INSERT. last_insert_rowid() is NOT usable across UNION
  // ALL rows (it changes as rows are inserted), so the invoice id is fetched
  // in JS first and embedded as a literal.
  const itemsInsert =
    `INSERT INTO invoice_items (invoice_id, product_id, qty, unit_price, discount, tax_percent, tax_amount, line_total, cost_price)
     SELECT ` +
    processed
      .map(
        (p) =>
          `${'?invoiceId?'}, ${p.product_id}, ${num(p.qty)}, ${num(p.unit_price)}, ${num(p.discount)}, ${num(p.tax_percent)}, ${num(p.tax_amount)}, ${num(p.line_total)}, ${num(p.cost_price)}`
      )
      .join(' UNION ALL SELECT ') +
    ';';

  const invoiceInsert =
    `INSERT INTO invoices
       (invoice_no, customer_id, subtotal, discount, tax_total, grand_total, payment_mode, created_by, amount_paid, status, due_date, store_id, created_at, payment_breakdown)
     VALUES (${esc(invoiceNo)}, ${cid === null ? 'NULL' : cid}, ${num(subtotal)}, ${num(discount)}, ${num(taxTotal)}, ${num(grandTotal)}, ${esc(payment_mode)}, ${req.user.id}, ${num(amtPaid)}, ${esc(status)}, ${due_date ? esc(due_date) : 'NULL'}, ${req.storeId}, ${esc(now)}, ${breakdown ? esc(JSON.stringify(breakdown)) : 'NULL'});`;

  // Writes in 3 round trips: BEGIN+invoice, read row id, then stock+items+COMMIT
  let invoiceId;
  try {
    db.exec('BEGIN;\n' + invoiceInsert);
    invoiceId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
    db.exec(
      stockUpdate + '\n' + itemsInsert.replace(/\?invoiceId\?/g, invoiceId) + '\nCOMMIT;'
    );
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (er) { /* ignore */ }
    return res.status(400).json({ error: e.message });
  }

  logActivity(
    req.user,
    'sale',
    `${invoiceNo} · ${processed.length} item(s) · ${modeLabel} · ₹${grandTotal.toFixed(2)}${status === 'credit' ? ' · CREDIT' : ''}`,
    req.storeId
  );

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

  res.status(201).json({
    invoice: {
      invoiceId,
      invoiceNo,
      subtotal,
      discount: Number(discount),
      taxTotal,
      grandTotal,
    },
    // Full receipt inline so the client doesn't need another round trip
    receipt: {
      invoice: {
        invoice_no: invoiceNo,
        created_at: now,
        status,
        subtotal,
        tax_total: taxTotal,
        discount: Number(discount),
        grand_total: grandTotal,
        payment_mode,
        amount_paid: amtPaid,
        payment_breakdown: breakdown,
      },
items: receiptItems,
      cashier: { name: req.user.name },
      store: store || null,
    },
  });
});

router.get('/', (req, res) => {
  const { q } = req.query;
  let sql = `SELECT i.*, u.name AS cashier_name,
             (SELECT COUNT(*) FROM invoice_items ii WHERE ii.invoice_id = i.id) AS item_count
             FROM invoices i
             LEFT JOIN users u ON i.created_by = u.id
             WHERE i.store_id = ?`;
  const params = [req.storeId];
  if (q) {
    sql += ' AND i.invoice_no LIKE ?';
    params.push(`%${q}%`);
  }
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 200);
  sql += ' ORDER BY i.id DESC LIMIT ' + limit;
  res.json({ invoices: db.prepare(sql).all(...params) });
});

router.get('/:id', (req, res) => {
  const invoice = db
    .prepare('SELECT * FROM invoices WHERE id = ? AND store_id = ?')
    .get(req.params.id, req.storeId);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.payment_breakdown) {
    try { invoice.payment_breakdown = JSON.parse(invoice.payment_breakdown); } catch (e) { invoice.payment_breakdown = null; }
  } else {
    invoice.payment_breakdown = null;
  }
  const items = db
    .prepare(
      `SELECT ii.*, p.name AS product_name, p.sku FROM invoice_items ii
       LEFT JOIN products p ON ii.product_id = p.id
       WHERE ii.invoice_id = ? ORDER BY ii.id`
    )
    .all(invoice.id);
  const cashier = db
    .prepare('SELECT name, username FROM users WHERE id = ?')
    .get(invoice.created_by);
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(invoice.store_id);
  res.json({ invoice, items, cashier, store });
});

module.exports = router;
