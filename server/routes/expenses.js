const express = require('express');
const db = require('../db');
const { authenticate, requirePerm } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const { logActivity } = require('../utils/activity');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(authenticate, attachStore);

router.get('/', asyncHandler(async (req, res) => {
  const { from, to, category } = req.query;
  let expenses = await db.where('expenses', (e) => Number(e.store_id) === Number(req.storeId));
  if (from) expenses = expenses.filter((e) => db.dateOf(e.expense_date) >= from);
  if (to) expenses = expenses.filter((e) => db.dateOf(e.expense_date) <= to);
  if (category) expenses = expenses.filter((e) => e.category === category);
  expenses.sort((a, b) => {
    const c = String(b.expense_date).localeCompare(String(a.expense_date));
    return c !== 0 ? c : b.id - a.id;
  });

  const [users, all] = await Promise.all([db.all('users'), db.where('expenses', (e) => Number(e.store_id) === Number(req.storeId))]);
  const userMap = new Map(users.map((u) => [u.id, u]));
  const categoriesList = [...new Set(all.map((e) => e.category))].sort();
  res.json({
    expenses: expenses.map((e) => ({
      ...e,
      created_by_name: e.created_by && userMap.get(e.created_by) ? userMap.get(e.created_by).name : null,
    })),
    categories: categoriesList,
  });
}));

router.post('/', requirePerm('expenses.create'), asyncHandler(async (req, res) => {
  const { category, amount, note, expense_date } = req.body || {};
  if (!category) return res.status(400).json({ error: 'category required' });
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'Valid amount required' });
  const expense = await db.insert('expenses', {
    store_id: req.storeId,
    category,
    amount: Number(amount),
    note: note || null,
    expense_date: expense_date || new Date().toISOString().slice(0, 10),
    created_by: req.user.id,
    created_at: db.now(),
  });
  logActivity(
    req.user,
    'expense',
    `${category} · ₹${Number(amount).toFixed(2)}${note ? ` · ${note}` : ''}`,
    req.storeId
  );
  res.status(201).json({ expense });
}));

router.delete('/:id', requirePerm('expenses.delete'), asyncHandler(async (req, res) => {
  const expense = await db.get('expenses', req.params.id);
  if (!expense || Number(expense.store_id) !== Number(req.storeId)) {
    return res.status(404).json({ error: 'Expense not found' });
  }
  await db.remove('expenses', req.params.id);
  logActivity(req.user, 'expense_deleted', `Deleted expense id ${req.params.id}`, req.storeId);
  res.json({ success: true });
}));

module.exports = router;