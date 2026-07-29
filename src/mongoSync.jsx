import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { mergePreconstructionClientState } from './preconMerge.js';
import {
  canUseMongoState,
  GA_MONGO_ENABLE_KEY,
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

function countAssignees(data) {
  let n = 0;
  for (const p of data?.projects || []) {
    for (const ph of p?.phases || []) {
      for (const t of ph?.tasks || []) {
        if (String(t?.who || '').trim()) n += 1;
      }
    }
  }
  return n;
}

/** Manual start dates — used to detect wiped local snaps vs richer server work. */
function countManualStarts(data) {
  let n = 0;
  for (const p of data?.projects || []) {
    for (const ph of p?.phases || []) {
      for (const t of ph?.tasks || []) {
        if (t?.msManual && String(t?.ms || '').trim()) n += 1;
      }
    }
  }
  return n;
}

function remoteRicherThanLocal(remote, local) {
  return (
    countAssignees(remote) > countAssignees(local) ||
    countManualStarts(remote) > countManualStarts(local)
  );
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
  discardRef,
  onSyncStatus,
  canDeleteProjects = false,
}) {
  const [syncReady, setSyncReady] = useState(false);
  const [cloudStatus, setCloudStatus] = useState('loading');
  const stateRef = useRef(state);
  const versionRef = useRef({ v: 0 });
  const userEditedRef = useRef(false);
  const canDeleteRef = useRef(canDeleteProjects);
  const initialLoadDoneRef = useRef(false);
  const flushSaveRefInternal = useRef(null);
  const pullServerCatalogRef = useRef(null);
  const flushInFlightRef = useRef(null);
  const flushAgainRef = useRef(false);
  const bootSnapAppliedRef = useRef(false);
  /** Bumped on successful PUT / explicit reload so in-flight GETs cannot wipe fresh saves. */
  const applyEpochRef = useRef(0);

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

  const applyRemoteState = (
    remote,
    version,
    {
      force = false,
      mergeIfDirty = true,
      allowStale = false,
      reason = '',
      epoch = null,
    } = {},
  ) => {
    if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return false;
    if (epoch != null && epoch !== applyEpochRef.current) return false;

    const local = stateRef.current;
    const dirty = isDirtyLocal(local, userEditedRef.current);
    const trimmed = trimActivityLog(remote);
    const remoteV = Number(version) || 0;
    const localV = Number(versionRef.current.v) || 0;

    // Never apply an older workspace over a newer local/saved version (except explicit reload).
    if (!allowStale && remoteV < localV) return false;

    // Catalog / empty shells must never replace a real task tree.
    if (hasTaskTree(local) && !hasTaskTree(trimmed)) {
      versionRef.current.v = Math.max(localV, remoteV);
      return false;
    }

    if (dirty && mergeIfDirty) {
      const merged = mergePreconstructionClientState(trimmed, local, {
        allowProjectRemoval: canDeleteRef.current,
      });
      dispatch({ type: 'loadState', state: merged, fast: true });
      userEditedRef.current = true;
      versionRef.current.v = Math.max(localV, remoteV);
      setCloudStatus('dirty');
      return true;
    }

    if (!force && dirty) return false;

    // Prefer merge when local already has tasks and this is not an explicit full reload.
    // Prevents late boot/poll responses from wiping assignees/dates after Mongo Saved.
    const explicitReload = force && (reason === 'reload' || reason === 'conflict');
    if (hasTaskTree(local) && !explicitReload) {
      const richerRemote = !dirty && remoteRicherThanLocal(trimmed, local);
      // Same version + wiped local snap used to skip heal forever — still merge when server is richer.
      if (remoteV === localV && !force && !richerRemote) {
        return false;
      }
      const merged = mergePreconstructionClientState(trimmed, local, {
        allowProjectRemoval: canDeleteRef.current,
      });
      // Prefer remote when version advanced OR server has more assignees/manual starts than local.
      const preferRemote = !dirty && (remoteV > localV || richerRemote);
      const next = preferRemote
        ? mergePreconstructionClientState(local, trimmed, {
            allowProjectRemoval: canDeleteRef.current,
          })
        : merged;
      dispatch({ type: 'loadState', state: next, fast: true });
      userEditedRef.current = dirty;
      versionRef.current.v = Math.max(localV, remoteV);
      if (hasTaskTree(next)) writeWorkspaceSnap(next, versionRef.current.v);
      setCloudStatus(dirty ? 'dirty' : 'synced');
      return true;
    }

    const cleaned = {
      ...trimmed,
      _removedProjectIds: Array.isArray(trimmed._removedProjectIds) ? trimmed._removedProjectIds : [],
    };
    delete cleaned.__slimBoot;
    delete cleaned.__boot;
    dispatch({ type: 'loadState', state: cleaned, fast: true });
    userEditedRef.current = false;
    versionRef.current.v = Math.max(localV, remoteV);
    if (hasTaskTree(cleaned)) writeWorkspaceSnap(cleaned, versionRef.current.v);
    setCloudStatus('synced');
    return true;
  };

  const flushSave = async () => {
    if (!canUseMongoState()) {
      toast('Mongo sync unavailable (open from platform URL)', 'err');
      return false;
    }
    // Coalesce overlapping saves: mark dirty-again and reuse the in-flight promise.
    // Attachment patches after comment save often arrive while the first PUT is running.
    if (flushInFlightRef.current) {
      flushAgainRef.current = true;
      return flushInFlightRef.current;
    }

    const runOnce = async () => {
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
        // Fence: any in-flight catalog/work GET started before this save must be ignored.
        applyEpochRef.current += 1;
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
            const retryPayload = payloadForSave(merged);
            if (!retryPayload) return false;
            const retry = await mongoPutState(APP_ID, {
              data: retryPayload,
              expectedVersion: latest.version ?? versionRef.current.v,
              returnData: false,
            });
            if (retry.ok) {
              applyEpochRef.current += 1;
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
    };

    const run = (async () => {
      let ok = false;
      do {
        flushAgainRef.current = false;
        ok = await runOnce();
      } while (flushAgainRef.current);
      return ok;
    })();

    flushInFlightRef.current = run;
    try {
      return await run;
    } finally {
      if (flushInFlightRef.current === run) flushInFlightRef.current = null;
    }
  };
  flushSaveRefInternal.current = flushSave;

  const pullServerCatalog = async ({ force = false, reason = '' } = {}) => {
    const epoch = applyEpochRef.current;
    const res = await mongoGetState(APP_ID, { view: 'work' });
    if (epoch !== applyEpochRef.current) return false;
    if (!res.ok || !res.data) return false;
    const remoteCount = projectCount(res.data);
    const localCount = projectCount(stateRef.current);
    const dirty = isDirtyLocal(stateRef.current, userEditedRef.current);
    const remoteWho = countAssignees(res.data);
    const localWho = countAssignees(stateRef.current);

    if (force && !dirty && reason === 'reload') {
      applyEpochRef.current += 1;
      applyRemoteState(res.data, res.version, {
        force: true,
        mergeIfDirty: false,
        allowStale: true,
        reason: 'reload',
        epoch: applyEpochRef.current,
      });
      if (remoteCount > localCount) {
        toast?.(`Loaded ${remoteCount} projects from server`, 'ok');
      } else if (remoteWho > localWho) {
        toast?.(`Restored ${remoteWho} assignees from server`, 'ok');
      }
      return true;
    }

    const versionAdvanced = Number(res.version || 0) > Number(versionRef.current.v || 0);
    const remoteMs = countManualStarts(res.data);
    const localMs = countManualStarts(stateRef.current);
    // Never pull remote while local edits are unsaved — that was wiping assignee/date changes.
    if (dirty) return false;
    if (
      remoteCount > localCount ||
      force ||
      versionAdvanced ||
      !hasTaskTree(stateRef.current) ||
      remoteWho > localWho ||
      remoteMs > localMs
    ) {
      applyRemoteState(res.data, res.version, {
        force: false,
        mergeIfDirty: true,
        reason,
        epoch,
      });
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

  // Boot: catalog is cards-only; work carries assignees/dates. Never force-replace after a save fence.
  useEffect(() => {
    const ac = new AbortController();
    const bootEpoch = applyEpochRef.current;
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
        if (ac.signal.aborted || bootEpoch !== applyEpochRef.current) return;
        if (catalog.ok && catalog.data && typeof catalog.data === 'object' && !Array.isArray(catalog.data)) {
          // Catalog never force-replaces a task tree.
          applyRemoteState(catalog.data, catalog.version, {
            force: false,
            mergeIfDirty: true,
            reason: 'boot-catalog',
            epoch: bootEpoch,
          });
          if (!hasTaskTree(stateRef.current)) setCloudStatus('loading');
        }

        const work = await workPromise;
        if (ac.signal.aborted || bootEpoch !== applyEpochRef.current) return;
        if (work.ok && work.data && typeof work.data === 'object' && !Array.isArray(work.data)) {
          const localHasTree = hasTaskTree(stateRef.current);
          applyRemoteState(work.data, work.version, {
            // Only full-replace when local has no tasks yet (first paint).
            force: !localHasTree,
            mergeIfDirty: true,
            reason: 'boot-work',
            epoch: bootEpoch,
          });
          if (
            localHasTree &&
            remoteRicherThanLocal(work.data, stateRef.current) &&
            !isDirtyLocal(stateRef.current, userEditedRef.current)
          ) {
            // Ensure richer server assignees/dates win over a wiped local snap (even same version).
            applyRemoteState(work.data, work.version, {
              force: false,
              mergeIfDirty: true,
              reason: 'boot-work-richer',
              epoch: bootEpoch,
            });
          }
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

  const reloadFromCloud = async () => {
    if (!canUseMongoState()) {
      toast('Mongo sync unavailable (open from platform URL)', 'err');
      return false;
    }
    setCloudStatus('loading');
    try {
      userEditedRef.current = false;
      const ok = await pullServerCatalog({ force: true, reason: 'reload' });
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

  /** Drop unsaved local edits and restore last Mongo work snapshot. */
  const discardLocalEdits = async () => {
    userEditedRef.current = false;
    if (!canUseMongoState()) {
      setCloudStatus('local');
      return true;
    }
    setCloudStatus('loading');
    try {
      const ok = await pullServerCatalog({ force: true, reason: 'reload' });
      if (ok) {
        setCloudStatus('synced');
        return true;
      }
      setCloudStatus('synced');
      return true;
    } catch {
      setCloudStatus('offline');
      return false;
    }
  };

  useEffect(() => {
    if (flushRef) flushRef.current = flushSave;
    if (reloadRef) reloadRef.current = reloadFromCloud;
    if (discardRef) discardRef.current = discardLocalEdits;
    return () => {
      if (flushRef) flushRef.current = null;
      if (reloadRef) reloadRef.current = null;
      if (discardRef) discardRef.current = null;
    };
  });

  useEffect(() => {
    if (!syncReady || !state.__needsHydrate) return undefined;
    const t = window.setTimeout(() => {
      dispatch({ type: 'hydrateWorkspace' });
    }, 50);
    return () => clearTimeout(t);
  }, [syncReady, state.__needsHydrate, dispatch]);

  // Manual-save mode: edits mark Unsaved only — never auto-PUT to Mongo.
  useEffect(() => {
    if (!syncReady || !state.__flushPending) return undefined;
    userEditedRef.current = true;
    dispatch({ type: 'clearFlushFlag' });
    setCloudStatus((s) => (s === 'saving' || s === 'loading' ? s : 'dirty'));
    return undefined;
  }, [syncReady, state.__flushPending, dispatch]);

  // No debounced autosave. No pagehide auto-save. No background pull while unsaved.
  useEffect(() => {
    const onVis = async () => {
      if (document.visibilityState !== 'visible' || !syncReady || !canUseMongoState()) return;
      if (isDirtyLocal(stateRef.current, userEditedRef.current)) return;
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
    return () => {
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [syncReady]);

  useEffect(() => {
    if (!syncReady || !canUseMongoState()) return undefined;
    const t = setInterval(async () => {
      if (isDirtyLocal(stateRef.current, userEditedRef.current)) return;
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
    }, 30000);
    return () => clearInterval(t);
  }, [syncReady]);

  return null;
}
