const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(authenticate, attachStore);

const inRange = (dateStr, from, to) => {
  const d = db.dateOf(dateStr);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
};

// Overview: revenue, profit (revenue - COGS), expenses, returns, net profit
router.get('/summary', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const [invoices, allItems, expenses, returns] = await Promise.all([
    db.all('invoices'),
    db.all('invoice_items'),
    db.all('expenses'),
    db.all('returns'),
  ]);

  const storeInvoices = invoices.filter(
    (i) => Number(i.store_id) === Number(req.storeId) && inRange(i.created_at, from, to)
  );
  const invoiceIds = new Set(storeInvoices.map((i) => i.id));

  let revenue = 0;
  let pending = 0;
  for (const i of storeInvoices) {
    revenue += i.grand_total || 0;
    if (i.status === 'credit') pending += (i.grand_total || 0) - (i.amount_paid || 0);
  }
  const cogs = allItems
    .filter((it) => invoiceIds.has(it.invoice_id))
    .reduce((s, it) => s + (it.qty || 0) * (it.cost_price || 0), 0);
  const expTotal = expenses
    .filter((e) => Number(e.store_id) === Number(req.storeId) && inRange(e.expense_date, from, to))
    .reduce((s, e) => s + (e.amount || 0), 0);
  const returnsTotal = returns
    .filter((r) => Number(r.store_id) === Number(req.storeId) && inRange(r.created_at, from, to))
    .reduce((s, r) => s + (r.total_refund || 0), 0);

  res.json({
    summary: {
      revenue,
      pending,
      invoice_count: storeInvoices.length,
      cogs,
      gross_profit: Math.max(0, revenue - returnsTotal - cogs),
      expenses: expTotal,
      returns_total: returnsTotal,
      net_profit: Math.max(0, revenue - returnsTotal - cogs - expTotal),
    },
  });
}));

// Daily revenue series for the charts
router.get('/daily', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const [invoices, expenses] = await Promise.all([
    db.all('invoices'),
    db.all('expenses'),
  ]);

  const days = {};
  for (const i of invoices) {
    if (Number(i.store_id) !== Number(req.storeId) || !inRange(i.created_at, from, to)) continue;
    const day = db.dateOf(i.created_at);
    const cur = days[day] || { invoice_count: 0, revenue: 0 };
    cur.invoice_count += 1;
    cur.revenue += i.grand_total || 0;
    days[day] = cur;
  }
  const expMap = {};
  for (const e of expenses) {
    if (Number(e.store_id) !== Number(req.storeId) || !inRange(e.expense_date, from, to)) continue;
    const day = db.dateOf(e.expense_date);
    expMap[day] = (expMap[day] || 0) + (e.amount || 0);
  }

  const dayKeys = Object.keys(days).sort();
  const result = [];
  if (dayKeys.length > 0) {
    const start = new Date(dayKeys[0]);
    const end = new Date(dayKeys[dayKeys.length - 1]);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const day = d.toISOString().slice(0, 10);
      const found = days[day];
      result.push({
        day,
        invoice_count: found ? found.invoice_count : 0,
        revenue: found ? found.revenue : 0,
        expenses: expMap[day] || 0,
      });
    }
  }
  res.json({ days: result });
}));

// Top selling products in range
router.get('/top-products', asyncHandler(async (req, res) => {
  const { from, to, limit } = req.query;
  const n = Math.min(parseInt(limit) || 10, 50);
  const [invoices, allItems, products, categories] = await Promise.all([
    db.all('invoices'),
    db.all('invoice_items'),
    db.all('products'),
    db.all('categories'),
  ]);
  const invoiceIds = new Set(
    invoices
      .filter((i) => Number(i.store_id) === Number(req.storeId) && inRange(i.created_at, from, to))
      .map((i) => i.id)
  );
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const productMap = new Map(products.map((p) => [p.id, p]));
  const agg = new Map();
  for (const it of allItems) {
    if (!invoiceIds.has(it.invoice_id)) continue;
    const cur = agg.get(it.product_id) || { qty: 0, sales: 0 };
    cur.qty += it.qty;
    cur.sales += it.line_total || 0;
    agg.set(it.product_id, cur);
  }
  const rows = [...agg.entries()]
    .map(([pid, v]) => {
      const p = productMap.get(pid);
      return {
        id: pid,
        name: p ? p.name : 'Item',
        sku: p ? p.sku : null,
        category_name: p && p.category_id && catMap.get(p.category_id) ? catMap.get(p.category_id).name : null,
        qty_sold: v.qty,
        sales_value: v.sales,
      };
    })
    .sort((a, b) => b.qty_sold - a.qty_sold)
    .slice(0, n);
  res.json({ products: rows });
}));

// Payment mode breakdown
router.get('/payment-modes', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const invoices = await db.all('invoices');
  const agg = new Map();
  for (const i of invoices) {
    if (Number(i.store_id) !== Number(req.storeId) || !inRange(i.created_at, from, to)) continue;
    const mode = i.payment_mode || 'cash';
    const cur = agg.get(mode) || { count: 0, total: 0 };
    cur.count += 1;
    cur.total += i.grand_total || 0;
    agg.set(mode, cur);
  }
  const modes = [...agg.entries()]
    .map(([mode, v]) => ({ payment_mode: mode, count: v.count, total: v.total }))
    .sort((a, b) => b.total - a.total);
  res.json({ modes });
}));

