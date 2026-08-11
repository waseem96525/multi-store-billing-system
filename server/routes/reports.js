const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');

const router = express.Router();

router.use(authenticate);
router.use(attachStore);

// Overview: revenue, profit (revenue - COGS), expenses, returns, net profit
router.get('/summary', (req, res) => {
  const { from, to } = req.query;
  const params = [req.storeId];
  let dateFilter = '';
  if (from) {
    dateFilter += ' AND date(created_at) >= date(?)';
    params.push(from);
  }
  if (to) {
    dateFilter += ' AND date(created_at) <= date(?)';
    params.push(to);
  }

  const sales = db
    .prepare(
      `SELECT COALESCE(SUM(grand_total), 0) AS revenue,
              COALESCE(SUM(CASE WHEN status = 'credit' THEN grand_total - amount_paid ELSE 0 END), 0) AS pending,
              COUNT(*) AS invoice_count
       FROM invoices WHERE store_id = ?${dateFilter}`
    )
    .get(...params);

  const cogs = db
    .prepare(
      `SELECT COALESCE(SUM(ii.qty * ii.cost_price), 0) AS cogs
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       WHERE i.store_id = ?${dateFilter}`
    )
    .get(...params);

  const expParams = [req.storeId];
  let expFilter = '';
  if (from) {
    expFilter += ' AND date(expense_date) >= date(?)';
    expParams.push(from);
  }
  if (to) {
    expFilter += ' AND date(expense_date) <= date(?)';
    expParams.push(to);
  }
  const expenses = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
       WHERE store_id = ?${expFilter}`
    )
    .get(...expParams);

  const returnsTotal = db
    .prepare(
      `SELECT COALESCE(SUM(total_refund), 0) AS total FROM returns
       WHERE store_id = ?${dateFilter}`
    )
    .get(...params);

  res.json({
    summary: {
      revenue: sales.revenue,
      pending: sales.pending,
      invoice_count: sales.invoice_count,
      cogs: cogs.cogs,
      gross_profit: Math.max(0, sales.revenue - returnsTotal.total - cogs.cogs),
      expenses: expenses.total,
      returns_total: returnsTotal.total,
      net_profit: Math.max(0, sales.revenue - returnsTotal.total - cogs.cogs - expenses.total),
    },
  });
});

// Daily revenue series for the charts
router.get('/daily', (req, res) => {
  const { from, to } = req.query;
  const params = [req.storeId];
  let dateFilter = '';
  if (from) {
    dateFilter += ' AND date(created_at) >= date(?)';
    params.push(from);
  }
  if (to) {
    dateFilter += ' AND date(created_at) <= date(?)';
    params.push(to);
  }
  const days = db
    .prepare(
      `SELECT date(created_at) AS day,
              COUNT(*) AS invoice_count,
              COALESCE(SUM(grand_total), 0) AS revenue
       FROM invoices WHERE store_id = ?${dateFilter}
       GROUP BY date(created_at) ORDER BY day`
    )
    .all(...params);

  const expParams = [req.storeId];
  let expFilter = '';
  if (from) {
    expFilter += ' AND date(expense_date) >= date(?)';
    expParams.push(from);
  }
  if (to) {
    expFilter += ' AND date(expense_date) <= date(?)';
    expParams.push(to);
  }
  const expenseDays = db
    .prepare(
      `SELECT date(expense_date) AS day, COALESCE(SUM(amount), 0) AS expenses
       FROM expenses WHERE store_id = ?${expFilter}
       GROUP BY date(expense_date)`
    )
    .all(...expParams);
  const expMap = Object.fromEntries(expenseDays.map((e) => [e.day, e.expenses]));

  // Fill gaps with zeroes
  const result = [];
  if (days.length > 0) {
    const start = new Date(days[0].day);
    const end = new Date(days[days.length - 1].day);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const day = d.toISOString().slice(0, 10);
      const found = days.find((r) => r.day === day);
      result.push({
        day,
        invoice_count: found ? found.invoice_count : 0,
        revenue: found ? found.revenue : 0,
        expenses: expMap[day] || 0,
      });
    }
  }
  res.json({ days: result });
});

// Top selling products in range
router.get('/top-products', (req, res) => {
  const { from, to, limit } = req.query;
  const n = Math.min(parseInt(limit) || 10, 50);
  const params = [req.storeId];
  let dateFilter = '';
  if (from) {
    dateFilter += ' AND date(i.created_at) >= date(?)';
    params.push(from);
  }
  if (to) {
    dateFilter += ' AND date(i.created_at) <= date(?)';
    params.push(to);
  }
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.sku, c.name AS category_name,
              COALESCE(SUM(ii.qty), 0) AS qty_sold,
              COALESCE(SUM(ii.line_total), 0) AS sales_value
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       LEFT JOIN products p ON p.id = ii.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE i.store_id = ?${dateFilter}
       GROUP BY p.id ORDER BY qty_sold DESC LIMIT ?`
    )
    .all(...params.concat(n));
  res.json({ products: rows });
});

