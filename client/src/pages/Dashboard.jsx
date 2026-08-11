import { useEffect, useState } from 'react';
import { getDashboard } from '../api/dashboard';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getDashboard()
      .then(setData)
      .catch((e) => setError(e.response?.data?.error || 'Failed to load'));
  }, []);

  if (error) return <div className="text-red-600">{error}</div>;
  if (!data) return <div>Loading...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-lg shadow">
          <div className="text-sm text-slate-500">Sales Today</div>
          <div className="text-2xl font-bold">₹{data.salesToday.total.toFixed(2)}</div>
          <div className="text-xs text-slate-400">{data.salesToday.count} invoices</div>
        </div>
        <div className="bg-white p-5 rounded-lg shadow">
          <div className="text-sm text-slate-500">Low Stock Items</div>
          <div className="text-2xl font-bold text-red-600">{data.lowStock}</div>
        </div>
        <div className="bg-white p-5 rounded-lg shadow">
          <div className="text-sm text-slate-500">Total Products</div>
          <div className="text-2xl font-bold">{data.totalProducts}</div>
        </div>
        <div className="bg-white p-5 rounded-lg shadow">
          <div className="text-sm text-slate-500">Supplier Payables</div>
          <div className="text-2xl font-bold text-amber-600">₹{Number(data.outstandingPayables).toFixed(2)}</div>
        </div>
      </div>

      {data.lowStockItems && data.lowStockItems.length > 0 && (
        <div className="bg-white p-5 rounded-lg shadow">
          <h2 className="font-semibold mb-3 text-slate-700">Low Stock Alerts</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b">
                <th className="py-1">Product</th>
                <th>Current</th>
                <th>Reorder</th>
              </tr>
            </thead>
            <tbody>
              {data.lowStockItems.map((p) => (
                <tr key={p.id} className="border-b text-red-600">
                  <td className="py-1">{p.name}</td>
                  <td>{p.stock_qty}</td>
                  <td>{p.reorder_level}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-white p-5 rounded-lg shadow">
        <h2 className="font-semibold mb-3 text-slate-700">Top Selling Products</h2>
        {data.topProducts.length === 0 ? (
          <div className="text-slate-400 text-sm">No sales yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b">
                <th className="py-1">Product</th>
                <th>Qty Sold</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.topProducts.map((p) => (
                <tr key={p.name} className="border-b">
                  <td className="py-1">{p.name}</td>
                  <td>{p.qty_sold}</td>
                  <td>₹{Number(p.revenue).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
