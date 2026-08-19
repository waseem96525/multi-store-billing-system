const express = require('express');
const db = require('../db');
const { authenticate, requirePerm } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(authenticate, attachStore, requirePerm('dashboard.view'));

router.get('/', asyncHandler(async (req, res) => {
  const today = db.today();
  const [invoices, stockRows, suppliers] = await Promise.all([
    db.all('invoices'),
    db.where('product_stock', (r) => Number(r.store_id) === Number(req.storeId)),
    db.all('suppliers'),
  ]);

  const storeInvoices = invoices.filter((i) => Number(i.store_id) === Number(req.storeId));
  const salesTodayList = storeInvoices.filter((i) => db.dateOf(i.created_at) === today);
  const salesToday = {
    total: salesTodayList.reduce((s, i) => s + (i.grand_total || 0), 0),
    count: salesTodayList.length,
  };

  const lowStockRows = stockRows.filter((r) => r.stock_qty <= r.reorder_level);
  const lowStockItems = lowStockRows
    .sort((a, b) => a.stock_qty - b.stock_qty)
    .slice(0, 10);

  const [products, items] = await Promise.all([db.all('products'), db.all('invoice_items')]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const recent = new Set(
    storeInvoices.filter((i) => db.dateOf(i.created_at) >= cutoff).map((i) => i.id)
  );
  const sold = new Map();
  for (const it of items) {
    if (!recent.has(it.invoice_id)) continue;
    const cur = sold.get(it.product_id) || { qty: 0, revenue: 0 };
    cur.qty += it.qty;
    cur.revenue += it.line_total || 0;
    sold.set(it.product_id, cur);
  }
  const topProducts = [...sold.entries()]
    .map(([pid, v]) => ({ name: productMap.get(pid) ? productMap.get(pid).name : 'Item', ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  const outstandingPayables = suppliers.reduce((s, sup) => s + (sup.outstanding_balance || 0), 0);

  res.json({
    salesToday,
    lowStock: lowStockRows.length,
    lowStockItems: lowStockItems.map((r) => ({
      stock_qty: r.stock_qty,
      reorder_level: r.reorder_level,
      id: Number(r.product_id),
      name: productMap.get(Number(r.product_id)) ? productMap.get(Number(r.product_id)).name : null,
    })),
    totalProducts: stockRows.length,
    topProducts,
    outstandingPayables,
  });
}));

module.exports = router;