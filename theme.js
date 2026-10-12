'use strict';

(() => {
  const system = matchMedia('(prefers-color-scheme: dark)');
  let preference = null;
  try {
    const saved = localStorage.getItem('nuomi-theme');
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch {}

  function applyTheme() {
    const theme = preference || (system.matches ? 'dark' : 'light');
    const dark = theme === 'dark';
    document.documentElement.dataset.theme = theme;
    document.getElementById('theme-color').content = dark ? '#29252f' : '#35323a';
    const button = document.getElementById('theme-toggle');
    if (button) {
      button.title = dark ? '切换到浅色模式' : '切换到深色模式';
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-pressed', String(dark));
      button.querySelector('.theme-label').textContent = dark ? '浅色' : '深色';
    }
  }

  applyTheme();
  system.addEventListener('change', () => { if (!preference) applyTheme(); });
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    document.getElementById('theme-toggle').addEventListener('click', () => {
      preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme();
      try { localStorage.setItem('nuomi-theme', preference); } catch {}
    });
  });
})();
