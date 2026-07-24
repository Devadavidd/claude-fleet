// Theme state shared by the app. The sun/moon toggle in AppHeader flips this;
// the actual re-skin happens in style.css via var overrides keyed on the
// <html data-theme> attribute this module writes.
//
// Three-way model: 'dark' | 'light' | 'system'. 'system' removes the attribute
// so the CSS @media (prefers-color-scheme) rule takes over. The header toggle
// only flips between the two explicit modes (matching the bell's simple on/off
// feel), but reading honours a stored 'system' if one was ever set.

export type Theme = 'dark' | 'light' | 'system';

const STORAGE_KEY = 'fleet-theme';

export function readThemePref(): Theme {
  if (typeof localStorage === 'undefined') return 'system';
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'dark' || v === 'light' ? v : 'system';
}

// Resolve to the concrete theme actually shown right now (system → OS pref).
export function resolveTheme(pref: Theme): 'dark' | 'light' {
  if (pref === 'system') {
    const prefersLight =
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches;
    return prefersLight ? 'light' : 'dark';
  }
  return pref;
}

// Write the attribute the CSS keys on. 'system' clears it so @media wins.
export function applyTheme(pref: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

export function setThemePref(pref: Theme): void {
  if (typeof localStorage !== 'undefined') {
    if (pref === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, pref);
  }
  applyTheme(pref);
}
