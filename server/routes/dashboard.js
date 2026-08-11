const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');

const router = express.Router();

router.use(authenticate, attachStore);

router.get('/', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const salesToday = db
    .prepare(
      'SELECT COALESCE(SUM(grand_total),0) AS total, COUNT(*) AS count FROM invoices WHERE date(created_at) = ? AND store_id = ?'
    )
    .get(today, req.storeId);
  const lowStock = db
    .prepare(
      'SELECT COUNT(*) AS c FROM product_stock WHERE store_id = ? AND stock_qty <= reorder_level'
    )
    .get(req.storeId).c;
  const lowStockItems = db
    .prepare(
      `SELECT ps.stock_qty, ps.reorder_level, p.id, p.name FROM product_stock ps
       LEFT JOIN products p ON p.id = ps.product_id
       WHERE ps.store_id = ? AND ps.stock_qty <= ps.reorder_level
       ORDER BY ps.stock_qty ASC LIMIT 10`
    )
    .all(req.storeId);
  const totalProducts = db
    .prepare(
      'SELECT COUNT(*) AS c FROM product_stock WHERE store_id = ?'
    )
    .get(req.storeId).c;
  const topProducts = db
    .prepare(
      `SELECT p.name, SUM(ii.qty) AS qty_sold, SUM(ii.line_total) AS revenue
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       JOIN products p ON p.id = ii.product_id
       WHERE i.store_id = ?
       GROUP BY p.id ORDER BY revenue DESC LIMIT 5`
    )
    .all(req.storeId);
  const outstandingPayables = db
    .prepare('SELECT COALESCE(SUM(outstanding_balance),0) AS total FROM suppliers')
    .get().total;
  res.json({ salesToday, lowStock, lowStockItems, totalProducts, topProducts, outstandingPayables });
});

module.exports = router;
