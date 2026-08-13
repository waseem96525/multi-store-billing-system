const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const { logActivity } = require('../utils/activity');

const router = express.Router();

router.use(authenticate, attachStore);

function nextInvoiceNo() {
  const last = db.prepare('SELECT invoice_no FROM invoices ORDER BY id DESC LIMIT 1').get();
  if (!last) return 'INV-0001';
  const num = parseInt(String(last.invoice_no).replace(/\D/g, ''), 10) || 0;
  return 'INV-' + String(num + 1).padStart(4, '0');
}

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
  } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items required' });
  }

  db.exec('BEGIN');
  try {
    // NOTE: prepare statements after BEGIN - required for remote (Hrana/Turso) transactions
    const getStock = db.prepare(
      'SELECT stock_qty FROM product_stock WHERE product_id = ? AND store_id = ?'
    );
    const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
    const updateStock = db.prepare(
      'UPDATE product_stock SET stock_qty = stock_qty - ? WHERE product_id = ? AND store_id = ?'
    );
    const insertInvoice = db.prepare(
      `INSERT INTO invoices
       (invoice_no, customer_id, subtotal, discount, tax_total, grand_total, payment_mode, created_by, amount_paid, status, due_date, store_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    const insertItem = db.prepare(
      `INSERT INTO invoice_items
       (invoice_id, product_id, qty, unit_price, discount, tax_percent, tax_amount, line_total, cost_price)
       VALUES (?,?,?,?,?,?,?,?,?)`
    );

    let subtotal = 0;
    let taxTotal = 0;
    const processed = [];
    for (const it of items) {
      const product = getProduct.get(it.product_id);
      if (!product) throw new Error('Product not found: ' + it.product_id);
      const qty = Number(it.qty);
      if (!(qty > 0)) throw new Error('Invalid quantity for ' + product.name);
      const stockRow = getStock.get(it.product_id, req.storeId);
      const available = stockRow ? stockRow.stock_qty : 0;
      if (available < qty) {
        throw new Error('Insufficient stock for ' + product.name);
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
        product_id: product.id,
        qty,
        unit_price: unitPrice,
        discount: lineDiscount,
        tax_percent: lineTaxPct,
        tax_amount: taxAmount,
        line_total: lineTotal,
        cost_price: product.cost_price || 0,
      });
      updateStock.run(qty, product.id, req.storeId);
    }
    const grandTotal = subtotal - Number(discount) + taxTotal;
    const invoiceNo = nextInvoiceNo();
    const info = insertInvoice.run(
      invoiceNo,
      customer_id,
      subtotal,
      Number(discount),
      taxTotal,
      grandTotal,
      payment_mode,
      req.user.id,
      Number(amount_paid) || 0,
      status,
      due_date,
      req.storeId
    );
    const invoiceId = info.lastInsertRowid;
    for (const p of processed) {
      insertItem.run(
        invoiceId,
        p.product_id,
        p.qty,
        p.unit_price,
        p.discount,
        p.tax_percent,
        p.tax_amount,
        p.line_total,
        p.cost_price
      );
    }
    db.exec('COMMIT');
    logActivity(
      req.user,
      'sale',
      `${invoiceNo} · ${processed.length} item(s) · ${payment_mode} · ₹${grandTotal.toFixed(2)}${status === 'credit' ? ' · CREDIT' : ''}`,
      req.storeId
    );
    res
      .status(201)
      .json({
        invoice: {
          invoiceId,
          invoiceNo,
          subtotal,
          discount: Number(discount),
          taxTotal,
          grandTotal,
        },
      });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: e.message });
  }
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
  sql += ' ORDER BY i.id DESC LIMIT 200';
  res.json({ invoices: db.prepare(sql).all(...params) });
});

router.get('/:id', (req, res) => {
  const invoice = db
    .prepare('SELECT * FROM invoices WHERE id = ? AND store_id = ?')
    .get(req.params.id, req.storeId);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const items = db
    .prepare(
      `SELECT ii.*, p.name AS product_name, p.sku FROM invoice_items ii
       LEFT JOIN products p ON ii.product_id = p.id
       WHERE ii.invoice_id = ?`
    )
    .all(invoice.id);
  const cashier = db
    .prepare('SELECT name, username FROM users WHERE id = ?')
    .get(invoice.created_by);
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(invoice.store_id);
  res.json({ invoice, items, cashier, store });
});

module.exports = router;
