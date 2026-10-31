// Applies the saved theme before first paint (dark is the default; a toggle click saves a pick).
try {
  var t = localStorage.getItem('bc-theme-pick');
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
} catch (e) { /* storage blocked: keep the default */ }
