const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.post('/', authenticate, authorize('admin', 'inventory'), (req, res) => {
  const { supplier_id, invoice_ref, items } = req.body || {};
  if (!supplier_id) return res.status(400).json({ error: 'supplier_id required' });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items required' });
  }

  const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
  const insertPurchase = db.prepare(
    'INSERT INTO purchases (supplier_id, invoice_ref, total_amount, created_by) VALUES (?,?,?,?)'
  );
  const insertItem = db.prepare(
    'INSERT INTO purchase_items (purchase_id, product_id, qty, cost_price) VALUES (?,?,?,?)'
  );
  const updateStock = db.prepare(
    "UPDATE products SET stock_qty = stock_qty + ?, updated_at = datetime('now') WHERE id = ?"
  );
  const updateSupplier = db.prepare(
    'UPDATE suppliers SET outstanding_balance = outstanding_balance + ? WHERE id = ?'
  );
  const getSupplier = db.prepare('SELECT * FROM suppliers WHERE id = ?');

  db.exec('BEGIN');
  try {
    let total = 0;
    const processed = [];
    for (const it of items) {
      const product = getProduct.get(it.product_id);
      if (!product) throw new Error('Product not found: ' + it.product_id);
      const qty = Number(it.qty);
      if (!(qty > 0)) throw new Error('Invalid quantity for ' + product.name);
      const cost = Number(it.cost_price ?? product.cost_price);
      total += cost * qty;
      processed.push({ product_id: product.id, qty, cost_price: cost });
      updateStock.run(qty, product.id);
    }
    const info = insertPurchase.run(supplier_id, invoice_ref || null, total, req.user.id);
    const purchaseId = info.lastInsertRowid;
    for (const p of processed) {
      insertItem.run(purchaseId, p.product_id, p.qty, p.cost_price);
    }
    if (getSupplier.get(supplier_id)) updateSupplier.run(total, supplier_id);
    db.exec('COMMIT');
    res.status(201).json({
      purchase: { id: purchaseId, supplier_id, invoice_ref, total_amount: total },
    });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: e.message });
  }
});

router.get('/', authenticate, (req, res) => {
  const purchases = db
    .prepare(
      `SELECT p.*, s.name AS supplier_name FROM purchases p
       LEFT JOIN suppliers s ON p.supplier_id = s.id
       ORDER BY p.id DESC LIMIT 200`
    )
    .all();
  res.json({ purchases });
});

router.get('/:id', authenticate, (req, res) => {
  const purchase = db
    .prepare(
      `SELECT p.*, s.name AS supplier_name FROM purchases p
       LEFT JOIN suppliers s ON p.supplier_id = s.id
       WHERE p.id = ?`
    )
    .get(req.params.id);
  if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
  const items = db
    .prepare(
      `SELECT pi.*, p.name AS product_name FROM purchase_items pi
       LEFT JOIN products p ON pi.product_id = p.id
       WHERE pi.purchase_id = ?`
    )
    .all(purchase.id);
  res.json({ purchase, items });
});

module.exports = router;
