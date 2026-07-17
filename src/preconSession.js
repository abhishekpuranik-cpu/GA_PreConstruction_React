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
/** Active Security Admin / PreConstruction assignee names (optionally scoped to a project). */
export async function fetchPreconTeamRoster(project = null) {
  try {
    const qs = new URLSearchParams();
    if (project?.id) qs.set('projectId', String(project.id));
    if (project?.name) qs.set('projectName', String(project.name));
    const url = qs.toString()
      ? `/api/auth/preconstruction-team-roster?${qs}`
      : '/api/auth/preconstruction-team-roster';
    const res = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      const names = Array.isArray(data?.names) ? data.names.filter(Boolean) : [];
      const projectTagged = Array.isArray(data?.projectTagged) ? data.projectTagged.filter(Boolean) : [];
      const securityUsers = Array.isArray(data?.securityUsers) ? data.securityUsers.filter(Boolean) : names;
      return { names, projectTagged, securityUsers };
    }
  } catch {
    /* standalone / offline */
  }
  return { names: [], projectTagged: [], securityUsers: [] };
}

export async function fetchLoginUser() {
  try {
    const res = await fetch('/api/auth/session', { credentials: 'include', cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data?.authenticated && data.user) {
        const name = displayNameFromUser(data.user) || fallbackLoginName();
        safeLsSet(GA_USER_NAME_KEY, name);
        const roster = await fetchPreconTeamRoster();
        return {
          ready: true,
          authenticated: true,
          name,
          email: String(data.user.email || '').trim(),
          roleIds: Array.isArray(data.user.roleIds) ? data.user.roleIds : [],
          permissions: Array.isArray(data.user.permissions) ? data.user.permissions : [],
          allowedProjects: Array.isArray(data.user.allowedProjects) ? data.user.allowedProjects : [],
          teamNames: roster.names,
          projectTaggedNames: roster.projectTagged,
          securityUserNames: roster.securityUsers,
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
    projectTaggedNames: [],
    securityUserNames: [],
  };
}
