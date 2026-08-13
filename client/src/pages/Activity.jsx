import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { listActivity, listActivityUsers } from '../api/activity';

const ACTION_COLORS = {
  login: 'text-blue-600',
  sale: 'text-emerald-600',
  purchase: 'text-blue-600',
  return: 'text-amber-600',
  transfer: 'text-purple-600',
  expense: 'text-orange-600',
  expense_deleted: 'text-red-600',
  stock_adjustment: 'text-teal-600',
  product_created: 'text-green-600',
  product_updated: 'text-slate-600',
  product_deleted: 'text-red-600',
  user_created: 'text-green-600',
  user_updated: 'text-slate-600',
};

export default function Activity() {
  const user = useSelector((s) => s.auth.user);
  const [logs, setLogs] = useState([]);
  const [actions, setActions] = useState([]);
  const [users, setUsers] = useState([]);
  const [actionFilter, setActionFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [limit, setLimit] = useState(300);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const params = { limit };
      if (actionFilter) params.action = actionFilter;
      if (userFilter) params.user_id = userFilter;
      const data = await listActivity(params);
      setLogs(data.logs);
      setActions(data.actions);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load activity log');
    }
  };

  useEffect(() => {
    load();
    listActivityUsers()
      .then((d) => setUsers(d.users))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [actionFilter, userFilter, limit]);

  if (user?.role !== 'admin') {
    return <div className="text-red-600 text-sm">This page is only available to administrators.</div>;
  }

  const color = (action) => ACTION_COLORS[action] || 'text-slate-600';

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-800">Activity Log</h1>
        <div className="flex flex-wrap gap-2">
          <select
            className="border rounded px-2 py-1 text-sm"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          >
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
          >
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            <option value={100}>Last 100</option>
            <option value={300}>Last 300</option>
            <option value={1000}>Last 1000</option>
          </select>
          <button
            onClick={load}
            className="bg-slate-800 text-white px-3 py-1 rounded text-sm hover:bg-slate-700"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="text-red-600 text-sm">{error}</div>}

      <div className="bg-white rounded-lg shadow table-wrap">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr className="text-left">
              <th className="p-2">When</th>
              <th className="p-2">User</th>
              <th className="p-2">Action</th>
              <th className="p-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-2 text-xs whitespace-nowrap">
                  {new Date(l.created_at + (l.created_at.includes('T') ? '' : 'Z')).toLocaleString()}
                </td>
                <td className="p-2">{l.user_name || 'system'}</td>
                <td className={`p-2 font-medium capitalize ${color(l.action)}`}>{l.action.replace(/_/g, ' ')}</td>
                <td className="p-2 text-slate-500">{l.details || '-'}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={4} className="p-4 text-center text-slate-400">
                  No activity recorded yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
