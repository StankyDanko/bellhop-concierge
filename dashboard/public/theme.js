// Applies the saved theme before first paint (light is the default; see DESIGN-LANGUAGE.md section 1).
try {
  var t = localStorage.getItem('bc-theme');
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
} catch (e) { /* storage blocked: keep the default */ }
