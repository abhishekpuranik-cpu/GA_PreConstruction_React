import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  canUseMongoState,
  createMongoDebouncedSaver,
  GA_MONGO_ENABLE_KEY,
  isMongoAutsaveEnabled,
  mongoGetState,
  mongoPutState
} from '../../ga_mongo/mongoStateClient.js';

const APP_ID = 'preconstruction';

function enableMongoOnCloud() {
  if (!canUseMongoState()) return;
  try {
    localStorage.setItem(GA_MONGO_ENABLE_KEY, '1');
  } catch {
    /* ignore */
  }
}

/**
 * Loads / saves PreConstruction reducer state to Golden Abodes Platform MongoDB
 * (same app_states collection as GET/PUT /api/apps/preconstruction/state).
 */
export function MongoSyncAdapter({ state, dispatch, toast, flushRef, onSyncStatus }) {
  const [syncReady, setSyncReady] = useState(false);
  const [cloudStatus, setCloudStatus] = useState('loading');
  const stateRef = useRef(state);
  const versionRef = useRef({ v: 0 });
  const notifiedRemoteVersion = useRef(0);
  const scheduleSaveRef = useRef(null);
  const userEditedRef = useRef(false);
  const initialStateJsonRef = useRef(null);

  useLayoutEffect(() => {
    stateRef.current = state;
    try {
      const json = JSON.stringify(state);
      if (initialStateJsonRef.current === null) initialStateJsonRef.current = json;
      else if (json !== initialStateJsonRef.current) userEditedRef.current = true;
    } catch {
      userEditedRef.current = true;
    }
  }, [state]);

  useEffect(() => {
    enableMongoOnCloud();
  }, []);

  useEffect(() => {
    if (typeof onSyncStatus === 'function') onSyncStatus(cloudStatus);
  }, [cloudStatus, onSyncStatus]);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      if (!canUseMongoState()) {
        setCloudStatus('local');
        setSyncReady(true);
        return;
      }
      try {
        const res = await mongoGetState(APP_ID);
        if (ac.signal.aborted) return;
        if (res.ok && res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
          if (!userEditedRef.current) {
            dispatch({ type: 'loadState', state: res.data });
            try {
              initialStateJsonRef.current = JSON.stringify(res.data);
            } catch {
              /* ignore */
            }
          }
          versionRef.current.v = res.version || 0;
          setCloudStatus(userEditedRef.current ? 'dirty' : 'synced');
        } else if (res.status === 404) {
          versionRef.current.v = 0;
          setCloudStatus('new');
        } else {
          setCloudStatus('error');
        }
      } catch {
        if (!ac.signal.aborted) setCloudStatus('offline');
      } finally {
        if (!ac.signal.aborted) setSyncReady(true);
      }
    })();
    return () => ac.abort();
  }, [dispatch]);

  useEffect(() => {
    if (!syncReady || !canUseMongoState()) return undefined;
    scheduleSaveRef.current = createMongoDebouncedSaver(APP_ID, versionRef, 2400);
    return undefined;
  }, [syncReady]);

  const sameState = (a, b) => {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  };

  const flushSave = async () => {
    if (!canUseMongoState()) {
      toast('Mongo sync unavailable (open from platform URL)', 'err');
      return false;
    }
    const snap = stateRef.current;
    setCloudStatus('saving');
    const res = await mongoPutState(APP_ID, { data: snap, expectedVersion: versionRef.current.v });
    if (res.ok) {
      versionRef.current.v = res.version ?? versionRef.current.v;
      setCloudStatus('synced');
      toast('Saved to MongoDB', 'ok');
      return true;
    }
    if (res.status === 409) {
      // Auto-recover benign conflicts caused by overlapping autosave/manual save.
      try {
        const latest = await mongoGetState(APP_ID);
        if (latest.ok && latest.data && sameState(latest.data, snap)) {
          versionRef.current.v = latest.version || versionRef.current.v;
          setCloudStatus('synced');
          toast('Saved (version synced)', 'ok');
          return true;
        }
      } catch {
        /* ignore and keep conflict flow */
      }
      setCloudStatus('conflict');
      toast('Save conflict — reload to get team data', 'err');
      return false;
    }
    setCloudStatus('error');
    toast(`Mongo save: ${res.error || 'failed'}`, 'err');
    return false;
  };

  useEffect(() => {
    if (flushRef) flushRef.current = flushSave;
    return () => {
      if (flushRef) flushRef.current = null;
    };
  });

  useEffect(() => {
    if (!syncReady || !isMongoAutsaveEnabled() || !canUseMongoState()) return;
    const schedule = scheduleSaveRef.current;
    if (!schedule) return;
    schedule(() => stateRef.current);
    setCloudStatus((s) => (s === 'saving' ? s : 'dirty'));
  }, [state, syncReady]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden' && syncReady && isMongoAutsaveEnabled()) {
        void flushSave();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', () => void flushSave());
    return () => {
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [syncReady]);

  useEffect(() => {
    if (!syncReady || !canUseMongoState()) return undefined;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/apps/${APP_ID}/meta`);
        if (!r.ok) return;
        const j = await r.json();
        const remote = Number(j?.version || 0);
        if (remote > versionRef.current.v && remote > notifiedRemoteVersion.current) {
          notifiedRemoteVersion.current = remote;
          toast('New PreConstruction update available from team.', 'ok');
        }
      } catch {
        /* ignore */
      }
    }, 20000);
    return () => clearInterval(t);
  }, [syncReady, toast]);

  return null;
}
