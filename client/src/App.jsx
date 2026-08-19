import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import POS from './pages/POS';
import Invoices from './pages/Invoices';
import Inventory from './pages/Inventory';
import Purchases from './pages/Purchases';
import Stock from './pages/Stock';
import Users from './pages/Users';
import Reports from './pages/Reports';
import Activity from './pages/Activity';
import Expenses from './pages/Expenses';
import Returns from './pages/Returns';
import Settings from './pages/Settings';
import Stores from './pages/Stores';
import Transfers from './pages/Transfers';
import CashDrawer from './pages/CashDrawer';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/pos" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/pos" element={<POS />} />
          <Route path="/invoices" element={<Invoices />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/purchases" element={<Purchases />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/users" element={<Users />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/returns" element={<Returns />} />
          <Route path="/transfers" element={<Transfers />} />
          <Route path="/cashdrawer" element={<CashDrawer />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/stores" element={<Stores />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
