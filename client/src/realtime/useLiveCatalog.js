import { useEffect, useState } from 'react';
import { subscribeLive, isLiveReady } from './realtime';

// Re-renders the component whenever the live catalog changes (a product,
// stock level or customer was added/updated on any device).
export default function useLiveCatalog() {
  const [state, setState] = useState(() => ({ version: 0, ready: isLiveReady() }));

  useEffect(() => {
    const unsub = subscribeLive(() => {
      setState((s) => ({ version: s.version + 1, ready: isLiveReady() }));
    });
    return unsub;
  }, []);

  return state;
}