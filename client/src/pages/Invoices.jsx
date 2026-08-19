import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { listInvoices, getInvoice, voidInvoice, editInvoice } from '../api/invoices';
import { printReceipt } from '../utils/print';
import { exportCsv } from '../api/export';
import SendInvoiceButtons from '../components/SendInvoiceButtons';
import { can, PERM } from '../utils/permissions';

const fmt = (n) => `₹${Number(n).toFixed(2)}`;

export default function Invoices() {
  const user = useSelector((s) => s.auth.user);
  const [invoices, setInvoices] = useState([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [showVoid, setShowVoid] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [showEdit, setShowEdit] = useState(false);
  const [editItems, setEditItems] = useState([]);
  const [editDiscount, setEditDiscount] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const data = await listInvoices({ q: q || undefined });
      setInvoices(data.invoices);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load');
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [q]);

  const openDetail = async (id) => {
    try {
      const d = await getInvoice(id);
      setDetail(d);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load invoice');
    }
  };

  const canVoid = detail && detail.invoice.status !== 'void';

  const handleVoid = async (e) => {
    e.preventDefault();
    if (!voidReason.trim()) return;
    setBusy(true);
    setError('');
    try {
      await voidInvoice(detail.invoice.id, voidReason.trim());
      setShowVoid(false);
      setVoidReason('');
      setDetail(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Void failed');
    } finally {
      setBusy(false);
    }
  };

  const openEdit = () => {
    setError('');
    setEditItems(
      detail.items.map((it) => ({
        product_id: it.product_id,
        name: it.product_name,
        qty: it.qty,
        unit_price: it.unit_price,
        discount: it.discount || 0,
        tax_percent: it.tax_percent || 0,
      }))
    );
    setEditDiscount(detail.invoice.discount || 0);
    setShowEdit(true);
  };

  const updateEditItem = (i, patch) => {
    setEditItems((list) => list.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  };

  const editTotals = editItems.reduce(
    (acc, it) => {
      const sub = Number(it.unit_price) * Number(it.qty);
      const disc = Math.min(Number(it.discount) || 0, sub);
      const taxable = sub - disc;
      const line = taxable + (taxable * (it.tax_percent || 0)) / 100;
      acc.subtotal += sub;
      acc.discount += disc;
      acc.total += line;
      return acc;
    },
    { subtotal: 0, discount: 0, total: 0 }
  );

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await editInvoice(detail.invoice.id, {
        items: editItems.map((it) => ({
          product_id: it.product_id,
          qty: Number(it.qty),
          unit_price: Number(it.unit_price),
          discount: Number(it.discount) || 0,
        })),
        discount: Number(editDiscount) || 0,
      });
      setShowEdit(false);
      setDetail(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-800">Sales / Invoices</h1>
        <div className="flex items-center gap-2">
          <input
            className="border rounded px-3 py-2 w-full sm:w-64"
            placeholder="Search invoice no..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            className="bg-slate-100 text-slate-700 border px-3 py-2 rounded hover:bg-slate-200 whitespace-nowrap"
            onClick={() => exportCsv('invoices').catch((e) => setError(e.response?.data?.error || 'Export failed'))}
            title="Download sales as CSV"
          >
            Export CSV
          </button>
        </div>
      </div>

      {error && <div className="text-red-600 text-sm">{error}</div>}

      <div className="bg-white rounded-lg shadow table-wrap">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr className="text-left">
              <th className="p-2">Invoice</th>
              <th className="p-2">Date</th>
              <th className="p-2">Cashier</th>
              <th className="p-2 text-right">Items</th>
              <th className="p-2 text-right">Total</th>
              <th className="p-2">Mode</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr
                key={inv.id}
                className={`border-t cursor-pointer hover:bg-slate-50 ${inv.status === 'void' ? 'opacity-60' : ''}`}
                onClick={() => openDetail(inv.id)}
              >
                <td className="p-2 font-medium text-blue-600">{inv.invoice_no}</td>
                <td className="p-2 text-slate-500">
                  {new Date(inv.created_at).toLocaleString()}
                </td>
                <td className="p-2">{inv.cashier_name || '-'}</td>
                <td className="p-2 text-right">{inv.item_count}</td>
                <td className="p-2 text-right font-semibold">{fmt(inv.grand_total)}</td>
                <td className="p-2 capitalize">{inv.payment_mode}</td>
                <td className="p-2">
                  {inv.status === 'void' ? (
                    <span className="text-red-600 font-semibold">VOID</span>
                  ) : inv.status === 'credit' ? (
                    <span className="text-amber-600 font-semibold">CREDIT</span>
                  ) : (
                    <span className="text-green-600">Paid</span>
                  )}
                </td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={7} className="p-4 text-center text-slate-400">
                  No sales found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg w-[min(92vw,24rem)] max-h-[90vh] overflow-auto">
            <div id="receipt" className="text-sm">
              <div className="text-center font-bold mb-1">{detail.store?.name || 'RETAIL SHOP'}</div>
              {detail.store?.address && (
                <div className="text-center text-xs text-slate-600">{detail.store.address}</div>
              )}
              {detail.store?.phone && (
                <div className="text-center text-xs text-slate-600">Ph: {detail.store.phone}</div>
              )}
              {detail.store?.gstin && (
                <div className="text-center text-xs text-slate-600">GSTIN: {detail.store.gstin}</div>
              )}
              <div className="text-center text-xs mb-3">
                Invoice: {detail.invoice.invoice_no}
                <br />
                {new Date(detail.invoice.created_at).toLocaleString()}
                <br />
                Cashier: {detail.cashier?.name}
                {detail.invoice.status === 'credit' && (
                  <span className="text-amber-600"> · CREDIT</span>
                )}
                {detail.invoice.status === 'void' && (
                  <span className="text-red-600 font-semibold"> · VOIDED</span>
                )}
              </div>
              <table className="w-full">
                <tbody>
                  {detail.items.map((it) => (
                    <tr key={it.id}>
                      <td>
                        {it.product_name}
                        <br />
                        <span className="text-xs">
                          {it.qty} x ₹{it.unit_price}
                          {it.discount ? ` (-₹${it.discount})` : ''}
                        </span>
                      </td>
                      <td className="text-right">{fmt(it.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t mt-2 pt-2">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{fmt(detail.invoice.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tax</span>
                  <span>{fmt(detail.invoice.tax_total)}</span>
                </div>
                {detail.invoice.item_discount > 0 && (
                  <div className="flex justify-between">
                    <span>Item Discount</span>
                    <span>{fmt(detail.invoice.item_discount)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Discount</span>
                  <span>{fmt(detail.invoice.discount)}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>Total</span>
                  <span>{fmt(detail.invoice.grand_total)}</span>
                </div>
                <div className="text-xs mt-1">Mode: {detail.invoice.payment_mode}</div>
              </div>
              {detail.invoice.status === 'void' && (
                <div className="mt-2 text-xs border border-red-200 bg-red-50 rounded p-2 text-red-700">
                  <b>Voided</b> {detail.invoice.voided_at ? new Date(detail.invoice.voided_at).toLocaleString() : ''}
                  <br />
                  Reason: {detail.invoice.void_reason || '-'}
                  {detail.invoice.edited_at && (
                    <>
                      <br />
                      <b>Edited</b> {new Date(detail.invoice.edited_at).toLocaleString()}
                    </>
                  )}
                </div>
              )}
              {detail.store?.receipt_footer ? (
                <div className="text-center text-xs mt-3">{detail.store.receipt_footer}</div>
              ) : (
                <div className="text-center text-xs mt-3">Thank you!</div>
              )}
            </div>
            {detail.customer?.name && (
              <div className="text-xs text-slate-500 mt-1">
                Customer: {detail.customer.name}
                {detail.customer.phone ? ` · ${detail.customer.phone}` : ''}
              </div>
            )}
            <SendInvoiceButtons detail={detail} className="mt-3" />
            <div className="mt-4 flex gap-2 no-print">
              {canVoid && can(user, PERM.INVOICE_VOID) && (
                <button
                  className="flex-1 bg-red-600 text-white py-2 rounded"
                  onClick={() => setShowVoid(true)}
                >
                  Void
                </button>
              )}
              {canVoid && can(user, PERM.INVOICE_EDIT) && (
                <button
                  className="flex-1 bg-amber-600 text-white py-2 rounded"
                  onClick={openEdit}
                >
                  Edit
                </button>
              )}
              <button
                className="flex-1 bg-slate-800 text-white py-2 rounded"
                onClick={printReceipt}
              >
                Print
              </button>
              <button
                className="flex-1 border py-2 rounded"
                onClick={() => setDetail(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showVoid && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
          <form
            onSubmit={handleVoid}
            className="bg-white p-5 rounded-lg w-[min(92vw,22rem)] space-y-3"
          >
            <h2 className="font-bold text-lg">Void Invoice {detail?.invoice.invoice_no}</h2>
            <p className="text-xs text-slate-500">
              Voiding restores the un-returned items to stock and marks this
              invoice as void permanently. This is recorded in the audit log.
            </p>
            <textarea
              className="w-full border rounded px-2 py-1"
              rows={3}
              placeholder="Reason for voiding *"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              autoFocus
              required
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy || !voidReason.trim()}
                className="flex-1 bg-red-600 text-white py-2 rounded hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? 'Voiding...' : 'Confirm Void'}
              </button>
              <button
                type="button"
                className="flex-1 border py-2 rounded"
                onClick={() => setShowVoid(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {showEdit && detail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
          <form
            onSubmit={handleSaveEdit}
            className="bg-white p-5 rounded-lg w-[min(94vw,34rem)] max-h-[90vh] overflow-auto space-y-3"
          >
            <h2 className="font-bold text-lg">Edit Invoice {detail.invoice.invoice_no}</h2>
            <p className="text-xs text-slate-500">
              Change quantities, prices or discounts. Stock is reconciled
              automatically and the change is recorded in the audit log.
            </p>
            <div className="space-y-2">
              {editItems.map((it, i) => (
                <div key={i} className="flex items-center gap-2 border rounded p-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{it.name}</div>
                    <div className="text-xs text-slate-400">
                      line total: {fmt(
                        Math.max(0, Number(it.unit_price) * Number(it.qty) - (Number(it.discount) || 0))
                      )}
                    </div>
                  </div>
                  <input
                    type="number"
                    min={1}
                    className="w-16 border rounded px-1 py-1 text-center"
                    title="Qty"
                    value={it.qty}
                    onChange={(e) => updateEditItem(i, { qty: e.target.value })}
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="w-24 border rounded px-1 py-1"
                    title="Unit price"
                    value={it.unit_price}
                    onChange={(e) => updateEditItem(i, { unit_price: e.target.value })}
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="w-24 border rounded px-1 py-1"
                    title="Discount"
                    value={it.discount}
                    onChange={(e) => updateEditItem(i, { discount: e.target.value })}
                  />
                  <button
                    type="button"
                    className="text-red-600"
                    onClick={() => setEditItems((l) => l.filter((_, idx) => idx !== i))}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                Bill discount
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="w-28 border rounded px-2 py-1"
                  value={editDiscount}
                  onChange={(e) => setEditDiscount(e.target.value)}
                />
              </label>
              <div className="ml-auto text-right">
                <div className="text-xs text-slate-500">
                  Subtotal {fmt(editTotals.subtotal)} · Item disc {fmt(editTotals.discount)}
                </div>
                <div className="font-bold">
                  New total ≈ {fmt(Math.max(0, editTotals.total - Number(editDiscount || 0)))}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy || editItems.length === 0}
                className="flex-1 bg-green-600 text-white py-2 rounded hover:bg-green-700 disabled:opacity-50"
              >
                {busy ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                type="button"
                className="flex-1 border py-2 rounded"
                onClick={() => setShowEdit(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}