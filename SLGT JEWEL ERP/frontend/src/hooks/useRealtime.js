import { useEffect } from 'react';
import { getBackendUrl } from '@/lib/api';

/**
 * Connects to the backend WebSocket and dispatches window 'realtime' events.
 * Usage: window.addEventListener('realtime', (e) => { const { type } = e.detail; ... })
 */
export function useRealtime() {
  useEffect(() => {
    let ws = null;
    let retryTimer = null;
    let unmounted = false;

    function connect() {
      if (unmounted) return;
      try {
        const base = getBackendUrl().replace(/^http/, 'ws').replace(/\/$/, '');
        ws = new WebSocket(`${base}/ws`);

        ws.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data?.type && data.type !== 'connected') {
              window.dispatchEvent(new CustomEvent('realtime', { detail: data }));
            }
          } catch { /* */ }
        };

        ws.onclose = () => {
          if (!unmounted) retryTimer = setTimeout(connect, 4000);
        };

        ws.onerror = () => {
          try { ws.close(); } catch { /* */ }
        };
      } catch { /* */ }
    }

    // Delay first connect slightly — backend may still be starting
    retryTimer = setTimeout(connect, 1500);

    return () => {
      unmounted = true;
      clearTimeout(retryTimer);
      try { ws?.close(); } catch { /* */ }
    };
  }, []);
}
