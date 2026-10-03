// Apply the locally cached preference before the first paint. The workspace is
// the source of truth once it loads; the cache contains only this display choice.
(() => {
  const cacheKey = 'campus.appearance';
  const choices = new Set(['light', 'dark', 'system']);
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try {
    const saved = localStorage.getItem(cacheKey);
    if (choices.has(saved)) preference = saved;
  } catch { /* Appearance still works when browser storage is unavailable. */ }

  function apply(value) {
    preference = choices.has(value) ? value : 'system';
    const scheme = preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = scheme;
    document.documentElement.dataset.themePreference = preference;
    try { localStorage.setItem(cacheKey, preference); } catch { /* Workspace saves persist the preference. */ }
    window.dispatchEvent(new CustomEvent('campus-theme-change'));
  }
  window.campusTheme = Object.freeze({ apply });
  system.addEventListener('change', () => { if (preference === 'system') apply(preference); });
  apply(preference);
})();
