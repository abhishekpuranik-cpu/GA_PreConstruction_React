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
const SNAP_KEY = 'ga_precon_workspace_snap_v3';
const ACTIVITY_BOOT_CAP = 120;

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

function hasTaskTree(data) {
  const projects = Array.isArray(data?.projects) ? data.projects : [];
  for (const p of projects) {
    for (const ph of p?.phases || []) {
      if (Array.isArray(ph?.tasks) && ph.tasks.length) return true;
    }
  }
  return false;
}

function isDirtyLocal(state, userEdited) {
  return !!(userEdited || state?.__flushPending);
}

/** Strip ephemeral UI flags before PUT / snapshot. */
function stripEphemeral(state) {
  if (!state || typeof state !== 'object') return state;
  const {
    __needsHydrate,
    __flushPending,
    __commentsRepairPending,
    __lifecycleHydrated,
    __slimBoot,
    __boot,
    ...rest
  } = state;
  return rest;
}

function trimActivityLog(data, cap = ACTIVITY_BOOT_CAP) {
  if (!data || typeof data !== 'object') return data;
  const log = Array.isArray(data.activityLog) ? data.activityLog : [];
  if (log.length <= cap) return data;
  return { ...data, activityLog: log.slice(0, cap) };
}

function writeWorkspaceSnap(data, version) {
  const slim = trimActivityLog(stripEphemeral(data), ACTIVITY_BOOT_CAP);
  const payload = JSON.stringify({
    version: Number(version) || 0,
    savedAt: Date.now(),
    data: {
      cloudUrl: slim.cloudUrl || '',
      departments: slim.departments || [],
      projects: slim.projects || [],
      activityLog: slim.activityLog || [],
      _removedProjectIds: slim._removedProjectIds || [],
    },
  });
  try {
    sessionStorage.setItem(SNAP_KEY, payload);
  } catch {
    /* ignore */
  }
  // Persist across sessions when the browser allows (return visits open instantly).
  if (hasTaskTree(slim)) {
    try {
      localStorage.setItem(SNAP_KEY, payload);
    } catch {
      try {
        localStorage.removeItem(SNAP_KEY);
      } catch {
        /* ignore */
      }
    }
  }
}

function readWorkspaceSnap() {
  const tryParse = (raw) => {
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data || !Array.isArray(parsed.data.projects) || !parsed.data.projects.length) return null;
    if (Date.now() - Number(parsed.savedAt || 0) > 14 * 24 * 3600 * 1000) return null;
    return parsed;
  };
  try {
    const session = tryParse(sessionStorage.getItem(SNAP_KEY));
    if (session && hasTaskTree(session.data)) return session;
    const local = tryParse(localStorage.getItem(SNAP_KEY));
    if (local) return local;
    return session;
  } catch {
    return null;
  }
}

