const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

function nextInvoiceNo() {
  const last = db.prepare('SELECT invoice_no FROM invoices ORDER BY id DESC LIMIT 1').get();
  if (!last) return 'INV-0001';
  const num = parseInt(String(last.invoice_no).replace(/\D/g, ''), 10) || 0;
  return 'INV-' + String(num + 1).padStart(4, '0');
}

// ---- Held bills (park a cart and resume later) ----
router.post('/hold', authenticate, (req, res) => {
  const { payload, label } = req.body || {};
  if (!payload || !Array.isArray(payload.items)) {
    return res.status(400).json({ error: 'Invalid cart payload' });
  }
  const info = db
    .prepare('INSERT INTO held_bills (payload, label, created_by) VALUES (?,?,?)')
    .run(JSON.stringify(payload), label || null, req.user.id);
  const held = db.prepare('SELECT * FROM held_bills WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ heldBill: { ...held, payload: JSON.parse(held.payload) } });
});

router.get('/held', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM held_bills ORDER BY id DESC').all();
  res.json({
    heldBills: rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) })),
  });
});

router.post('/retrieve/:id', authenticate, (req, res) => {
  const held = db.prepare('SELECT * FROM held_bills WHERE id = ?').get(req.params.id);
  if (!held) return res.status(404).json({ error: 'Held bill not found' });
  res.json({ heldBill: { ...held, payload: JSON.parse(held.payload) } });
});

router.delete('/held/:id', authenticate, (req, res) => {
  const info = db.prepare('DELETE FROM held_bills WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Held bill not found' });
  res.json({ success: true });
});

router.post('/', authenticate, (req, res) => {
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

  const insertInvoice = db.prepare(
    `INSERT INTO invoices
     (invoice_no, customer_id, subtotal, discount, tax_total, grand_total, payment_mode, created_by, amount_paid, status, due_date)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );
  const insertItem = db.prepare(
    `INSERT INTO invoice_items
     (invoice_id, product_id, qty, unit_price, discount, tax_percent, tax_amount, line_total)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
  const updateStock = db.prepare(
    "UPDATE products SET stock_qty = stock_qty - ?, updated_at = datetime('now') WHERE id = ?"
  );

  db.exec('BEGIN');
  try {
    let subtotal = 0;
    let taxTotal = 0;
    const processed = [];
    for (const it of items) {
      const product = getProduct.get(it.product_id);
      if (!product) throw new Error('Product not found: ' + it.product_id);
      const qty = Number(it.qty);
      if (!(qty > 0)) throw new Error('Invalid quantity for ' + product.name);
      if (product.stock_qty < qty) {
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
      });
      updateStock.run(qty, product.id);
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
      due_date
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
        p.line_total
      );
    }
    db.exec('COMMIT');
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

router.get('/', authenticate, (req, res) => {
  const { q } = req.query;
  let sql = `SELECT i.*, u.name AS cashier_name,
             (SELECT COUNT(*) FROM invoice_items ii WHERE ii.invoice_id = i.id) AS item_count
             FROM invoices i
             LEFT JOIN users u ON i.created_by = u.id`;
  const params = [];
  if (q) {
    sql += ' WHERE i.invoice_no LIKE ?';
    params.push(`%${q}%`);
  }
  sql += ' ORDER BY i.id DESC LIMIT 200';
  res.json({ invoices: db.prepare(sql).all(...params) });
});

router.get('/:id', authenticate, (req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
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
  res.json({ invoice, items, cashier });
});

module.exports = router;
