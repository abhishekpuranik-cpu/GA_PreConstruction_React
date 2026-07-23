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
const SNAP_KEY = 'ga_precon_workspace_snap_v2';
const ACTIVITY_BOOT_CAP = 200;

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
  try {
    const slim = trimActivityLog(stripEphemeral(data), ACTIVITY_BOOT_CAP);
    sessionStorage.setItem(
      SNAP_KEY,
      JSON.stringify({
        version: Number(version) || 0,
        savedAt: Date.now(),
        data: {
          cloudUrl: slim.cloudUrl || '',
          departments: slim.departments || [],
          projects: slim.projects || [],
          activityLog: slim.activityLog || [],
          _removedProjectIds: slim._removedProjectIds || [],
        },
      }),
    );
  } catch {
    /* quota / private mode */
  }
}

function readWorkspaceSnap() {
  try {
    const raw = sessionStorage.getItem(SNAP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data || !Array.isArray(parsed.data.projects) || !parsed.data.projects.length) return null;
    // Keep snap for the session; drop if older than 7 days.
    if (Date.now() - Number(parsed.savedAt || 0) > 7 * 24 * 3600 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function payloadForSave(snap) {
  const localCount = projectCount(snap);
  const cleaned = stripEphemeral(snap);
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
    // Dirty is set only by user flush actions — never by stringify of the whole workspace.
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

    const cleaned = {
      ...trimmed,
      _removedProjectIds: Array.isArray(trimmed._removedProjectIds) ? trimmed._removedProjectIds : [],
    };
    dispatch({ type: 'loadState', state: cleaned, fast: true });
    userEditedRef.current = false;
    versionRef.current.v = version || 0;
    writeWorkspaceSnap(cleaned, versionRef.current.v);
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
      setCloudStatus('saving');
      const res = await mongoPutState(APP_ID, {
        data: safeSnap,
        expectedVersion: versionRef.current.v,
        // Prefer version-only response — avoid downloading the full portfolio after every save.
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
          const latest = await mongoGetState(APP_ID);
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
    const res = await mongoGetState(APP_ID);
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

    // Only apply when forced, dirty-merge needed, remote has more projects, or version advanced.
    const versionAdvanced = Number(res.version || 0) > Number(versionRef.current.v || 0);
    if (dirty || remoteCount > localCount || force || versionAdvanced) {
      applyRemoteState(res.data, res.version, { force: false, mergeIfDirty: true });
      if (dirty) void flushSaveRefInternal.current?.();
      return true;
    }

    versionRef.current.v = Math.max(versionRef.current.v, res.version || 0);
    return false;
  };
  pullServerCatalogRef.current = pullServerCatalog;

  // Instant paint from session snapshot, then refresh from Mongo.
  useEffect(() => {
    if (bootSnapAppliedRef.current) return;
    bootSnapAppliedRef.current = true;
    const snap = readWorkspaceSnap();
    if (snap?.data) {
      versionRef.current.v = Number(snap.version) || 0;
      dispatch({ type: 'loadState', state: snap.data, fast: true, fromSnap: true });
      setCloudStatus('loading');
    }
  }, [dispatch]);

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
          applyRemoteState(res.data, res.version, { force: true, mergeIfDirty: false });
        } else if (res.status === 404) {
          versionRef.current.v = 0;
          setCloudStatus(projectCount(stateRef.current) ? 'synced' : 'new');
        } else {
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

  // Light hydrate once after first Mongo apply (lifecycle stamps prevent repeat).
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

  // Autosave only when the user actually edited (not on remote load / hydrate).
  useEffect(() => {
    if (!syncReady || !isMongoAutsaveEnabled() || !canUseMongoState()) return;
    if (!userEditedRef.current) return;
    const schedule = scheduleSaveRef.current;
    if (!schedule) return;
    schedule(() => payloadForSave(stateRef.current));
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

  // Meta-only poll — full GET only when remote version advances.
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
