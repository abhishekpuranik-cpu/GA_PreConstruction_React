import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { mergePreconstructionClientState } from './preconMerge.js';
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

function projectCount(data) {
  return Array.isArray(data?.projects) ? data.projects.length : 0;
}

/**
 * Loads / saves PreConstruction reducer state to Golden Abodes Platform MongoDB
 * (same app_states collection as GET/PUT /api/apps/preconstruction/state).
 */
export function MongoSyncAdapter({
  state,
  dispatch,
  toast,
  flushRef,
  reloadRef,
  onSyncStatus,
  canDeleteProjects = false,
}) {
  const [syncReady, setSyncReady] = useState(false);
  const [cloudStatus, setCloudStatus] = useState('loading');
  const stateRef = useRef(state);
  const versionRef = useRef({ v: 0 });
  const notifiedRemoteVersion = useRef(0);
  const scheduleSaveRef = useRef(null);
  const userEditedRef = useRef(false);
  const initialStateJsonRef = useRef(null);
  const canDeleteRef = useRef(canDeleteProjects);
  const initialLoadDoneRef = useRef(false);
  const applyRemoteStateRef = useRef(null);

  useEffect(() => {
    canDeleteRef.current = canDeleteProjects;
  }, [canDeleteProjects]);

  useLayoutEffect(() => {
    stateRef.current = state;
    // Do not mark "user edited" until after the first Mongo load — otherwise seed/local
    // catalog blocks applying the full server portfolio.
    if (!initialLoadDoneRef.current) {
      try {
        if (initialStateJsonRef.current === null) {
          initialStateJsonRef.current = JSON.stringify(state);
        }
      } catch {
        /* ignore */
      }
      return;
    }
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

  const applyRemoteState = (remote, version, { force = false } = {}) => {
    if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return false;
    if (!force && userEditedRef.current) return false;
    // Clear poisoned local tombstones that would hide server projects on next save.
    const cleaned = {
      ...remote,
      _removedProjectIds: Array.isArray(remote._removedProjectIds) ? remote._removedProjectIds : [],
    };
    dispatch({ type: 'loadState', state: cleaned });
    try {
      initialStateJsonRef.current = JSON.stringify(cleaned);
    } catch {
      /* ignore */
    }
    userEditedRef.current = false;
    versionRef.current.v = version || 0;
    setCloudStatus('synced');
    return true;
  };
  applyRemoteStateRef.current = applyRemoteState;

  const pullServerCatalog = async ({ force = false, reason = '' } = {}) => {
    const res = await mongoGetState(APP_ID);
    if (!res.ok || !res.data) return false;
    const remoteCount = projectCount(res.data);
    const localCount = projectCount(stateRef.current);
    if (force || remoteCount > localCount) {
      applyRemoteState(res.data, res.version, { force: true });
      if (remoteCount > localCount && reason) {
        toast?.(`Loaded ${remoteCount} projects from server`, 'ok');
      }
      return true;
    }
    versionRef.current.v = Math.max(versionRef.current.v, res.version || 0);
    return false;
  };

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      if (!canUseMongoState()) {
        setCloudStatus('local');
        initialLoadDoneRef.current = true;
        setSyncReady(true);
        return;
      }
      try {
        const res = await mongoGetState(APP_ID);
        if (ac.signal.aborted) return;
        if (res.ok && res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
          // Always take server portfolio on boot.
          applyRemoteState(res.data, res.version, { force: true });
        } else if (res.status === 404) {
          versionRef.current.v = 0;
          setCloudStatus('new');
        } else {
          setCloudStatus('error');
        }
      } catch {
        if (!ac.signal.aborted) setCloudStatus('offline');
      } finally {
        if (!ac.signal.aborted) {
          initialLoadDoneRef.current = true;
          setSyncReady(true);
        }
      }
    })();
    return () => ac.abort();
  }, [dispatch]);

  useEffect(() => {
    if (!syncReady || !canUseMongoState()) return undefined;
    scheduleSaveRef.current = createMongoDebouncedSaver(APP_ID, versionRef, 2400, {
      mergeOnConflict: (serverData, localData) =>
        mergePreconstructionClientState(serverData, localData, {
          allowProjectRemoval: canDeleteRef.current,
        }),
    });
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
    // Never persist a poisoned mass-tombstone list from the browser.
    const localCount = projectCount(snap);
    const safeSnap = {
      ...snap,
      _removedProjectIds:
        Array.isArray(snap?._removedProjectIds) && snap._removedProjectIds.length > Math.max(2, localCount)
          ? []
          : snap?._removedProjectIds || [],
    };
    setCloudStatus('saving');
    const res = await mongoPutState(APP_ID, { data: safeSnap, expectedVersion: versionRef.current.v });
    if (res.ok) {
      versionRef.current.v = res.version ?? versionRef.current.v;
      if (res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
        const remoteCount = projectCount(res.data);
        if (remoteCount > localCount || !sameState(res.data, snap)) {
          applyRemoteState(res.data, res.version, { force: true });
        }
      }
      setCloudStatus('synced');
      return true;
    }
    if (res.status === 409) {
      try {
        const latest = await mongoGetState(APP_ID);
        if (latest.ok && latest.data) {
          if (sameState(latest.data, snap)) {
            versionRef.current.v = latest.version || versionRef.current.v;
            setCloudStatus('synced');
            return true;
          }
          const merged = mergePreconstructionClientState(latest.data, safeSnap, {
            allowProjectRemoval: canDeleteRef.current,
          });
          const retry = await mongoPutState(APP_ID, {
            data: merged,
            expectedVersion: latest.version ?? versionRef.current.v,
          });
          if (retry.ok) {
            versionRef.current.v = retry.version ?? versionRef.current.v;
            const applyState = retry.data && typeof retry.data === 'object' ? retry.data : merged;
            applyRemoteState(applyState, retry.version, { force: true });
            setCloudStatus('synced');
            return true;
          }
        }
      } catch {
        /* fall through */
      }
      setCloudStatus('conflict');
      // Auto-recover: pull server catalog instead of asking the user to click Reload.
      try {
        await pullServerCatalog({ force: true, reason: 'conflict' });
      } catch {
        toast('Save conflict — could not auto-load server data', 'err');
      }
      return false;
    }
    setCloudStatus('error');
    toast(`Mongo save: ${res.error || 'failed'}`, 'err');
    return false;
  };

  const reloadFromCloud = async () => {
    if (!canUseMongoState()) {
      toast('Mongo sync unavailable (open from platform URL)', 'err');
      return false;
    }
    setCloudStatus('loading');
    try {
      const ok = await pullServerCatalog({ force: true });
      if (ok) {
        toast('Workspace reloaded from Mongo', 'ok');
        return true;
      }
      const res = await mongoGetState(APP_ID);
      if (res.status === 404) {
        versionRef.current.v = 0;
        setCloudStatus('new');
        toast('No saved workspace on Mongo yet', 'err');
        return false;
      }
      setCloudStatus('error');
      toast(res.error || 'Reload failed', 'err');
      return false;
    } catch {
      setCloudStatus('offline');
      toast('Reload failed — offline', 'err');
      return false;
    }
  };

  useEffect(() => {
    if (flushRef) flushRef.current = flushSave;
    if (reloadRef) reloadRef.current = reloadFromCloud;
    return () => {
      if (flushRef) flushRef.current = null;
      if (reloadRef) reloadRef.current = null;
    };
  });

  useEffect(() => {
    if (!syncReady || !state.__commentsRepairPending) return undefined;
    dispatch({ type: 'clearCommentRepairFlag' });
    const timer = setTimeout(() => {
      void flushSave();
    }, 600);
    return () => clearTimeout(timer);
  }, [syncReady, state.__commentsRepairPending, dispatch]);

  useEffect(() => {
    if (!syncReady || !state.__flushPending) return undefined;
    dispatch({ type: 'clearFlushFlag' });
    const timer = setTimeout(() => {
      void flushSave();
    }, 120);
    return () => clearTimeout(timer);
  }, [syncReady, state.__flushPending, dispatch]);

  useEffect(() => {
    if (!syncReady || !isMongoAutsaveEnabled() || !canUseMongoState()) return;
    const schedule = scheduleSaveRef.current;
    if (!schedule) return;
    schedule(() => {
      const snap = stateRef.current;
      const localCount = projectCount(snap);
      return {
        ...snap,
        _removedProjectIds:
          Array.isArray(snap?._removedProjectIds) && snap._removedProjectIds.length > Math.max(2, localCount)
            ? []
            : snap?._removedProjectIds || [],
      };
    });
    setCloudStatus((s) => (s === 'saving' ? s : 'dirty'));
  }, [state, syncReady]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible' || !syncReady || !canUseMongoState()) return;
      void pullServerCatalog({ force: false, reason: 'visible' });
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', () => void flushSave());
    // Immediate pull after boot in case first paint raced.
    const t = setTimeout(() => {
      void pullServerCatalog({ force: true, reason: 'boot' });
    }, 1500);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clearTimeout(t);
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
        if (remote > versionRef.current.v) {
          notifiedRemoteVersion.current = remote;
          await pullServerCatalog({ force: true, reason: 'version' });
        } else {
          // Even on same version, recover if local catalog is smaller.
          await pullServerCatalog({ force: false, reason: 'poll' });
        }
      } catch {
        /* ignore */
      }
    }, 5000);
    return () => clearInterval(t);
  }, [syncReady, toast]);

  return null;
}
