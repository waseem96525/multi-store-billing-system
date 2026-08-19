import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import {
  getCurrentSession,
  openDrawer,
  closeDrawer,
  listSessions,
  getSessionReport,
} from '../api/cash';
import { can, PERM } from '../utils/permissions';
import { printReceipt } from '../utils/print';

const fmt = (n) =>
  'Rs ' + Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function ReportView({ session, report }) {
  if (!report) return null;
  const open = !session.closed_at;
  return (
    <div>
      <div id="cash-report" className="text-sm space-y-2">
        <div className="text-center font-bold">
          {open ? 'X REPORT (interim)' : 'Z REPORT'}
        </div>
        <div className="text-center text-xs text-slate-500">
          Opened: {new Date(report.opened_at).toLocaleString()}
          {session.closed_at
            ? ` · Closed: ${new Date(session.closed_at).toLocaleString()}`
            : ' · still open'}
          <br />
          Opened by: {session.opened_by_name || '-'}
          {session.closed_by_name ? ` · Closed by: ${session.closed_by_name}` : ''}
        </div>
        <div className="border-t pt-2">
          <div className="flex justify-between">
            <span>Opening amount</span>
            <span>{fmt(report.opening_amount)}</span>
          </div>
          <div className="flex justify-between">
            <span>Cash sales</span>
            <span>{fmt(report.cash)}</span>
          </div>
          <div className="flex justify-between">
            <span>Card sales</span>
            <span>{fmt(report.card)}</span>
          </div>
          <div className="flex justify-between">
            <span>UPI sales</span>
            <span>{fmt(report.upi)}</span>
          </div>
          <div className="flex justify-between">
            <span>Credit sales (total)</span>
            <span>{fmt(report.credit_total)}</span>
          </div>
          <div className="flex justify-between">
            <span>Credit pending</span>
            <span>{fmt(report.credit_pending)}</span>
          </div>
          <div className="flex justify-between">
            <span>Refunds (cash)</span>
            <span>{fmt(report.cash_refunds)}</span>
          </div>
          <div className="flex justify-between">
            <span>Expenses</span>
            <span>{fmt(report.expenses_total)}</span>
          </div>
          <div className="flex justify-between border-t mt-1 pt-1">
            <span className="font-semibold">Expected cash in drawer</span>
            <span className="font-semibold">{fmt(report.expected_cash)}</span>
          </div>
          {!open && (
            <>
              <div className="flex justify-between">
                <span>Counted (closing) amount</span>
                <span>{fmt(session.closing_amount)}</span>
              </div>
              <div
                className={`flex justify-between font-bold ${
                  Number(session.variance) === 0
                    ? ''
                    : Number(session.variance) > 0
                      ? 'text-green-600'
                      : 'text-red-600'
                }`}
              >
                <span>Variance</span>
                <span>{fmt(session.variance)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between text-xs text-slate-500 mt-1">
            <span>Invoices</span>
            <span>{report.invoice_count}</span>
          </div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>Items sold</span>
            <span>{report.item_count}</span>
          </div>
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button
          className="flex-1 bg-slate-800 text-white py-2 rounded"
          onClick={printReceipt}
        >
          Print
        </button>
      </div>
    </div>
  );
}

export default function CashDrawer() {
  const user = useSelector((s) => s.auth.user);
  const [session, setSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [showOpen, setShowOpen] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [openingAmount, setOpeningAmount] = useState('');
  const [closingAmount, setClosingAmount] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [closeResult, setCloseResult] = useState(null);
  const [reportView, setReportView] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setError('');
    try {
      const cur = getCurrentSession();
      const list = can(user, PERM.CASH_VIEW) ? listSessions() : Promise.resolve({ sessions: [] });
      const [curRes, listRes] = await Promise.all([cur, list]);
      setSession(curRes.session);
      setSessions(listRes.sessions || []);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleOpen = async (e) => {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      const res = await openDrawer(Number(openingAmount) || 0);
      setSession(res.session);
      setShowOpen(false);
      setOpeningAmount('');
      setMsg('Drawer opened');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to open drawer');
    }
  };

  const handleClose = async (e) => {
    e.preventDefault();
    setError('');
    setMsg('');
    setLoading(true);
    try {
      const res = await closeDrawer(Number(closingAmount) || 0, closeNotes.trim() || undefined);
      setCloseResult(res);
      setSession(null);
      setShowClose(false);
      setClosingAmount('');
      setCloseNotes('');
      setMsg('Drawer closed');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to close drawer');
    } finally {
      setLoading(false);
    }
  };

  const viewReport = async (id) => {
    setError('');
    try {
      const d = await getSessionReport(id);
      setReportView(d);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load report');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-800">Cash Drawer</h1>
        {session && can(user, PERM.CASH_CLOSE) ? (
          <button
            className="bg-red-600 text-white px-3 py-2 rounded hover:bg-red-700"
            onClick={() => setShowClose(true)}
          >
            Close Drawer / End Shift
          </button>
        ) : (
          can(user, PERM.CASH_OPEN) && (
            <button
              className="bg-green-600 text-white px-3 py-2 rounded hover:bg-green-700"
              onClick={() => setShowOpen(true)}
            >
              Open Drawer
            </button>
          )
        )}
      </div>

      {error && <div className="text-red-600 text-sm">{error}</div>}
      {msg && <div className="text-green-600 text-sm">{msg}</div>}

      {session && (
        <div className="bg-white rounded-lg shadow p-4 flex flex-wrap items-center gap-4">
          <div>
            <div className="text-xs text-slate-500">Drawer open</div>
            <div className="font-bold text-green-600">OPEN</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Opened</div>
            <div className="font-semibold">
              {new Date(session.opened_at).toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Opening amount</div>
            <div className="font-semibold">{fmt(session.opening_amount)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Opened by</div>
            <div className="font-semibold">{session.opened_by_name || '-'}</div>
          </div>
          {can(user, PERM.CASH_VIEW) && (
            <button
              className="ml-auto bg-slate-800 text-white px-3 py-2 rounded text-sm hover:bg-slate-700"
              onClick={() => viewReport(session.id)}
            >
              View X Report
            </button>
          )}
        </div>
      )}

      {can(user, PERM.CASH_VIEW) && (
        <div className="bg-white rounded-lg shadow table-wrap">
          <h2 className="font-semibold p-4 pb-2 text-slate-700">Shift History (Z Reports)</h2>
        {sessions.length === 0 ? (
          <div className="p-4 text-sm text-slate-400">No shifts recorded yet</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-left">
              <tr>
                <th className="p-2">Opened</th>
                <th className="p-2">Closed</th>
                <th className="p-2">By</th>
                <th className="p-2 text-right">Opening</th>
                <th className="p-2 text-right">Expected</th>
                <th className="p-2 text-right">Counted</th>
                <th className="p-2 text-right">Variance</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="p-2">{new Date(s.opened_at).toLocaleString()}</td>
                  <td className="p-2">
                    {s.closed_at ? new Date(s.closed_at).toLocaleString() : (
                      <span className="text-green-600 font-semibold">Open</span>
                    )}
                  </td>
                  <td className="p-2">
                    {s.opened_by_name || '-'}
                    {s.closed_by_name ? ` / ${s.closed_by_name}` : ''}
                  </td>
                  <td className="p-2 text-right">{fmt(s.opening_amount)}</td>
                  <td className="p-2 text-right">
                    {s.expected_cash !== undefined && s.expected_cash !== null
                      ? fmt(s.expected_cash)
                      : '-'}
                  </td>
                  <td className="p-2 text-right">
                    {s.closing_amount !== undefined && s.closing_amount !== null
                      ? fmt(s.closing_amount)
                      : '-'}
                  </td>
                  <td
                    className={`p-2 text-right font-semibold ${
                      Number(s.variance) === 0
                        ? ''
                        : Number(s.variance) > 0
                          ? 'text-green-600'
                          : 'text-red-600'
                    }`}
                  >
                    {s.variance !== undefined && s.variance !== null
                      ? fmt(s.variance)
                      : '-'}
                  </td>
                  <td className="p-2 text-right">
                    {can(user, PERM.CASH_VIEW) && (
                      <button
                        className="text-blue-600"
                        onClick={() => viewReport(s.id)}
                      >
                        Report
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        </div>
      )}

      {showOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
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
            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 bg-green-600 text-white py-2 rounded hover:bg-green-700"
              >
                Open
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <form
            onSubmit={handleClose}
            className="bg-white p-5 rounded-lg w-[min(92vw,22rem)] space-y-3"
          >
            <h2 className="font-bold text-lg">Close Drawer / End Shift</h2>
            <p className="text-xs text-slate-500">
              Count the cash in the drawer and enter it below. The system
              compares it against the expected amount (opening + cash sales -
              cash refunds - expenses).
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
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
              />
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-red-600 text-white py-2 rounded hover:bg-red-700 disabled:opacity-50"
              >
                {loading ? 'Closing...' : 'Close Drawer'}
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

      {closeResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-5 rounded-lg w-[min(92vw,24rem)] max-h-[90vh] overflow-auto">
            <h2 className="font-bold text-lg mb-2">Shift Closed</h2>
            <ReportView session={closeResult.session} report={closeResult.report} />
            <button
              className="w-full border py-2 rounded mt-3"
              onClick={() => setCloseResult(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {reportView && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-5 rounded-lg w-[min(92vw,24rem)] max-h-[90vh] overflow-auto">
            <ReportView session={reportView.session} report={reportView.report} />
            <button
              className="w-full border py-2 rounded mt-3"
              onClick={() => setReportView(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}