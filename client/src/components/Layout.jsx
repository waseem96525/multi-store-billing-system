import { useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { logout } from '../store/slices/authSlice';
import { setStores, setCurrentStore } from '../store/slices/storeSlice';
import { listStores } from '../api/stores';

export default function Layout() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const user = useSelector((s) => s.auth.user);
  const stores = useSelector((s) => s.store.stores);
  const currentStoreId = useSelector((s) => s.store.currentStoreId);

  useEffect(() => {
    if (user?.role === 'admin') {
      listStores()
        .then(({ stores: list }) => dispatch(setStores(list)))
        .catch(() => {});
    }
  }, [user, dispatch]);

  const handleLogout = () => {
    dispatch(logout());
    navigate('/login');
  };

  const navClass = ({ isActive }) =>
    `block px-3 py-2 rounded-md text-sm font-medium ${
      isActive ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-700 hover:text-white'
    }`;

  return (
    <div className="flex h-screen bg-slate-100">
      <aside className="w-56 bg-slate-800 text-white flex flex-col">
        <div className="p-4 font-bold text-lg border-b border-slate-700">Retail POS</div>
        {user?.role === 'admin' && stores.length > 0 && (
          <div className="px-3 py-2 border-b border-slate-700">
            <label className="text-xs text-slate-400 block mb-1">Current Store</label>
            <select
              value={currentStoreId || ''}
              onChange={(e) => dispatch(setCurrentStore(Number(e.target.value)))}
              className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white"
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <nav className="flex-1 space-y-1 px-2 py-3 overflow-auto">
          {user?.role === 'admin' && (
            <NavLink to="/dashboard" className={navClass}>
              Dashboard
            </NavLink>
          )}
          <NavLink to="/pos" className={navClass}>
            Point of Sale
          </NavLink>
          <NavLink to="/invoices" className={navClass}>
            Sales / Invoices
          </NavLink>
          <NavLink to="/inventory" className={navClass}>
            Inventory
          </NavLink>
          {(user?.role === 'admin' || user?.role === 'inventory') && (
            <>
              <NavLink to="/purchases" className={navClass}>
                Purchases
              </NavLink>
              <NavLink to="/stock" className={navClass}>
                Stock Adjustments
              </NavLink>
              <NavLink to="/returns" className={navClass}>
                Returns / Refunds
              </NavLink>
              <NavLink to="/expenses" className={navClass}>
                Expenses
              </NavLink>
            </>
          )}
          {user?.role === 'admin' && (
            <>
              <NavLink to="/reports" className={navClass}>
                Reports & Charts
              </NavLink>
              <NavLink to="/settings" className={navClass}>
                Shop Settings
              </NavLink>
              <NavLink to="/stores" className={navClass}>
                Stores
              </NavLink>
              <NavLink to="/users" className={navClass}>
                Staff
              </NavLink>
            </>
          )}
        </nav>
        <div className="p-3 border-t border-slate-700 text-sm">
          <div className="font-medium">{user?.name}</div>
          <div className="text-xs text-slate-400 capitalize">{user?.role}</div>
          <button
            onClick={handleLogout}
            className="mt-2 w-full px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs"
          >
            Logout
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
