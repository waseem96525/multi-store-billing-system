import { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { logout } from '../store/slices/authSlice';
import { setStores, setCurrentStore } from '../store/slices/storeSlice';
import { listStores } from '../api/stores';

export default function Layout() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
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

  const storeSwitcher =
    user?.role === 'admin' && stores.length > 0 ? (
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
    ) : null;

  const sidebarContent = (
    <>
      <div className="p-4 font-bold text-lg border-b border-slate-700">Retail POS</div>
      {storeSwitcher}
      <nav className="flex-1 space-y-1 px-2 py-3 overflow-auto">
        {user?.role === 'admin' && (
          <NavLink to="/dashboard" className={navClass} onClick={() => setMenuOpen(false)}>
            Dashboard
          </NavLink>
        )}
        <NavLink to="/pos" className={navClass} onClick={() => setMenuOpen(false)}>
          Point of Sale
        </NavLink>
        <NavLink to="/invoices" className={navClass} onClick={() => setMenuOpen(false)}>
          Sales / Invoices
        </NavLink>
        <NavLink to="/inventory" className={navClass} onClick={() => setMenuOpen(false)}>
          Inventory
        </NavLink>
        {(user?.role === 'admin' || user?.role === 'inventory') && (
          <>
            <NavLink to="/purchases" className={navClass} onClick={() => setMenuOpen(false)}>
              Purchases
            </NavLink>
            <NavLink to="/stock" className={navClass} onClick={() => setMenuOpen(false)}>
              Stock Adjustments
            </NavLink>
            <NavLink to="/returns" className={navClass} onClick={() => setMenuOpen(false)}>
              Returns / Refunds
            </NavLink>
            <NavLink to="/expenses" className={navClass} onClick={() => setMenuOpen(false)}>
              Expenses
            </NavLink>
          </>
        )}
        {user?.role === 'admin' && (
          <>
            <NavLink to="/reports" className={navClass} onClick={() => setMenuOpen(false)}>
              Reports & Charts
            </NavLink>
            <NavLink to="/settings" className={navClass} onClick={() => setMenuOpen(false)}>
              Shop Settings
            </NavLink>
            <NavLink to="/stores" className={navClass} onClick={() => setMenuOpen(false)}>
              Stores
            </NavLink>
            <NavLink to="/users" className={navClass} onClick={() => setMenuOpen(false)}>
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
    </>
  );

  return (
    <div className="flex h-screen bg-slate-100">
      {/* Mobile top bar */}
      <header className="lg:hidden fixed top-0 inset-x-0 z-40 bg-slate-800 text-white flex items-center justify-between px-3 py-2.5 shadow">
        <button
          onClick={() => setMenuOpen(true)}
          className="p-1.5 -ml-1 rounded hover:bg-slate-700"
          aria-label="Open menu"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="font-bold">Retail POS</div>
        <div className="w-8" />
      </header>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50 animate-fade-in"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-64 max-w-[85vw] bg-slate-800 text-white flex flex-col shadow-xl animate-slide-left">
            <div className="flex justify-end p-2 border-b border-slate-700">
              <button
                onClick={() => setMenuOpen(false)}
                className="p-1.5 text-slate-300 hover:text-white"
                aria-label="Close menu"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-56 bg-slate-800 text-white flex-col">
        {sidebarContent}
      </aside>

      <main className="flex-1 overflow-auto p-4 pt-14 lg:p-6 lg:pt-6">
        <Outlet />
      </main>
    </div>
  );
}
