import { useEffect, useState } from 'react';
import { listUsers, register, setUserActive } from '../api/auth';
import { listStores } from '../api/stores';

const EMPTY = { name: '', username: '', email: '', password: '', role: 'cashier', store_id: '' };

export default function Users() {
  const [users, setUsers] = useState([]);
  const [stores, setStores] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    try {
      const [data, storeData] = await Promise.all([listUsers(), listStores()]);
      setUsers(data.users);
      setStores(storeData.stores || []);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      await register({ ...form, store_id: form.store_id || undefined });
      setForm(EMPTY);
      setMsg('Staff created');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create');
    }
  };

  const toggleActive = async (u) => {
    try {
      await setUserActive(u.id, { active: !u.active });
      load();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed');
    }
  };

  const changeStore = async (u, storeId) => {
    try {
      await setUserActive(u.id, { store_id: Number(storeId) });
      load();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to change store');
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-800">Staff Management</h1>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {msg && <div className="text-green-600 text-sm">{msg}</div>}

      <div className="bg-white rounded-lg shadow p-4 max-w-md">
        <h2 className="font-semibold mb-2 text-slate-700">Add Staff</h2>
        <form onSubmit={handleSubmit} className="space-y-2">
          <input
            className="w-full border rounded px-2 py-1"
            placeholder="Full Name *"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <input
            type="email"
            className="w-full border rounded px-2 py-1"
            placeholder="Email (login id) *"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <input
            className="w-full border rounded px-2 py-1"
            placeholder="Username (optional)"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
          <input
            type="password"
            className="w-full border rounded px-2 py-1"
            placeholder="Password (min 6 chars) *"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <select
            className="w-full border rounded px-2 py-1"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            <option value="cashier">Cashier</option>
            <option value="inventory">Inventory Manager</option>
            <option value="manager">Store Manager</option>
            <option value="admin">Admin</option>
          </select>
          <select
            className="w-full border rounded px-2 py-1"
            value={form.store_id}
            onChange={(e) => setForm({ ...form, store_id: e.target.value })}
          >
            <option value="">Assign to store (default: your store)</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700">
            Create Staff
          </button>
        </form>
      </div>

      <div className="bg-white rounded-lg shadow table-wrap">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-left">
            <tr>
              <th className="p-2">Name</th>
              <th className="p-2">Username</th>
              <th className="p-2">Role</th>
              <th className="p-2">Store</th>
              <th className="p-2">Status</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="p-2">{u.name}</td>
                <td className="p-2">{u.username}</td>
                <td className="p-2 capitalize">{u.role}</td>
                <td className="p-2">
                  <select
                    className="border rounded px-1 py-0.5 text-xs"
                    value={u.store_id || ''}
                    onChange={(e) => changeStore(u, e.target.value)}
                  >
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="p-2">{u.active ? 'Active' : 'Inactive'}</td>
                <td className="p-2 text-right">
                  <button className="text-blue-600" onClick={() => toggleActive(u)}>
                    {u.active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
