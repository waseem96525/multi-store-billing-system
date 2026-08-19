const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { can } = require('../utils/permissions');
const { attachStore } = require('../middleware/store');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(authenticate, attachStore);

const esc = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

const ENTITIES = {
  products: {
    perm: 'inventory.view',
    file: 'products.csv',
    async rows(storeId) {
      const [products, stockRows, categories] = await Promise.all([
        db.all('products'),
        db.where('product_stock', (r) => Number(r.store_id) === Number(storeId)),
        db.all('categories'),
      ]);
      const stockMap = new Map(stockRows.map((r) => [Number(r.product_id), r]));
      const catMap = new Map(categories.map((c) => [c.id, c]));
      return products
        .map((p) => {
          const s = stockMap.get(p.id);
          return {
            id: p.id,
            name: p.name,
            brand: p.brand,
            sku: p.sku,
            barcode: p.barcode,
            category: p.category_id && catMap.get(p.category_id) ? catMap.get(p.category_id).name : null,
            unit: p.unit,
            cost_price: p.cost_price,
            selling_price: p.selling_price,
            mrp: p.mrp,
            tax_percent: p.tax_percent,
            discount_pct: p.discount_pct || 0,
            stock_qty: s ? s.stock_qty : 0,
            reorder_level: s ? s.reorder_level : 0,
            hsn_code: p.hsn_code,
            expiry_date: p.expiry_date,
            location: p.location,
          };
        })
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    },
    columns: [
      ['id', 'ID'], ['name', 'Name'], ['brand', 'Brand'], ['sku', 'SKU'], ['barcode', 'Barcode'],
      ['category', 'Category'], ['unit', 'Unit'], ['cost_price', 'Cost Price'], ['selling_price', 'Selling Price'],
      ['mrp', 'MRP'], ['tax_percent', 'Tax %'], ['discount_pct', 'Item Discount %'], ['stock_qty', 'Stock'], ['reorder_level', 'Reorder Level'],
      ['hsn_code', 'HSN Code'], ['expiry_date', 'Expiry Date'], ['location', 'Location'],
    ],
  },
  invoices: {
    perm: 'invoice.view',
    file: 'invoices.csv',
    async rows(storeId) {
      const [invoices, users, customers] = await Promise.all([
        db.where('invoices', (i) => Number(i.store_id) === Number(storeId)),
        db.all('users'),
        db.all('customers'),
      ]);
      const userMap = new Map(users.map((u) => [u.id, u]));
      const custMap = new Map(customers.map((c) => [c.id, c]));
      return invoices
        .sort((a, b) => b.id - a.id)
        .map((i) => ({
          id: i.id,
          invoice_no: i.invoice_no,
          created_at: i.created_at,
          cashier: i.created_by && userMap.get(i.created_by) ? userMap.get(i.created_by).name : null,
          subtotal: i.subtotal,
          discount: i.discount,
          item_discount: i.item_discount || 0,
          tax_total: i.tax_total,
          grand_total: i.grand_total,
          payment_mode: i.payment_mode,
          status: i.status,
          amount_paid: i.amount_paid,
          customer: i.customer_id && custMap.get(i.customer_id) ? custMap.get(i.customer_id).name : 'Walk-in',
        }));
    },
    columns: [
      ['id', 'ID'], ['invoice_no', 'Invoice No'], ['created_at', 'Date'], ['cashier', 'Cashier'],
      ['subtotal', 'Subtotal'], ['discount', 'Bill Discount'], ['item_discount', 'Item Discount'], ['tax_total', 'Tax'], ['grand_total', 'Grand Total'],
      ['payment_mode', 'Payment Mode'], ['status', 'Status'], ['amount_paid', 'Amount Paid'], ['customer', 'Customer'],
    ],
  },
  customers: {
    perm: 'invoice.view',
    file: 'customers.csv',
    storeScoped: false,
    async rows(storeId) {
      const customers = await db.all('customers');
      return customers.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    },
    columns: [
      ['id', 'ID'], ['name', 'Name'], ['phone', 'Phone'], ['email', 'Email'], ['address', 'Address'], ['created_at', 'Created'],
    ],
  },
  suppliers: {
    perm: 'invoice.view',
    file: 'suppliers.csv',
    storeScoped: false,
    async rows(storeId) {
      const suppliers = await db.all('suppliers');
      return suppliers.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    },
    columns: [
      ['id', 'ID'], ['name', 'Name'], ['phone', 'Phone'], ['email', 'Email'], ['address', 'Address'], ['outstanding_balance', 'Outstanding Balance'],
    ],
  },
  purchases: {
    perm: 'purchases.create',
    file: 'purchases.csv',
    async rows(storeId) {
      const [purchases, suppliers, users] = await Promise.all([
        db.where('purchases', (p) => Number(p.store_id) === Number(storeId)),
        db.all('suppliers'),
        db.all('users'),
      ]);
      const supMap = new Map(suppliers.map((s) => [s.id, s]));
      const userMap = new Map(users.map((u) => [u.id, u]));
      return purchases
        .sort((a, b) => b.id - a.id)
        .map((p) => ({
          id: p.id,
          created_at: p.created_at,
          supplier: supMap.get(p.supplier_id) ? supMap.get(p.supplier_id).name : null,
          invoice_ref: p.invoice_ref,
          total_amount: p.total_amount,
          created_by: p.created_by && userMap.get(p.created_by) ? userMap.get(p.created_by).name : null,
        }));
    },
    columns: [
      ['id', 'ID'], ['created_at', 'Date'], ['supplier', 'Supplier'], ['invoice_ref', 'Invoice Ref'],
      ['total_amount', 'Total Amount'], ['created_by', 'Created By'],
    ],
  },
  expenses: {
    perm: 'expenses.create',
    file: 'expenses.csv',
    async rows(storeId) {
      const [expenses, users] = await Promise.all([
        db.where('expenses', (e) => Number(e.store_id) === Number(storeId)),
        db.all('users'),
      ]);
      const userMap = new Map(users.map((u) => [u.id, u]));
      return expenses
        .sort((a, b) => b.id - a.id)
        .map((e) => ({
          id: e.id,
          expense_date: e.expense_date,
          category: e.category,
          amount: e.amount,
          note: e.note,
          created_by: e.created_by && userMap.get(e.created_by) ? userMap.get(e.created_by).name : null,
        }));
    },
    columns: [
      ['id', 'ID'], ['expense_date', 'Date'], ['category', 'Category'], ['amount', 'Amount'],
      ['note', 'Note'], ['created_by', 'Created By'],
    ],
  },
  returns: {
    perm: 'returns.create',
    file: 'returns.csv',
    async rows(storeId) {
      const [returns, invoices, users] = await Promise.all([
        db.where('returns', (r) => Number(r.store_id) === Number(storeId)),
        db.all('invoices'),
        db.all('users'),
      ]);
      const invMap = new Map(invoices.map((i) => [i.id, i]));
      const userMap = new Map(users.map((u) => [u.id, u]));
      return returns
        .sort((a, b) => b.id - a.id)
        .map((r) => ({
          id: r.id,
          created_at: r.created_at,
          invoice_no: r.invoice_id && invMap.get(r.invoice_id) ? invMap.get(r.invoice_id).invoice_no : null,
          reason: r.reason,
          total_refund: r.total_refund,
          created_by: r.created_by && userMap.get(r.created_by) ? userMap.get(r.created_by).name : null,
        }));
    },
    columns: [
      ['id', 'ID'], ['created_at', 'Date'], ['invoice_no', 'Invoice'], ['reason', 'Reason'],
      ['total_refund', 'Refund Amount'], ['created_by', 'Created By'],
    ],
  },
  transfers: {
    perm: 'transfers.create',
    file: 'transfers.csv',
    async rows(storeId) {
      const [transfers, stores, users, allItems] = await Promise.all([
        db.all('stock_transfers'),
        db.all('stores'),
        db.all('users'),
        db.all('stock_transfer_items'),
      ]);
      const storeMap = new Map(stores.map((s) => [s.id, s]));
      const userMap = new Map(users.map((u) => [u.id, u]));
      const countMap = new Map();
      for (const it of allItems) countMap.set(it.transfer_id, (countMap.get(it.transfer_id) || 0) + 1);
      return transfers
        .filter(
          (t) => Number(t.from_store_id) === Number(storeId) || Number(t.to_store_id) === Number(storeId)
        )
        .sort((a, b) => b.id - a.id)
        .map((t) => ({
          id: t.id,
          created_at: t.created_at,
          from_store: storeMap.get(t.from_store_id) ? storeMap.get(t.from_store_id).name : null,
          to_store: storeMap.get(t.to_store_id) ? storeMap.get(t.to_store_id).name : null,
          note: t.note,
          created_by: t.created_by && userMap.get(t.created_by) ? userMap.get(t.created_by).name : null,
          item_count: countMap.get(t.id) || 0,
        }));
    },
    columns: [
      ['id', 'ID'], ['created_at', 'Date'], ['from_store', 'From Store'], ['to_store', 'To Store'],
      ['note', 'Note'], ['created_by', 'Created By'], ['item_count', 'Item Count'],
    ],
  },
};

router.get('/:entity', asyncHandler(async (req, res) => {
  const entity = ENTITIES[req.params.entity];
  if (!entity) return res.status(400).json({ error: 'Unknown export entity' });
  // Each entity requires its matching view permission
  if (entity.perm && !can(req.user.role, entity.perm)) {
    return res.status(403).json({ error: 'Forbidden: insufficient permission' });
  }
  const rows = await entity.rows(req.storeId);
  const header = entity.columns.map(([, label]) => label);
  const lines = [header.map(esc).join(',')];
  for (const row of rows) {
    lines.push(entity.columns.map(([key]) => esc(row[key])).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${entity.file}"`);
  res.send('\uFEFF' + lines.join('\r\n'));
}));

module.exports = router;