function payloadForSave(snap) {
  const localCount = projectCount(snap);
  const cleaned = stripEphemeral(snap);
  // Never PUT catalog-only shells (empty phases) — server merge is safe, but avoid noisy writes.
  if (!hasTaskTree(cleaned)) {
    return null;
  }
  return {
    ...cleaned,
    _removedProjectIds:
      Array.isArray(snap?._removedProjectIds) && snap._removedProjectIds.length > Math.max(2, localCount)
        ? []
        : snap?._removedProjectIds || [],
  };
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
  const scheduleSaveRef = useRef(null);
  const userEditedRef = useRef(false);
  const canDeleteRef = useRef(canDeleteProjects);
  const initialLoadDoneRef = useRef(false);
  const flushSaveRefInternal = useRef(null);
  const pullServerCatalogRef = useRef(null);
  const flushInFlightRef = useRef(null);
  const bootSnapAppliedRef = useRef(false);

  useEffect(() => {
    canDeleteRef.current = canDeleteProjects;
  }, [canDeleteProjects]);

  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    enableMongoOnCloud();
  }, []);

  useEffect(() => {
    if (typeof onSyncStatus === 'function') onSyncStatus(cloudStatus);
  }, [cloudStatus, onSyncStatus]);

  const applyRemoteState = (remote, version, { force = false, mergeIfDirty = true } = {}) => {
    if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return false;
    const local = stateRef.current;
    const dirty = isDirtyLocal(local, userEditedRef.current);
    const trimmed = trimActivityLog(remote);

    if (dirty && mergeIfDirty) {
      const merged = mergePreconstructionClientState(trimmed, local, {
        allowProjectRemoval: canDeleteRef.current,
      });
      dispatch({ type: 'loadState', state: merged, fast: true });
      userEditedRef.current = true;
      versionRef.current.v = version || versionRef.current.v || 0;
      setCloudStatus('dirty');
      return true;
    }

    if (!force && dirty) return false;

    // Prefer richer local task trees over empty catalog shells when not forcing.
    if (!force && hasTaskTree(local) && !hasTaskTree(trimmed)) {
      versionRef.current.v = Math.max(versionRef.current.v, version || 0);
      return false;
    }

    const cleaned = {
      ...trimmed,
      _removedProjectIds: Array.isArray(trimmed._removedProjectIds) ? trimmed._removedProjectIds : [],
    };
    delete cleaned.__slimBoot;
    delete cleaned.__boot;
    dispatch({ type: 'loadState', state: cleaned, fast: true });
    userEditedRef.current = false;
    versionRef.current.v = version || 0;
    if (hasTaskTree(cleaned)) writeWorkspaceSnap(cleaned, versionRef.current.v);
    setCloudStatus('synced');
    return true;
  };

  const flushSave = async () => {
    if (!canUseMongoState()) {
      toast('Mongo sync unavailable (open from platform URL)', 'err');
      return false;
    }
    if (flushInFlightRef.current) return flushInFlightRef.current;

    const run = (async () => {
      const snap = stateRef.current;
      const safeSnap = payloadForSave(snap);
      if (!safeSnap) {
        setCloudStatus(projectCount(snap) ? 'synced' : 'new');
        return false;
      }
      setCloudStatus('saving');
      const res = await mongoPutState(APP_ID, {
        data: safeSnap,
        expectedVersion: versionRef.current.v,
        returnData: false,
      });
      if (res.ok) {
        versionRef.current.v = res.version ?? versionRef.current.v;
        userEditedRef.current = false;
        writeWorkspaceSnap(safeSnap, versionRef.current.v);
        setCloudStatus('synced');
        return true;
      }
      if (res.status === 409) {
        try {
          const latest = await mongoGetState(APP_ID, { view: 'work' });
          if (latest.ok && latest.data) {
            const freshLocal = stateRef.current;
            const merged = mergePreconstructionClientState(latest.data, freshLocal, {
              allowProjectRemoval: canDeleteRef.current,
            });
            const retry = await mongoPutState(APP_ID, {
              data: payloadForSave(merged),
              expectedVersion: latest.version ?? versionRef.current.v,
              returnData: false,
            });
            if (retry.ok) {
              versionRef.current.v = retry.version ?? versionRef.current.v;
              dispatch({ type: 'loadState', state: merged, fast: true });
              userEditedRef.current = false;
              writeWorkspaceSnap(merged, versionRef.current.v);
              setCloudStatus('synced');
              return true;
            }
          }
        } catch {
          /* fall through */
        }
        setCloudStatus('conflict');
        try {
          await pullServerCatalogRef.current?.({ force: false, reason: 'conflict' });
        } catch {
          toast('Save conflict — could not auto-load server data', 'err');
        }
        return false;
      }
      setCloudStatus('error');
      toast(`Mongo save: ${res.error || 'failed'}`, 'err');
      return false;
    })();

    flushInFlightRef.current = run;
    try {
      return await run;
    } finally {
      flushInFlightRef.current = null;
    }
  };
  flushSaveRefInternal.current = flushSave;

  const pullServerCatalog = async ({ force = false, reason = '' } = {}) => {
    const res = await mongoGetState(APP_ID, { view: 'work' });
    if (!res.ok || !res.data) return false;
    const remoteCount = projectCount(res.data);
    const localCount = projectCount(stateRef.current);
    const dirty = isDirtyLocal(stateRef.current, userEditedRef.current);

    if (force && !dirty) {
      applyRemoteState(res.data, res.version, { force: true, mergeIfDirty: false });
      if (remoteCount > localCount && reason) {
        toast?.(`Loaded ${remoteCount} projects from server`, 'ok');
      }
      return true;
    }

    const versionAdvanced = Number(res.version || 0) > Number(versionRef.current.v || 0);
    if (dirty || remoteCount > localCount || force || versionAdvanced || !hasTaskTree(stateRef.current)) {
      applyRemoteState(res.data, res.version, { force: false, mergeIfDirty: true });
      if (dirty) void flushSaveRefInternal.current?.();
      return true;
    }

    versionRef.current.v = Math.max(versionRef.current.v, res.version || 0);
    return false;
  };
  pullServerCatalogRef.current = pullServerCatalog;

  // Instant paint from local/session snapshot.
  useEffect(() => {
    if (bootSnapAppliedRef.current) return;
    bootSnapAppliedRef.current = true;
    const snap = readWorkspaceSnap();
    if (snap?.data) {
      versionRef.current.v = Number(snap.version) || 0;
      dispatch({ type: 'loadState', state: snap.data, fast: true, fromSnap: true });
      setCloudStatus(hasTaskTree(snap.data) ? 'synced' : 'loading');
    }
  }, [dispatch]);

  // Two-phase Mongo load: tiny catalog first, then work (tasks/comments).
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
        const catalogPromise = mongoGetState(APP_ID, { view: 'catalog' });
        const workPromise = mongoGetState(APP_ID, { view: 'work' });

        const catalog = await catalogPromise;
        if (ac.signal.aborted) return;
        if (catalog.ok && catalog.data && typeof catalog.data === 'object' && !Array.isArray(catalog.data)) {
          applyRemoteState(catalog.data, catalog.version, {
            force: !hasTaskTree(stateRef.current) && !isDirtyLocal(stateRef.current, userEditedRef.current),
            mergeIfDirty: true,
          });
          if (!hasTaskTree(stateRef.current)) setCloudStatus('loading');
        }

        const work = await workPromise;
        if (ac.signal.aborted) return;
        if (work.ok && work.data && typeof work.data === 'object' && !Array.isArray(work.data)) {
          applyRemoteState(work.data, work.version, {
            force: !isDirtyLocal(stateRef.current, userEditedRef.current),
            mergeIfDirty: true,
          });
        } else if (work.status === 404 && catalog.status === 404) {
          versionRef.current.v = 0;
          setCloudStatus(projectCount(stateRef.current) ? 'synced' : 'new');
        } else if (!hasTaskTree(stateRef.current)) {
          setCloudStatus(projectCount(stateRef.current) ? 'synced' : 'error');
        }
      } catch {
        if (!ac.signal.aborted) {
          setCloudStatus(projectCount(stateRef.current) ? 'synced' : 'offline');
        }
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

  const reloadFromCloud = async () => {
    if (!canUseMongoState()) {
      toast('Mongo sync unavailable (open from platform URL)', 'err');
      return false;
    }
    setCloudStatus('loading');
    try {
      userEditedRef.current = false;
      const ok = await pullServerCatalog({ force: true });
      if (ok) {
        toast('Workspace reloaded from Mongo', 'ok');
        return true;
      }
      const res = await mongoGetState(APP_ID, { view: 'work' });
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
    if (!syncReady || !state.__needsHydrate) return undefined;
    const t = window.setTimeout(() => {
      dispatch({ type: 'hydrateWorkspace' });
    }, 50);
    return () => clearTimeout(t);
  }, [syncReady, state.__needsHydrate, dispatch]);

  useEffect(() => {
    if (!syncReady || !state.__flushPending) return undefined;
    userEditedRef.current = true;
    dispatch({ type: 'clearFlushFlag' });
    const timer = setTimeout(() => {
      void flushSave();
    }, 60);
    return () => clearTimeout(timer);
  }, [syncReady, state.__flushPending, dispatch]);

  useEffect(() => {
    if (!syncReady || !isMongoAutsaveEnabled() || !canUseMongoState()) return;
    if (!userEditedRef.current) return;
    if (!hasTaskTree(stateRef.current)) return;
    const schedule = scheduleSaveRef.current;
    if (!schedule) return;
    const payload = payloadForSave(stateRef.current);
    if (!payload) return;
    schedule(() => payload);
    setCloudStatus((s) => (s === 'saving' ? s : 'dirty'));
  }, [state, syncReady]);

  useEffect(() => {
    const onVis = async () => {
      if (document.visibilityState !== 'visible' || !syncReady || !canUseMongoState()) return;
      try {
        const r = await fetch(`/api/apps/${APP_ID}/meta`);
        if (!r.ok) return;
        const j = await r.json();
        const remote = Number(j?.version || 0);
        if (remote > versionRef.current.v) {
          await pullServerCatalogRef.current?.({ force: false, reason: 'visible' });
        }
      } catch {
        /* ignore */
      }
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', () => {
      if (userEditedRef.current) void flushSave();
    });
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
        if (remote > versionRef.current.v) {
          await pullServerCatalogRef.current?.({ force: false, reason: 'version' });
        }
      } catch {
        /* ignore */
      }
    }, 12000);
    return () => clearInterval(t);
  }, [syncReady]);

  return null;
}