// Sales grouped by user (cashier) - who billed how much in the period
router.get('/sales-by-user', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const [invoices, allItems, users] = await Promise.all([
    db.all('invoices'),
    db.all('invoice_items'),
    db.all('users'),
  ]);
  const userMap = new Map(users.map((u) => [u.id, u]));

  const agg = new Map();
  const invoiceUser = new Map();
  for (const i of invoices) {
    if (Number(i.store_id) !== Number(req.storeId) || !inRange(i.created_at, from, to)) continue;
    invoiceUser.set(i.id, i.created_by);
    const cur = agg.get(i.created_by) || { invoice_count: 0, revenue: 0, qty_sold: 0, credit_pending: 0 };
    cur.invoice_count += 1;
    cur.revenue += i.grand_total || 0;
    if (i.status === 'credit') cur.credit_pending += (i.grand_total || 0) - (i.amount_paid || 0);
    agg.set(i.created_by, cur);
  }
  for (const it of allItems) {
    const uid = invoiceUser.get(it.invoice_id);
    if (!uid) continue;
    const row = agg.get(uid);
    if (row) row.qty_sold += it.qty || 0;
  }

  const total = [...agg.values()].reduce((s, v) => s + v.revenue, 0);
  const rows = [...agg.entries()]
    .map(([uid, v]) => {
      const u = userMap.get(uid);
      return {
        user_id: uid,
        name: u ? u.name : uid,
        role: u ? u.role : null,
        invoice_count: v.invoice_count,
        qty_sold: v.qty_sold,
        revenue: Math.round(v.revenue * 100) / 100,
        credit_pending: Math.round(v.credit_pending * 100) / 100,
        avg_bill: v.invoice_count > 0 ? Math.round((v.revenue / v.invoice_count) * 100) / 100 : 0,
        share_pct: total > 0 ? Math.round((v.revenue / total) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
  res.json({ users: rows, total_revenue: total });
}));

// Expenses grouped by category
router.get('/expense-breakdown', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const expenses = await db.all('expenses');
  const agg = new Map();
  for (const e of expenses) {
    if (Number(e.store_id) !== Number(req.storeId) || !inRange(e.expense_date, from, to)) continue;
    const cur = agg.get(e.category) || { total: 0, count: 0 };
    cur.total += e.amount || 0;
    cur.count += 1;
    agg.set(e.category, cur);
  }
  const breakdown = [...agg.entries()]
    .map(([category, v]) => ({ category, total: v.total, count: v.count }))
    .sort((a, b) => b.total - a.total);
  res.json({ breakdown });
}));

// Profit by product + daily profit series
router.get('/profit', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const [invoices, allItems, products, categories] = await Promise.all([
    db.all('invoices'),
    db.all('invoice_items'),
    db.all('products'),
    db.all('categories'),
  ]);
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const productMap = new Map(products.map((p) => [p.id, p]));
  const storeInvoices = invoices.filter(
    (i) => Number(i.store_id) === Number(req.storeId) && inRange(i.created_at, from, to)
  );
  const invoiceSet = new Set(storeInvoices.map((i) => i.id));

  const productAgg = new Map();
  const dailyAgg = new Map();
  const dayOfInvoice = new Map(storeInvoices.map((i) => [i.id, db.dateOf(i.created_at)]));
  for (const it of allItems) {
    if (!invoiceSet.has(it.invoice_id)) continue;
    const sales = it.line_total || 0;
    const cogs = (it.qty || 0) * (it.cost_price || 0);
    const profit = sales - cogs;
    const pa = productAgg.get(it.product_id) || { qty: 0, sales: 0, cogs: 0, profit: 0 };
    pa.qty += it.qty;
    pa.sales += sales;
    pa.cogs += cogs;
    pa.profit += profit;
    productAgg.set(it.product_id, pa);

    const day = dayOfInvoice.get(it.invoice_id);
    const da = dailyAgg.get(day) || { sales: 0, cogs: 0, profit: 0 };
    da.sales += sales;
    da.cogs += cogs;
    da.profit += profit;
    dailyAgg.set(day, da);
  }

  const productsResult = [...productAgg.entries()]
    .map(([pid, v]) => {
      const p = productMap.get(pid);
      return {
        id: pid,
        name: p ? p.name : 'Item',
        sku: p ? p.sku : null,
        category_name: p && p.category_id && catMap.get(p.category_id) ? catMap.get(p.category_id).name : null,
        qty_sold: v.qty,
        sales_value: v.sales,
        cogs: v.cogs,
        profit: v.profit,
      };
    })
    .sort((a, b) => b.profit - a.profit);

  const daily = [...dailyAgg.entries()]
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));

  res.json({ products: productsResult, daily });
}));

module.exports = router;