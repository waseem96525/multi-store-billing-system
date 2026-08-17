import useOffline from '../offline/useOffline';

export default function OfflineBanner() {
  const { online, pending, syncing, lastSync, syncNow } = useOffline();

  if (online && pending === 0) return null;

  const syncedCount = lastSync?.synced?.length || 0;
  const failedCount = lastSync?.failed?.length || 0;

  return (
    <div className="sticky top-0 z-30">
      {!online && (
        <div className="bg-amber-500 text-white text-xs font-medium px-3 py-1.5 text-center">
          Offline mode — billing keeps working. New bills are saved on this
          device and sync automatically when the internet returns.
        </div>
      )}
      {online && pending > 0 && (
        <div className="bg-slate-800 text-white text-xs font-medium px-3 py-1.5 flex items-center justify-center gap-3">
          <span>
            {pending} bill(s) waiting to sync
            {syncedCount > 0 && <span className="text-emerald-400"> · {syncedCount} synced</span>}
            {failedCount > 0 && <span className="text-red-400"> · {failedCount} failed</span>}
          </span>
          <button
            onClick={syncNow}
            disabled={syncing}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-2 py-0.5 rounded text-white"
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      )}
    </div>
  );
}