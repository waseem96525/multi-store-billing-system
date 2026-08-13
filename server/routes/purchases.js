const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const { logActivity } = require('../utils/activity');

const router = express.Router();

router.use(authenticate, attachStore);

// Auto-reorder suggestions: products below/at their reorder level for this store,
// with a suggested order quantity and estimated cost.
router.get('/suggestions', (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.sku, p.barcode, p.cost_price, p.selling_price, p.unit,
              ps.stock_qty, ps.reorder_level, c.name AS category_name
       FROM products p
       LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.store_id = ?
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE ps.stock_qty <= ps.reorder_level
       ORDER BY ps.stock_qty - ps.reorder_level ASC, p.name ASC`
    )
    .all(req.storeId);
  const suggestions = rows.map((p) => {
    const suggested_qty = Math.max(1, Math.ceil(p.reorder_level * 2 - p.stock_qty));
    return {
      ...p,
      suggested_qty,
      est_cost: Number((p.cost_price || 0) * suggested_qty).toFixed(2),
    };
  });
  const total_est_cost = suggestions.reduce(
    (sum, s) => sum + Number(s.est_cost),
    0
  );
  res.json({ suggestions, count: suggestions.length, total_est_cost });
});

router.post('/', authorize('admin', 'inventory'), (req, res) => {
  const { supplier_id, invoice_ref, items } = req.body || {};
  if (!supplier_id) return res.status(400).json({ error: 'supplier_id required' });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items required' });
  }

  db.exec('BEGIN');
  try {
    // NOTE: prepare statements after BEGIN - required for remote (Hrana/Turso) transactions
    const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
    const insertPurchase = db.prepare(
      'INSERT INTO purchases (supplier_id, invoice_ref, total_amount, created_by, store_id) VALUES (?,?,?,?,?)'
    );
    const insertItem = db.prepare(
      'INSERT INTO purchase_items (purchase_id, product_id, qty, cost_price) VALUES (?,?,?,?)'
    );
    const updateStock = db.prepare(
      `INSERT INTO product_stock (product_id, store_id, stock_qty, reorder_level)
       VALUES (?,?,?,0)
       ON CONFLICT(product_id, store_id) DO UPDATE SET stock_qty = stock_qty + excluded.stock_qty`
    );
    const updateSupplier = db.prepare(
      'UPDATE suppliers SET outstanding_balance = outstanding_balance + ? WHERE id = ?'
    );
    const getSupplier = db.prepare('SELECT * FROM suppliers WHERE id = ?');

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
      updateStock.run(product.id, req.storeId, qty);
    }
    const info = insertPurchase.run(supplier_id, invoice_ref || null, total, req.user.id, req.storeId);
    const purchaseId = info.lastInsertRowid;
    for (const p of processed) {
      insertItem.run(purchaseId, p.product_id, p.qty, p.cost_price);
    }
    if (getSupplier.get(supplier_id)) updateSupplier.run(total, supplier_id);
    db.exec('COMMIT');
    logActivity(
      req.user,
      'purchase',
      `Purchase #${purchaseId} · ${processed.length} item(s) · ₹${total.toFixed(2)}`,
      req.storeId
    );
    res.status(201).json({
      purchase: { id: purchaseId, supplier_id, invoice_ref, total_amount: total },
    });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: e.message });
  }
});

router.get('/', (req, res) => {
  const purchases = db
    .prepare(
      `SELECT p.*, s.name AS supplier_name FROM purchases p
       LEFT JOIN suppliers s ON p.supplier_id = s.id
       WHERE p.store_id = ?
       ORDER BY p.id DESC LIMIT 200`
    )
    .all(req.storeId);
  res.json({ purchases });
});

router.get('/:id', (req, res) => {
  const purchase = db
    .prepare(
      `SELECT p.*, s.name AS supplier_name FROM purchases p
       LEFT JOIN suppliers s ON p.supplier_id = s.id
       WHERE p.id = ? AND p.store_id = ?`
    )
    .get(req.params.id, req.storeId);
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
