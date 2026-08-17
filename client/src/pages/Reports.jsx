import { useEffect, useState } from 'react';
import {
  getSummary,
  getDaily,
  getTopProducts,
  getPaymentModes,
  getExpenseBreakdown,
  getProfit,
} from '../api/reports';

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

const fmt = (n) => 'Rs ' + Number(n || 0).toLocaleString('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function Reports() {
  const [range, setRange] = useState(defaultRange());
  const [summary, setSummary] = useState(null);
  const [days, setDays] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [modes, setModes] = useState([]);
  const [breakdown, setBreakdown] = useState([]);
  const [profitProducts, setProfitProducts] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async (r) => {
    setError('');
    setLoading(true);
    try {
      const [s, d, t, m, b, pr] = await Promise.all([
        getSummary(r),
        getDaily(r),
        getTopProducts(r),
        getPaymentModes(r),
        getExpenseBreakdown(r),
        getProfit(r),
      ]);
      setSummary(s.summary);
      setDays(d.days);
      setTopProducts(t.products);
      setModes(m.modes);
      setBreakdown(b.breakdown);
      setProfitProducts(pr.products);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(range);
  }, []);

  const maxRevenue = Math.max(...days.map((d) => Number(d.revenue)), 1);

  const exportCsv = () => {
    const lines = [];
    lines.push('Retail Report');
    lines.push(`Period,${range.from},${range.to}`);
    lines.push('');
    lines.push('Summary');
    lines.push('Revenue,' + summary.revenue);
    lines.push('Gross Profit,' + summary.gross_profit);
    lines.push('Expenses,' + summary.expenses);
    lines.push('Returns,' + summary.returns_total);
    lines.push('Net Profit,' + summary.net_profit);
    lines.push('Invoices,' + summary.invoice_count);
    lines.push('');
    lines.push('Daily Sales');
    lines.push('Date,Revenue,Invoices,Expenses');
    days.forEach((d) => lines.push(`${d.day},${d.revenue},${d.invoice_count},${d.expenses}`));
    lines.push('');
    lines.push('Top Products');
    lines.push('Product,Category,Qty Sold,Sales Value');
    topProducts.forEach((p) => lines.push(`${p.name},${p.category_name || ''},${p.qty_sold},${p.sales_value}`));
    lines.push('');
    lines.push('Profit by Product');
    lines.push('Product,Category,Qty Sold,Sales,Cost,Profit,Margin %');
    profitProducts.forEach((p) =>
      lines.push(
        `${p.name},${p.category_name || ''},${p.qty_sold},${p.sales_value},${p.cogs},${p.profit},${(
          Number(p.sales_value) > 0
            ? (Number(p.profit) / Number(p.sales_value)) * 100
            : 0
        ).toFixed(1)}`
      )
    );
    lines.push('');
    lines.push('Payment Modes');
    lines.push('Mode,Count,Total');
    modes.forEach((m) => lines.push(`${m.payment_mode},${m.count},${m.total}`));
    lines.push('');
    lines.push('Expense Breakdown');
    lines.push('Category,Count,Total');
    breakdown.forEach((b) => lines.push(`${b.category},${b.count},${b.total}`));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${range.from}-to-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const cards = summary
    ? [
        { label: 'Revenue', value: fmt(summary.revenue), color: 'text-green-600' },
        { label: 'Gross Profit', value: fmt(summary.gross_profit), color: 'text-blue-600' },
        { label: 'COGS', value: fmt(summary.cogs), color: 'text-slate-600' },
        { label: 'Expenses', value: fmt(summary.expenses), color: 'text-orange-600' },
        { label: 'Returns', value: fmt(summary.returns_total), color: 'text-red-600' },
        { label: 'Net Profit', value: fmt(summary.net_profit), color: 'text-emerald-700' },
        { label: 'Invoices', value: String(summary.invoice_count), color: 'text-slate-700' },
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-800">Sales Reports</h1>
        <div className="flex flex-wrap items-center gap-2 bg-white rounded-lg shadow px-3 py-2">
          <input
            type="date"
            className="border rounded px-2 py-1 text-sm"
            value={range.from}
            onChange={(e) => setRange({ ...range, from: e.target.value })}
          />
          <span className="text-slate-400">to</span>
          <input
            type="date"
            className="border rounded px-2 py-1 text-sm"
            value={range.to}
            onChange={(e) => setRange({ ...range, to: e.target.value })}
          />
          <button
            onClick={() => load(range)}
            className="bg-slate-800 text-white px-3 py-1 rounded text-sm hover:bg-slate-700"
          >
            {loading ? 'Loading...' : 'Apply'}
          </button>
          <button
            onClick={exportCsv}
            disabled={!summary}
            className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700 disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      {error && <div className="text-red-600 text-sm">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-lg shadow p-4">
            <div className="text-xs text-slate-500">{c.label}</div>
            <div className={`text-lg font-bold break-words ${c.color}`}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="font-semibold mb-3 text-slate-700">Daily Revenue vs Expenses</h2>
        {days.length === 0 ? (
          <div className="text-sm text-slate-400">No sales in this period</div>
        ) : (
          <div className="flex items-end gap-1 h-48 overflow-x-auto pb-1">
            {days.map((d) => (
              <div key={d.day} className="flex flex-col items-center justify-end min-w-8 flex-1">
                <div className="relative w-full max-w-8 flex flex-col items-center justify-end h-44">
                  <div
                    title={`${d.day}: Rs ${d.revenue}`}
                    className="w-6 bg-green-500 rounded-t"
                    style={{ height: `${(Number(d.revenue) / maxRevenue) * 100}%` }}
                  />
                  <div
                    title={`${d.day}: expenses Rs ${d.expenses}`}
                    className="w-6 bg-orange-400 rounded-t mt-0.5"
                    style={{ height: `${(Number(d.expenses) / maxRevenue) * 100}%` }}
                  />
                </div>
                <div className="text-[9px] text-slate-400 mt-1">{d.day.slice(5)}</div>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-4 mt-2 text-xs text-slate-500">
          <span><span className="inline-block w-3 h-3 bg-green-500 rounded mr-1" />Revenue</span>
          <span><span className="inline-block w-3 h-3 bg-orange-400 rounded mr-1" />Expenses</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg shadow table-wrap">
          <h2 className="font-semibold p-4 pb-2 text-slate-700">Top Products</h2>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-left">
              <tr>
                <th className="p-2">Product</th>
                <th className="p-2">Category</th>
                <th className="p-2 text-right">Qty</th>
                <th className="p-2 text-right">Sales</th>
              </tr>
            </thead>
            <tbody>
              {topProducts.map((p, i) => (
                <tr key={p.id} className="border-t">
                  <td className="p-2">
                    <span className="text-slate-400 mr-2">{i + 1}.</span>
                    {p.name}
                  </td>
                  <td className="p-2 text-xs">{p.category_name || '-'}</td>
                  <td className="p-2 text-right">{p.qty_sold}</td>
                  <td className="p-2 text-right font-semibold">{fmt(p.sales_value)}</td>
                </tr>
              ))}
              {topProducts.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-slate-400">
                    No sales in this period
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="font-semibold mb-2 text-slate-700">Payment Modes</h2>
            {modes.length === 0 ? (
              <div className="text-sm text-slate-400">No sales in this period</div>
            ) : (
              <div className="space-y-2">
                {modes.map((m) => {
                  const pct = summary ? (Number(m.total) / Math.max(summary.revenue, 1)) * 100 : 0;
                  return (
                    <div key={m.payment_mode}>
                      <div className="flex justify-between text-sm">
                        <span className="capitalize">{m.payment_mode}</span>
                        <span>
                          {m.count} invoices · {fmt(m.total)}
                        </span>
                      </div>
                      <div className="bg-slate-100 rounded h-2 mt-1">
                        <div
                          className="bg-blue-500 rounded h-2"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="font-semibold mb-2 text-slate-700">Expenses by Category</h2>
            {breakdown.length === 0 ? (
              <div className="text-sm text-slate-400">No expenses in this period</div>
            ) : (
              <div className="space-y-2">
                {breakdown.map((b) => {
                  const pct = (Number(b.total) / Math.max(summary.expenses, 1)) * 100;
                  return (
                    <div key={b.category}>
                      <div className="flex justify-between text-sm">
                        <span>{b.category}</span>
                        <span>
                          {b.count}× · {fmt(b.total)}
                        </span>
                      </div>
                      <div className="bg-slate-100 rounded h-2 mt-1">
                        <div
                          className="bg-orange-400 rounded h-2"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow table-wrap">
        <h2 className="font-semibold p-4 pb-2 text-slate-700">Profit by Product</h2>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-left">
            <tr>
              <th className="p-2">Product</th>
              <th className="p-2">Category</th>
              <th className="p-2 text-right">Qty</th>
              <th className="p-2 text-right">Sales</th>
              <th className="p-2 text-right">COGS</th>
              <th className="p-2 text-right">Profit</th>
              <th className="p-2 text-right">Margin %</th>
            </tr>
          </thead>
          <tbody>
            {profitProducts.map((p) => {
              const margin =
                Number(p.sales_value) > 0
                  ? (Number(p.profit) / Number(p.sales_value)) * 100
                  : 0;
              return (
                <tr key={p.id} className="border-t">
                  <td className="p-2">{p.name}</td>
                  <td className="p-2 text-xs">{p.category_name || '-'}</td>
                  <td className="p-2 text-right">{p.qty_sold}</td>
                  <td className="p-2 text-right">{fmt(p.sales_value)}</td>
                  <td className="p-2 text-right">{fmt(p.cogs)}</td>
                  <td className={`p-2 text-right font-semibold ${p.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {fmt(p.profit)}
                  </td>
                  <td className={`p-2 text-right ${margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {margin.toFixed(1)}%
                  </td>
                </tr>
              );
            })}
            {profitProducts.length === 0 && (
              <tr>
                <td colSpan={7} className="p-4 text-center text-slate-400">
                  No sales in this period
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