// Payment mode breakdown
router.get('/payment-modes', (req, res) => {
  const { from, to } = req.query;
  const params = [req.storeId];
  let dateFilter = '';
  if (from) {
    dateFilter += ' AND date(created_at) >= date(?)';
    params.push(from);
  }
  if (to) {
    dateFilter += ' AND date(created_at) <= date(?)';
    params.push(to);
  }
  const rows = db
    .prepare(
      `SELECT payment_mode, COUNT(*) AS count, COALESCE(SUM(grand_total), 0) AS total
       FROM invoices WHERE store_id = ?${dateFilter}
       GROUP BY payment_mode ORDER BY total DESC`
    )
    .all(...params);
  res.json({ modes: rows });
});

// Expenses grouped by category
router.get('/expense-breakdown', (req, res) => {
  const { from, to } = req.query;
  const params = [req.storeId];
  let filter = '';
  if (from) {
    filter += ' AND date(expense_date) >= date(?)';
    params.push(from);
  }
  if (to) {
    filter += ' AND date(expense_date) <= date(?)';
    params.push(to);
  }
  const rows = db
    .prepare(
      `SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
       FROM expenses WHERE store_id = ?${filter}
       GROUP BY category ORDER BY total DESC`
    )
    .all(...params);
  res.json({ breakdown: rows });
});

// Profit by product + daily profit series
router.get('/profit', (req, res) => {
  const { from, to } = req.query;
  const params = [req.storeId];
  let dateFilter = '';
  if (from) {
    dateFilter += ' AND date(i.created_at) >= date(?)';
    params.push(from);
  }
  if (to) {
    dateFilter += ' AND date(i.created_at) <= date(?)';
    params.push(to);
  }

  const products = db
    .prepare(
      `SELECT p.id, p.name, p.sku, c.name AS category_name,
              COALESCE(SUM(ii.qty), 0) AS qty_sold,
              COALESCE(SUM(ii.line_total), 0) AS sales_value,
              COALESCE(SUM(ii.qty * ii.cost_price), 0) AS cogs,
              COALESCE(SUM(ii.line_total), 0) - COALESCE(SUM(ii.qty * ii.cost_price), 0) AS profit
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       LEFT JOIN products p ON p.id = ii.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE i.store_id = ?${dateFilter}
       GROUP BY p.id
       ORDER BY profit DESC`
    )
    .all(...params);

  const daily = db
    .prepare(
      `SELECT date(i.created_at) AS day,
              COALESCE(SUM(ii.line_total), 0) AS sales_value,
              COALESCE(SUM(ii.qty * ii.cost_price), 0) AS cogs,
              COALESCE(SUM(ii.line_total), 0) - COALESCE(SUM(ii.qty * ii.cost_price), 0) AS profit
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       WHERE i.store_id = ?${dateFilter}
       GROUP BY date(i.created_at) ORDER BY day`
    )
    .all(...params);

  res.json({ products, daily });
});

module.exports = router;
