import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { listInvoices } from '../api/invoices';
import {
  listReturns,
  getInvoiceReturnItems,
  createReturn,
  approveReturn,
  rejectReturn,
} from '../api/returns';
import { exportCsv } from '../api/export';
import { can, PERM } from '../utils/permissions';

export default function Returns() {
  const user = useSelector((s) => s.auth.user);
  const [invoices, setInvoices] = useState([]);
  const [returns, setReturns] = useState([]);
  const [invoiceId, setInvoiceId] = useState('');
  const [invoice, setInvoice] = useState(null);
  const [items, setItems] = useState([]);
  const [qtys, setQtys] = useState({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [rejectId, setRejectId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = async () => {
    try {
      const [inv, ret] = await Promise.all([listInvoices({}), listReturns()]);
      setInvoices(inv.invoices);
      setReturns(ret.returns);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const loadItems = async (id) => {
    if (!id) {
      setInvoice(null);
      setItems([]);
      setQtys({});
      return;
    }
    setError('');
    try {
      const data = await getInvoiceReturnItems(id);
      setInvoice(data.invoice);
      setItems(data.items.filter((i) => i.returnable_qty > 0));
      setQtys({});
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load invoice');
      setInvoice(null);
      setItems([]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMsg('');
    const selected = items
      .filter((i) => Number(qtys[i.product_id]) > 0)
      .map((i) => ({ product_id: i.product_id, qty: Number(qtys[i.product_id]) }));
    if (selected.length === 0) return setError('Select at least one item with a quantity');
    try {
      const { return: ret } = await createReturn({
        invoice_id: invoice.id,
        reason,
        items: selected,
      });
      setMsg(
        ret.status === 'approved'
          ? `Return recorded - refund Rs ${Number(ret.total_refund).toFixed(2)}`
          : `Return request submitted (Rs ${Number(ret.total_refund).toFixed(2)}) - pending manager approval`
      );
      setReason('');
      setInvoiceId('');
      setInvoice(null);
      setItems([]);
      setQtys({});
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create return');
    }
  };

  const handleApprove = async (r) => {
    if (!window.confirm(`Approve return #${r.id} (refund Rs ${Number(r.total_refund).toFixed(2)})? Stock will be restored.`)) return;
    setError('');
    try {
      await approveReturn(r.id);
      load();
    } catch (e) {
      setError(e.response?.data?.error || 'Approval failed');
    }
  };

  const handleReject = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await rejectReturn(rejectId, rejectReason.trim() || undefined);
      setRejectId(null);
      setRejectReason('');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Rejection failed');
    }
  };

  const refundTotal = items.reduce(
    (s, i) => s + (Number(qtys[i.product_id]) || 0) * Number(i.unit_price),
    0
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Returns & Refunds</h1>
        <button
          className="bg-slate-100 text-slate-700 border px-3 py-2 rounded hover:bg-slate-200"
          onClick={() => exportCsv('returns').catch((e) => setError(e.response?.data?.error || 'Export failed'))}
          title="Download returns as CSV"
        >
          Export CSV
        </button>
      </div>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {msg && <div className="text-green-600 text-sm">{msg}</div>}

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-4 space-y-3">
        <h2 className="font-semibold text-slate-700">New Return</h2>
        <select
          className="w-full border rounded px-2 py-1"
          value={invoiceId}
          onChange={(e) => {
            setInvoiceId(e.target.value);
            loadItems(e.target.value);
          }}
        >
          <option value="">Select invoice to return</option>
          {invoices.map((i) => (
            <option key={i.id} value={i.id}>
              {i.invoice_no} - Rs {Number(i.grand_total).toFixed(2)} ({i.payment_mode})
            </option>
          ))}
        </select>

        {invoice && (
          <>
            <div className="text-sm text-slate-500">
              Invoice {invoice.invoice_no} · {new Date(invoice.created_at).toLocaleString()}
            </div>
            {items.length === 0 ? (
              <div className="text-sm text-slate-400">
                No returnable items on this invoice (all already returned).
              </div>
            ) : (
              <div className="table-wrap">
                <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-left">
                  <tr>
                    <th className="p-2">Product</th>
                    <th className="p-2 text-right">Sold</th>
                    <th className="p-2 text-right">Price</th>
                    <th className="p-2 text-right">Return Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.product_id} className="border-t">
                      <td className="p-2">
                        {i.product_name}
                        {i.already_returned > 0 && (
                          <span className="text-xs text-slate-400">
                            {' '}
                            ({i.already_returned} already returned)
                          </span>
                        )}
                      </td>
                      <td className="p-2 text-right">{i.sold_qty}</td>
                      <td className="p-2 text-right">Rs {Number(i.unit_price).toFixed(2)}</td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          min="0"
                          max={i.returnable_qty}
                          className="w-20 border rounded px-2 py-1 text-right"
                          value={qtys[i.product_id] || ''}
                          onChange={(e) => setQtys({ ...qtys, [i.product_id]: e.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
            <input
              className="w-full border rounded px-2 py-1"
              placeholder="Return reason (customer changed mind, damaged, wrong item...)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">
                Refund Total: Rs {refundTotal.toFixed(2)}
              </span>
              <button className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700">
                Record Return
              </button>
            </div>
          </>
        )}
      </form>

      <div className="bg-white rounded-lg shadow table-wrap">
        <h2 className="font-semibold p-4 pb-2 text-slate-700">Return History</h2>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-left">
            <tr>
              <th className="p-2">Date</th>
              <th className="p-2">Invoice</th>
              <th className="p-2">Items</th>
              <th className="p-2">Reason</th>
              <th className="p-2 text-right">Refund</th>
              <th className="p-2">By</th>
              <th className="p-2">Status</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {returns.map((r) => (
              <tr key={r.id} className="border-t align-top">
                <td className="p-2 text-xs">{new Date(r.created_at).toLocaleString()}</td>
                <td className="p-2">{r.invoice_no || '-'}</td>
                <td className="p-2 text-xs">
                  {r.items.map((it) => `${it.product_name} x${it.qty}`).join(', ')}
                </td>
                <td className="p-2 text-xs text-slate-500">{r.reason || '-'}</td>
                <td className="p-2 text-right font-semibold text-red-600">
                  -Rs {Number(r.total_refund).toFixed(2)}
                </td>
                <td className="p-2 text-xs">{r.created_by_name || '-'}</td>
                <td className="p-2">
                  {r.status === 'approved' ? (
                    <span className="text-green-600 font-semibold">Approved</span>
                  ) : r.status === 'rejected' ? (
                    <span className="text-slate-500">
                      Rejected
                      {r.reject_reason ? (
                        <span className="block text-xs">({r.reject_reason})</span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-amber-600 font-semibold">Pending</span>
                  )}
                </td>
                <td className="p-2 text-right whitespace-nowrap">
                  {r.status === 'pending' && can(user, PERM.REFUND_APPROVE) && (
                    <>
                      <button className="text-green-600 mr-2" onClick={() => handleApprove(r)}>
                        Approve
                      </button>
                      <button className="text-red-600" onClick={() => setRejectId(r.id)}>
                        Reject
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {returns.length === 0 && (
              <tr>
                <td colSpan={8} className="p-4 text-center text-slate-400">
                  No returns recorded
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {rejectId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <form
            onSubmit={handleReject}
            className="bg-white p-5 rounded-lg w-[min(92vw,22rem)] space-y-3"
          >
            <h2 className="font-bold text-lg">Reject Return #{rejectId}</h2>
            <input
              className="w-full border rounded px-2 py-1"
              placeholder="Rejection reason (optional)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 bg-red-600 text-white py-2 rounded hover:bg-red-700"
              >
                Reject
              </button>
              <button
                type="button"
                className="flex-1 border py-2 rounded"
                onClick={() => {
                  setRejectId(null);
                  setRejectReason('');
                }}
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
