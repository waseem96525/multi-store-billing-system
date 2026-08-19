// Cash drawer / shift management.
// A "session" is one open-to-close period for a store's cash drawer. On
// close, the server computes the shift breakdown (sales by mode, refunds,
// expenses) and the expected cash in the drawer, then stores a snapshot so
// historical Z-reports stay accurate even if invoices are edited later.
const express = require('express');
const db = require('../db');
const { authenticate, requirePerm } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const { logActivity } = require('../utils/activity');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(authenticate, attachStore);

const findOpen = async (storeId) => {
  const sessions = await db.where(
    'cash_sessions',
    (s) => Number(s.store_id) === Number(storeId) && !s.closed_at
  );
  sessions.sort((a, b) => b.id - a.id);
  return sessions[0] || null;
};

// Compute the shift breakdown for a session's window (live, from current data).
async function computeShift(session, storeId) {
  const since = session.opened_at;
  const [invoices, allItems, returns, expenses] = await Promise.all([
    db.all('invoices'),
    db.all('invoice_items'),
    db.all('returns'),
    db.all('expenses'),
  ]);
  const storeInvoices = invoices.filter(
    (i) => Number(i.store_id) === Number(storeId) && (i.created_at || '') >= since
  );
  const invoiceIds = new Set(storeInvoices.map((i) => i.id));
  const invoiceMap = new Map(storeInvoices.map((i) => [i.id, i]));

  let cash = 0;
  let card = 0;
  let upi = 0;
  let creditTotal = 0;
  let creditPending = 0;
  let invoiceCount = 0;
  for (const i of storeInvoices) {
    if (i.status === 'void') continue;
    invoiceCount += 1;
    if (i.payment_breakdown) {
      try {
        for (const b of JSON.parse(i.payment_breakdown)) {
          if (b.mode === 'cash') cash += Number(b.amount) || 0;
          else if (b.mode === 'card') card += Number(b.amount) || 0;
          else upi += Number(b.amount) || 0;
        }
      } catch (e) {
        /* legacy malformed breakdown - ignore */
      }
    } else if (i.payment_mode === 'cash') cash += i.grand_total || 0;
    else if (i.payment_mode === 'card') card += i.grand_total || 0;
    else if (i.payment_mode === 'upi') upi += i.grand_total || 0;
    else cash += i.amount_paid || 0; // legacy 'mixed': count paid amount as cash

    if (i.status === 'credit') {
      creditTotal += i.grand_total || 0;
      creditPending += (i.grand_total || 0) - (i.amount_paid || 0);
    }
  }

  const itemCount = allItems.filter((it) => invoiceIds.has(it.invoice_id)).length;

  let refundsTotal = 0;
  let cashRefunds = 0;
  for (const r of returns) {
    if (Number(r.store_id) !== Number(storeId) || (r.created_at || '') < since) continue;
    refundsTotal += r.total_refund || 0;
    const inv = invoiceMap.get(r.invoice_id);
    if (inv) {
      if (inv.payment_breakdown) {
        try {
          const b = JSON.parse(inv.payment_breakdown);
          if (b.some((x) => x.mode === 'cash')) cashRefunds += r.total_refund || 0;
        } catch (e) {
          cashRefunds += r.total_refund || 0;
        }
      } else if (inv.payment_mode === 'cash' || !inv.payment_mode) {
        cashRefunds += r.total_refund || 0;
      }
    } else {
      cashRefunds += r.total_refund || 0;
    }
  }

  const expensesTotal = expenses
    .filter((e) => Number(e.store_id) === Number(storeId) && (e.created_at || '') >= since)
    .reduce((s, e) => s + (e.amount || 0), 0);

  const expectedCash = Math.round(
    (session.opening_amount || 0) + cash - cashRefunds - expensesTotal
  );

  return {
    opened_at: session.opened_at,
    opening_amount: session.opening_amount || 0,
    invoice_count: invoiceCount,
    item_count: itemCount,
    cash,
    card,
    upi,
    credit_total: creditTotal,
    credit_pending: creditPending,
    refunds_total: refundsTotal,
    cash_refunds: cashRefunds,
    expenses_total: expensesTotal,
    expected_cash: expectedCash,
  };
}

// Current open session for this store (or null)
router.get('/current', asyncHandler(async (req, res) => {
  const session = await findOpen(req.storeId);
  if (session && session.opened_by) {
    const opener = await db.get('users', session.opened_by);
    session.opened_by_name = opener ? opener.name : null;
  }
  res.json({ session });
}));

