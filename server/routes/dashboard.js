const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const salesToday = db
    .prepare(
      'SELECT COALESCE(SUM(grand_total),0) AS total, COUNT(*) AS count FROM invoices WHERE date(created_at) = ?'
    )
    .get(today);
  const lowStock = db
    .prepare('SELECT COUNT(*) AS c FROM products WHERE stock_qty <= reorder_level')
    .get().c;
  const lowStockItems = db
    .prepare(
      'SELECT id, name, stock_qty, reorder_level FROM products WHERE stock_qty <= reorder_level ORDER BY stock_qty ASC LIMIT 10'
    )
    .all();
  const totalProducts = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  const topProducts = db
    .prepare(
      `SELECT p.name, SUM(ii.qty) AS qty_sold, SUM(ii.line_total) AS revenue
       FROM invoice_items ii JOIN products p ON p.id = ii.product_id
       GROUP BY p.id ORDER BY revenue DESC LIMIT 5`
    )
    .all();
  const outstandingPayables = db
    .prepare('SELECT COALESCE(SUM(outstanding_balance),0) AS total FROM suppliers')
    .get().total;
  res.json({ salesToday, lowStock, lowStockItems, totalProducts, topProducts, outstandingPayables });
});

module.exports = router;
