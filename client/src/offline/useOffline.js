import { useCallback, useEffect, useState } from 'react';
import {
  subscribeOffline,
  isOnline,
  getPendingCount,
  syncPending,
  refreshCatalog,
} from '../offline/offlineStore';

export default function useOffline() {
  const [online, setOnline] = useState(isOnline());
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setPending(await getPendingCount());
    } catch {
      setPending(0);
    }
  }, []);

  useEffect(() => {
    refresh();
    const unsub = subscribeOffline(() => {
      setOnline(isOnline());
      refresh();
    });
    return unsub;
  }, [refresh]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await syncPending();
      await refreshCatalog();
      setLastSync(result);
      await refresh();
      return result;
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  return { online, pending, syncing, lastSync, syncNow };
}