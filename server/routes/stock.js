const express = require('express');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Record a manual stock adjustment (correction, damage, return, etc.)
router.post('/adjust', authenticate, authorize('admin', 'inventory'), (req, res) => {
  const { product_id, change_qty, reason } = req.body || {};
  if (!product_id) return res.status(400).json({ error: 'product_id required' });
  const change = Number(change_qty);
  if (!change) return res.status(400).json({ error: 'change_qty must be non-zero' });
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  db.exec('BEGIN');
  try {
    db.prepare(
      "UPDATE products SET stock_qty = stock_qty + ?, updated_at = datetime('now') WHERE id = ?"
    ).run(change, product_id);
    db.prepare(
      'INSERT INTO stock_adjustments (product_id, change_qty, reason, adjusted_by) VALUES (?,?,?,?)'
    ).run(product_id, change, reason || null, req.user.id);
    db.exec('COMMIT');
    res.status(201).json({ product: db.prepare('SELECT * FROM products WHERE id = ?').get(product_id) });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: e.message });
  }
});

// Audit trail of stock adjustments (optionally filtered by product)
router.get('/', authenticate, (req, res) => {
  const { product_id } = req.query;
  let sql = `SELECT sa.*, p.name AS product_name, u.name AS adjusted_by_name
             FROM stock_adjustments sa
             LEFT JOIN products p ON sa.product_id = p.id
             LEFT JOIN users u ON sa.adjusted_by = u.id`;
  const params = [];
  if (product_id) {
    sql += ' WHERE sa.product_id = ?';
    params.push(product_id);
  }
  sql += ' ORDER BY sa.id DESC LIMIT 300';
  res.json({ adjustments: db.prepare(sql).all(...params) });
});

module.exports = router;
