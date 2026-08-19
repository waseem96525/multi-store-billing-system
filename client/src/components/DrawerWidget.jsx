import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  getCurrentSession,
  openDrawer,
  closeDrawer,
} from '../api/cash';
import { can, PERM } from '../utils/permissions';

const fmt = (n) => 'Rs ' + Number(n || 0).toLocaleString('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Compact cash-drawer widget for the POS header: shows the drawer state and
// lets the cashier open/close the shift without leaving the register.
export default function DrawerWidget() {
  const user = useSelector((s) => s.auth.user);
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [showOpen, setShowOpen] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [openingAmount, setOpeningAmount] = useState('');
  const [closingAmount, setClosingAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    getCurrentSession()
      .then((d) => setSession(d.session))
      .catch(() => {})
      .finally(() => setLoaded(true));
  };

  useEffect(() => {
    load();
  }, []);

  const handleOpen = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await openDrawer(Number(openingAmount) || 0);
      setSession(res.session);
      setShowOpen(false);
      setOpeningAmount('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to open drawer');
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await closeDrawer(Number(closingAmount) || 0, notes.trim() || undefined);
      setSession(null);
      setShowClose(false);
      setClosingAmount('');
      setNotes('');
      navigate('/cashdrawer');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to close drawer');
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return null;
  if (!can(user, PERM.CASH_OPEN) && !can(user, PERM.CASH_CLOSE)) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => (session ? setShowClose(true) : setShowOpen(true))}
        className={`text-xs px-3 py-1.5 rounded-full transition whitespace-nowrap ${
          session
            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
        }`}
        title="Cash drawer / shift"
      >
        {session ? `Drawer open · ${fmt(session.opening_amount)}` : 'Drawer closed'}
      </button>

      {showOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[80]">
          <form
            onSubmit={handleOpen}
            className="bg-white p-5 rounded-lg w-[min(92vw,20rem)] space-y-3"
          >
            <h2 className="font-bold text-lg">Open Cash Drawer</h2>
            <label className="block text-sm text-slate-600">
              Opening cash amount
              <input
                type="number"
                min={0}
                step="0.01"
                className="w-full border rounded px-2 py-1 mt-1"
                value={openingAmount}
                onChange={(e) => setOpeningAmount(e.target.value)}
                autoFocus
              />
            </label>
            {error && <div className="text-red-600 text-sm">{error}</div>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy}
                className="flex-1 bg-green-600 text-white py-2 rounded hover:bg-green-700 disabled:opacity-50"
              >
                {busy ? 'Opening...' : 'Open'}
              </button>
              <button
                type="button"
                className="flex-1 border py-2 rounded"
                onClick={() => setShowOpen(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {showClose && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[80]">
          <form
            onSubmit={handleClose}
            className="bg-white p-5 rounded-lg w-[min(92vw,22rem)] space-y-3"
          >
            <h2 className="font-bold text-lg">Close Drawer / End Shift</h2>
            <p className="text-xs text-slate-500">
              Enter the counted cash. The Z-report (expected vs counted,
              variance) opens after closing.
            </p>
            <label className="block text-sm text-slate-600">
              Counted cash amount
              <input
                type="number"
                min={0}
                step="0.01"
                className="w-full border rounded px-2 py-1 mt-1"
                value={closingAmount}
                onChange={(e) => setClosingAmount(e.target.value)}
                autoFocus
              />
            </label>
            <label className="block text-sm text-slate-600">
              Notes (optional)
              <input
                className="w-full border rounded px-2 py-1 mt-1"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            {error && <div className="text-red-600 text-sm">{error}</div>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy}
                className="flex-1 bg-red-600 text-white py-2 rounded hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? 'Closing...' : 'Close Drawer'}
              </button>
              <button
                type="button"
                className="flex-1 border py-2 rounded"
                onClick={() => setShowClose(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}