// Open the drawer (start a shift)
router.post('/open', requirePerm('cash.open'), asyncHandler(async (req, res) => {
  const openingAmount = Number(req.body && req.body.opening_amount);
  if (Number.isNaN(openingAmount) || openingAmount < 0) {
    return res.status(400).json({ error: 'Valid opening amount required' });
  }
  const existing = await findOpen(req.storeId);
  if (existing) return res.status(409).json({ error: 'A drawer is already open for this store' });
  const session = await db.insert('cash_sessions', {
    store_id: req.storeId,
    opened_by: req.user.id,
    opened_at: db.now(),
    opening_amount: Math.round(openingAmount * 100) / 100,
  });
  logActivity(req.user, 'cash_open', `Drawer opened · opening ₹${openingAmount.toFixed(2)}`, req.storeId);
  res.status(201).json({ session });
}));

// Close the drawer (end the shift) and return the Z-report
router.post('/close', requirePerm('cash.close'), asyncHandler(async (req, res) => {
  const closingAmount = Number(req.body && req.body.closing_amount);
  if (Number.isNaN(closingAmount) || closingAmount < 0) {
    return res.status(400).json({ error: 'Valid closing amount required' });
  }
  const notes = (req.body && req.body.notes) || null;
  const session = await findOpen(req.storeId);
  if (!session) return res.status(404).json({ error: 'No open drawer for this store' });

  const report = await computeShift(session, req.storeId);
  const variance = Math.round((closingAmount - report.expected_cash) * 100) / 100;

  const updated = await db.update('cash_sessions', session.id, {
    closed_by: req.user.id,
    closed_at: db.now(),
    closing_amount: Math.round(closingAmount * 100) / 100,
    expected_cash: report.expected_cash,
    variance,
    notes,
    report: JSON.stringify(report),
  });
  const userMap = new Map(
    (await db.all('users')).map((u) => [u.id, u])
  );
  updated.opened_by_name = userMap.get(updated.opened_by) ? userMap.get(updated.opened_by).name : null;
  updated.closed_by_name = userMap.get(updated.closed_by) ? userMap.get(updated.closed_by).name : null;
  logActivity(
    req.user,
    'cash_close',
    `Drawer closed · closing ₹${closingAmount.toFixed(2)} · variance ₹${variance.toFixed(2)}`,
    req.storeId
  );
  res.json({ session: updated, report, variance });
}));

// Session history (Z-reports)
router.get('/sessions', requirePerm('cash.view'), asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  let sessions = await db.where(
    'cash_sessions',
    (s) => Number(s.store_id) === Number(req.storeId)
  );
  if (from) sessions = sessions.filter((s) => db.dateOf(s.opened_at) >= from);
  if (to) sessions = sessions.filter((s) => db.dateOf(s.opened_at) <= to);
  sessions.sort((a, b) => b.id - a.id);

  const users = await db.all('users');
  const userMap = new Map(users.map((u) => [u.id, u]));
  res.json({
    sessions: sessions.map((s) => ({
      ...s,
      opened_by_name: s.opened_by && userMap.get(s.opened_by) ? userMap.get(s.opened_by).name : null,
      closed_by_name: s.closed_by && userMap.get(s.closed_by) ? userMap.get(s.closed_by).name : null,
      report: s.report
        ? (() => { try { return JSON.parse(s.report); } catch (e) { return null; } })()
        : null,
    })),
  });
}));

// Z-report for a closed session, or live X-report for an open one
router.get('/report/:id', requirePerm('cash.view'), asyncHandler(async (req, res) => {
  const session = await db.get('cash_sessions', req.params.id);
  if (!session || Number(session.store_id) !== Number(req.storeId)) {
    return res.status(404).json({ error: 'Session not found' });
  }
  const users = await db.all('users');
  const userMap = new Map(users.map((u) => [u.id, u]));
  let report;
  if (session.closed_at && session.report) {
    try { report = JSON.parse(session.report); } catch (e) { report = await computeShift(session, req.storeId); }
  } else {
    report = await computeShift(session, req.storeId);
  }
  res.json({
    session: {
      ...session,
      opened_by_name: userMap.get(session.opened_by) ? userMap.get(session.opened_by).name : null,
      closed_by_name: session.closed_by && userMap.get(session.closed_by) ? userMap.get(session.closed_by).name : null,
    },
    report,
  });
}));

module.exports = router;