import { useMemo, useState } from 'react';
import { filterProjectsBySearch } from './projectSearch.js';

/**
 * Nav project selector: search by name/location + dropdown of all workspace projects.
 */
export function ProjectNavPicker({ projects, value, onChange, onCloseNav }) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    let list = filterProjectsBySearch(projects, search);
    if (value && value !== 'dashboard' && value !== 'mywork') {
      const cur = (projects || []).find((p) => p.id === value);
      if (cur && !list.some((p) => p.id === value)) list = [cur, ...list];
    }
    return list;
  }, [projects, search, value]);
  const total = (projects || []).length;
  const shown = filtered.length;

  return (
    <div className="proj-picker">
      <label className="proj-sel-lbl" htmlFor="ga-precon-proj-search">
        Project
      </label>
      <input
        id="ga-precon-proj-search"
        type="search"
        className="proj-search"
        placeholder="Search by name, location…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search projects"
        autoComplete="off"
      />
      <select
        id="ga-precon-view"
        className="proj-sel"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (onCloseNav) onCloseNav();
        }}
        aria-label="Select dashboard or project"
      >
        <option value="dashboard">Dashboard — all projects ({total})</option>
        <option value="mywork">My Work — your assignments</option>
        {filtered.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.loc ? ` · ${p.loc}` : ''}
          </option>
        ))}
      </select>
      {search.trim() ? (
        <span className="proj-search-hint" aria-live="polite">
          {shown} of {total}
        </span>
      ) : null}
    </div>
  );
}
