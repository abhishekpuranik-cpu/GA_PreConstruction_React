import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isMongoAutsaveEnabled } from '../../ga_mongo/mongoStateClient.js';

function apiPath(path) {
  const base = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
  return base ? `${base}${path}` : path;
}

/**
 * Loads / saves PreConstruction reducer state to Golden Abodes Platform MongoDB.
 * Dev: run platform API on :3020 with Vite proxy `/api`, or set VITE_API_BASE to full API origin.
 */
export function MongoSyncAdapter({ state, dispatch, toast }) {
  const [syncReady, setSyncReady] = useState(false);
  const saveTimer = useRef(null);
  const stateRef = useRef(state);
  const versionRef = useRef(0);
  const notifiedRemoteVersion = useRef(0);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const r = await fetch(apiPath('/api/preconstruction-state'), { signal: ac.signal });
        if (r.ok) {
          const j = await r.json();
          if (j?.data && typeof j.data === 'object' && !Array.isArray(j.data)) {
            dispatch({ type: 'loadState', state: j.data });
          }
          versionRef.current = Number(j?.version || 0);
        }
      } catch {
        /* offline or platform down */
      } finally {
        if (!ac.signal.aborted) setSyncReady(true);
      }
    })();
    return () => ac.abort();
  }, [dispatch]);

  useEffect(() => {
    if (!syncReady) return;
    if (!isMongoAutsaveEnabled()) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(apiPath('/api/preconstruction-state'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: state,
            expectedVersion: versionRef.current,
            updatedBy: (localStorage.getItem('ga_user_name') || 'User').trim() || 'User'
          })
        });
        const j = await r.json().catch(() => ({}));
        if (r.status === 409) {
          const remote = Number(j?.currentVersion || 0);
          if (remote > versionRef.current && remote > notifiedRemoteVersion.current) {
            notifiedRemoteVersion.current = remote;
            toast('A teammate saved newer data. Refresh/load latest.', 'err');
          }
          return;
        }
        if (!r.ok) throw new Error(j.error || r.statusText);
        versionRef.current = Number(j?.version || versionRef.current);
      } catch (e) {
        toast(`Mongo save: ${e.message}`, 'err');
      }
    }, 2400);
    return () => clearTimeout(saveTimer.current);
  }, [state, syncReady, toast]);

  useEffect(() => {
    const flush = () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      if (!syncReady || !isMongoAutsaveEnabled()) return;
      const snap = stateRef.current;
      void fetch(apiPath('/api/preconstruction-state'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: snap,
          expectedVersion: versionRef.current,
          updatedBy: (localStorage.getItem('ga_user_name') || 'User').trim() || 'User'
        })
      }).catch(() => {});
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', flush);
    };
  }, [syncReady]);

  useEffect(() => {
    if (!syncReady) return undefined;
    const t = setInterval(async () => {
      try {
        const r = await fetch(apiPath('/api/apps/preconstruction/meta'));
        if (!r.ok) return;
        const j = await r.json();
        const remote = Number(j?.version || 0);
        if (remote > versionRef.current && remote > notifiedRemoteVersion.current) {
          notifiedRemoteVersion.current = remote;
          toast('New PreConstruction update available from team.', 'ok');
        }
      } catch {
        /* ignore transient errors */
      }
    }, 20000);
    return () => clearInterval(t);
  }, [syncReady, toast]);

  return null;
}
