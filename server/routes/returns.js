const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const { logActivity } = require('../utils/activity');

const router = express.Router();

router.use(authenticate);
router.use(attachStore);

// List returns for the current store (optional invoice filter)
router.get('/', (req, res) => {
  const { invoice_id } = req.query;
  let sql = `SELECT r.*, i.invoice_no, u.name AS created_by_name
             FROM returns r
             LEFT JOIN invoices i ON i.id = r.invoice_id
             LEFT JOIN users u ON u.id = r.created_by
             WHERE r.store_id = ?`;
  const params = [req.storeId];
  if (invoice_id) {
    sql += ' AND r.invoice_id = ?';
    params.push(invoice_id);
  }
  sql += ' ORDER BY r.created_at DESC, r.id DESC';
  const returns = db.prepare(sql).all(...params);
  // attach items for each return
  const itemStmt = db.prepare(
    `SELECT ri.*, p.name AS product_name FROM return_items ri
     LEFT JOIN products p ON p.id = ri.product_id
     WHERE ri.return_id = ?`
  );
  for (const r of returns) r.items = itemStmt.all(r.id);
  res.json({ returns });
});

// Detailed return (for the receipt/print view)
router.get('/:id', (req, res) => {
  const ret = db
    .prepare(
      `SELECT r.*, i.invoice_no, u.name AS created_by_name, s.name AS store_name, s.address, s.phone, s.gstin
       FROM returns r
       LEFT JOIN invoices i ON i.id = r.invoice_id
       LEFT JOIN users u ON u.id = r.created_by
       LEFT JOIN stores s ON s.id = r.store_id
       WHERE r.id = ? AND r.store_id = ?`
    )
    .get(req.params.id, req.storeId);
  if (!ret) return res.status(404).json({ error: 'Return not found' });
  ret.items = db
    .prepare(
      `SELECT ri.*, p.name AS product_name FROM return_items ri
       LEFT JOIN products p ON p.id = ri.product_id
       WHERE ri.return_id = ?`
    )
    .all(ret.id);
  res.json({ return: ret });
});

// Get an invoice's returnable items
router.get('/invoice/:invoiceId/items', (req, res) => {
  const invoice = db
    .prepare('SELECT * FROM invoices WHERE id = ? AND store_id = ?')
    .get(req.params.invoiceId, req.storeId);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const items = db
    .prepare(
      `SELECT ii.id AS invoice_item_id, ii.product_id, p.name AS product_name, p.sku,
              ii.qty AS sold_qty, ii.unit_price
       FROM invoice_items ii
       LEFT JOIN products p ON p.id = ii.product_id
       WHERE ii.invoice_id = ?`
    )
    .all(invoice.id);
  const alreadyReturned = db
    .prepare(
      `SELECT product_id, COALESCE(SUM(qty), 0) AS qty FROM return_items ri
       WHERE ri.return_id IN (SELECT id FROM returns WHERE invoice_id = ?)
       GROUP BY product_id`
    )
    .all(invoice.id);
  const returnedMap = Object.fromEntries(alreadyReturned.map((r) => [r.product_id, r.qty]));
  for (const it of items) {
    it.already_returned = returnedMap[it.product_id] || 0;
    it.returnable_qty = Math.max(0, it.sold_qty - it.already_returned);
  }
  res.json({ invoice, items });
});

router.post('/', authorize('admin', 'inventory'), (req, res) => {
  const { invoice_id, reason, items } = req.body || {};
  if (!invoice_id) return res.status(400).json({ error: 'invoice_id required' });
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one item is required' });
  }

  const invoice = db
    .prepare('SELECT * FROM invoices WHERE id = ? AND store_id = ?')
    .get(invoice_id, req.storeId);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  // Validate requested quantities against sold minus already returned
  const invoiceItems = db
    .prepare('SELECT * FROM invoice_items WHERE invoice_id = ?')
    .all(invoice.id);
  const soldMap = new Map();
  for (const it of invoiceItems) {
    soldMap.set(it.product_id, (soldMap.get(it.product_id) || 0) + it.qty);
  }
  const unitPriceMap = new Map();
  for (const it of invoiceItems) {
    if (!unitPriceMap.has(it.product_id)) unitPriceMap.set(it.product_id, it.unit_price);
  }
  const alreadyReturned = db
    .prepare(
      `SELECT product_id, COALESCE(SUM(qty), 0) AS qty FROM return_items ri
       WHERE ri.return_id IN (SELECT id FROM returns WHERE invoice_id = ?)
       GROUP BY product_id`
    )
    .all(invoice.id);
  const returnedMap = new Map(alreadyReturned.map((r) => [r.product_id, r.qty]));

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
      return res
        .status(400)
        .json({ error: `Cannot return more than ${sold - returned} of this item` });
    }
    lineItems.push({
      product_id: productId,
      qty,
      unit_price: unitPriceMap.get(productId) || 0,
      line_total: qty * (unitPriceMap.get(productId) || 0),
    });
  }

  const totalRefund = lineItems.reduce((sum, l) => sum + l.line_total, 0);

  db.exec('BEGIN');
  try {
    const insertReturn = db.prepare(
      `INSERT INTO returns (store_id, invoice_id, reason, total_refund, created_by)
       VALUES (?,?,?,?,?)`
    );
    const insertItem = db.prepare(
      `INSERT INTO return_items (return_id, product_id, qty, unit_price, line_total)
       VALUES (?,?,?,?,?)`
    );
    const restock = db.prepare(
      `INSERT INTO product_stock (product_id, store_id, stock_qty, reorder_level)
       VALUES (?,?,?,0)
       ON CONFLICT(product_id, store_id) DO UPDATE SET
         stock_qty = stock_qty + excluded.stock_qty`
    );
    const info = insertReturn.run(req.storeId, invoice.id, reason || null, totalRefund, req.user.id);
    const returnId = info.lastInsertRowid;
    for (const l of lineItems) {
      insertItem.run(returnId, l.product_id, l.qty, l.unit_price, l.line_total);
      restock.run(l.product_id, req.storeId, l.qty);
    }
    db.exec('COMMIT');
    const ret = db.prepare('SELECT * FROM returns WHERE id = ?').get(returnId);
    logActivity(
      req.user,
      'return',
      `Return #${returnId} on ${invoice.invoice_no} · ${lineItems.length} item(s) · refund ₹${totalRefund.toFixed(2)}`,
      req.storeId
    );
    res.status(201).json({ return: ret });
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
});

module.exports = router;
