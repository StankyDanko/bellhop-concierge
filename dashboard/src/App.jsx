import { useEffect, useState } from 'react';
import { Icon } from './icons.jsx';
import Brief from './pages/Brief.jsx';
import Builder from './pages/Builder.jsx';
import Landing from './pages/Landing.jsx';
import Privacy from './pages/Privacy.jsx';
import Property from './pages/Property.jsx';
import Terms, { BRIDGE } from './pages/Terms.jsx';
import { useHealth } from './components/ui.jsx';
import { Link, matchBrief, usePath } from './router.jsx';

function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'light');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('bc-theme', theme); } catch { /* storage blocked */ }
  }, [theme]);
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className="btn-text" onClick={() => setTheme(next)} aria-label={`Switch to ${next} theme`} style={{ background: 'none', border: 0, cursor: 'pointer' }}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} width="18" height="18" />
      <span className="visually-hidden">{next} theme</span>
    </button>
  );
}

export default function App() {
  const path = usePath();
  const health = useHealth();
  const repo = health.data?.repo_url;
  const propMatch = /^\/property\/([a-z0-9-]{1,40})\/?$/.exec(path);
  const briefId = matchBrief(path);
  let page;
  if (path === '/') page = <Landing health={health} />;
  else if (/^\/build\/?$/.test(path)) page = <Builder />;
  else if (propMatch) page = <Property id={propMatch[1]} health={health} />;
  else if (briefId) page = <Brief id={briefId} health={health} />;
  else if (/^\/privacy\/?$/.test(path)) page = <Privacy />;
  else if (/^\/terms\/?$/.test(path)) page = <Terms repo={repo} />;
  else page = (
    <div className="container stack">
      <h1>That page isn't here.</h1>
      <p><Link to="/">Back to the front desk</Link></p>
    </div>
  );

  useEffect(() => {
    if (briefId) return; // the brief titles itself with the inn name (the saved PDF's file name)
    const titles = { '/': 'Bellhop Concierge', '/build': 'Build your concierge, Bellhop Concierge', '/privacy': 'Privacy, Bellhop Concierge', '/terms': 'Terms, Bellhop Concierge' };
    document.title = propMatch ? 'Property dashboard, Bellhop Concierge' : titles[path.replace(/\/$/, '') || '/'] ?? 'Bellhop Concierge';
  }, [path, propMatch, briefId]);

  const cur = (p) => (p === '/property' ? (propMatch ? 'page' : undefined) : path === p ? 'page' : undefined);
  return (
    <div className="shell">
      <a className="visually-hidden skip" href="#main">Skip to content</a>
      <header className="topbar">
        <div className="container">
          <Link to="/" className="wordmark"><Icon name="bell" />Bellhop Concierge</Link>
          <nav className="topnav" aria-label="Main">
            <Link to="/" aria-current={cur('/')}>Demo</Link>
            <Link to="/build" aria-current={cur('/build')}>Build yours</Link>
            <Link to="/property/demo" aria-current={cur('/property')}>Dashboard</Link>
            {repo && <a href={repo} rel="noopener">GitHub</a>}
            <ThemeToggle />
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1}>{page}</main>
      <footer className="footer">
        <div className="container">
          <p>Bellhop Concierge, an edition of Bellhop by SouthernSky. AGPL-3.0.</p>
          <nav className="footer-links" aria-label="Site">
            {repo && <a href={repo} rel="noopener">Source</a>}
            <Link to="/privacy" aria-current={path === '/privacy' ? 'page' : undefined}>Privacy</Link>
            <Link to="/terms" aria-current={path === '/terms' ? 'page' : undefined}>Terms</Link>
          </nav>
          <p>Picks from the Qloo taste graph and Ticketmaster.</p>
          <p className="footer-bridge">{BRIDGE}</p>
        </div>
      </footer>
    </div>
  );
}
