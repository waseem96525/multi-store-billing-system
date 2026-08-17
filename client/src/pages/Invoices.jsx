import { useEffect, useState } from 'react';
import { listInvoices, getInvoice } from '../api/invoices';
import { printReceipt } from '../utils/print';
import { exportCsv } from '../api/export';
import SendInvoiceButtons from '../components/SendInvoiceButtons';

export default function Invoices() {
  const [invoices, setInvoices] = useState([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);

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

  const fmt = (n) => `₹${Number(n).toFixed(2)}`;

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
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr
                key={inv.id}
                className="border-t cursor-pointer hover:bg-slate-50"
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
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-slate-400">
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
    </div>
  );
}
