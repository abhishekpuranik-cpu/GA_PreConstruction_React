const GA_USER_NAME_KEY = 'ga_user_name';

function safeLsGet(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function safeLsSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

/** Display name from platform login (name, else email local-part, else stored ga_user_name). */
export function displayNameFromUser(user) {
  if (!user) return '';
  const name = String(user.name || '').trim();
  if (name) return name;
  const email = String(user.email || '').trim();
  if (email) {
    const local = email.split('@')[0];
    return local || email;
  }
  return '';
}

export function fallbackLoginName() {
  const v = (safeLsGet(GA_USER_NAME_KEY) || 'User').trim();
  return v || 'User';
}

/**
 * Loads /api/auth/session (same-origin when embedded on platform).
 * Persists ga_user_name for legacy apps.
 */
/** Active PreConstruction users who share Admin-assigned projects (or all if unrestricted). */
export async function fetchPreconTeamRoster() {
  try {
    const res = await fetch('/api/auth/preconstruction-team-roster', {
      credentials: 'include',
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.names)) return data.names.filter(Boolean);
    }
  } catch {
    /* standalone / offline */
  }
  return [];
}

export async function fetchLoginUser() {
  try {
    const res = await fetch('/api/auth/session', { credentials: 'include', cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data?.authenticated && data.user) {
        const name = displayNameFromUser(data.user) || fallbackLoginName();
        safeLsSet(GA_USER_NAME_KEY, name);
        const teamNames = await fetchPreconTeamRoster();
        return {
          ready: true,
          authenticated: true,
          name,
          email: String(data.user.email || '').trim(),
          roleIds: Array.isArray(data.user.roleIds) ? data.user.roleIds : [],
          permissions: Array.isArray(data.user.permissions) ? data.user.permissions : [],
          allowedProjects: Array.isArray(data.user.allowedProjects) ? data.user.allowedProjects : [],
          teamNames,
        };
      }
    }
  } catch {
    /* offline or standalone */
  }
  return {
    ready: true,
    authenticated: false,
    name: fallbackLoginName(),
    email: '',
    roleIds: [],
    permissions: [],
    allowedProjects: [],
    teamNames: [],
  };
}
