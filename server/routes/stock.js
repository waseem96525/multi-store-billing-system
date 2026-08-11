const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');

const router = express.Router();

router.use(authenticate, attachStore);

// Record a manual stock adjustment (correction, damage, return, etc.)
router.post('/adjust', authorize('admin', 'inventory'), (req, res) => {
  const { product_id, change_qty, reason } = req.body || {};
  if (!product_id) return res.status(400).json({ error: 'product_id required' });
  const change = Number(change_qty);
  if (!change) return res.status(400).json({ error: 'change_qty must be non-zero' });
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO product_stock (product_id, store_id, stock_qty, reorder_level)
       VALUES (?,?,?,0)
       ON CONFLICT(product_id, store_id) DO UPDATE SET stock_qty = stock_qty + excluded.stock_qty`
    ).run(product_id, req.storeId, change);
    db.prepare(
      'INSERT INTO stock_adjustments (product_id, change_qty, reason, adjusted_by, store_id) VALUES (?,?,?,?,?)'
    ).run(product_id, change, reason || null, req.user.id, req.storeId);
    db.exec('COMMIT');
    const stock = db
      .prepare('SELECT * FROM product_stock WHERE product_id = ? AND store_id = ?')
      .get(product_id, req.storeId);
    res.status(201).json({ product: { ...product, stock_qty: stock ? stock.stock_qty : 0 } });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: e.message });
  }
});

// Audit trail of stock adjustments (optionally filtered by product)
router.get('/', (req, res) => {
  const { product_id } = req.query;
  let sql = `SELECT sa.*, p.name AS product_name, u.name AS adjusted_by_name
             FROM stock_adjustments sa
             LEFT JOIN products p ON sa.product_id = p.id
             LEFT JOIN users u ON sa.adjusted_by = u.id
             WHERE sa.store_id = ?`;
  const params = [req.storeId];
  if (product_id) {
    sql += ' AND sa.product_id = ?';
    params.push(product_id);
  }
  sql += ' ORDER BY sa.id DESC LIMIT 300';
  res.json({ adjustments: db.prepare(sql).all(...params) });
});

module.exports = router;
