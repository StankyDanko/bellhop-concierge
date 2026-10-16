// `/property/:id/brief`: the one-page innkeeper brief. A letter-size document an innkeeper
// prints or saves as PDF and hands to a co-owner, a manager, or a new hire, with a tear-off
// room card at the bottom. Every section is built from the same read routes the dashboard
// uses; nothing on this page is a number we did not measure.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../icons.jsx';
import { Link } from '../router.jsx';
import { RoomCard } from '../components/brief-room-card.jsx';
import { formatPhone, SampleBadge } from '../components/ui.jsx';
import { FingerprintSizeLine } from '../components/Fingerprint.jsx';
// Fallback only, for when /api/guardrails cannot be reached: the same module the server
// serves, so the printed list can never drift from the enforced one.
import { LOCKED_RULES } from '../../../server/api/guardrails.js';
import '../brief.css';

/** The sample guest the landing page and the dashboard already use (routes.js SAMPLE_MENTIONS). */
const SAMPLE_TASTES = ['Sturgill Simpson', 'Thai food', 'Wes Anderson'];
const AGE = { '24_and_younger': '24 and under', '25_to_29': '25 to 29', '30_to_34': '30 to 34', '35_to_44': '35 to 44', '45_to_54': '45 to 54', '55_and_older': '55 and over' };

function useApiOnce(path) {
  const [s, setS] = useState({ state: 'loading' });
  useEffect(() => {
    let active = true;
    setS({ state: 'loading' });
    api(path).then((r) => { if (active) setS(r.ok ? { state: 'ok', data: r.data } : { state: 'error', status: r.status }); });
    return () => { active = false; };
  }, [path]);
  return s;
}

// ---- geometry (same math as the dashboard heatmap) ------------------------------------------

const toRad = (d) => (d * Math.PI) / 180;
function milesBetween(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}
function direction(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(deg / 45) % 8];
}
const signed = (n) => `${n > 0 ? '+' : ''}${n.toFixed(2)}`;

/** "27 Larkspur Lane, Savannah, GA 31401" -> "Savannah, GA". Anything unexpected -> null. */
function townOf(address) {
  const parts = String(address ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 3) return parts.length === 2 ? parts[1] : null;
  const state = parts[parts.length - 1].split(/\s+/)[0];
  return `${parts[parts.length - 2]}, ${state}`;
}

// ---- sections -------------------------------------------------------------------------------

function Section({ title, aside, children, className = '' }) {
  return (
    <section className={`brief-sec ${className}`}>
      <div className="brief-sec-head"><h2>{title}</h2>{aside}</div>
      {children}
    </section>
  );
}

function Src({ children }) {
  return <span className="brief-src">{children}</span>;
}

/** (c) What guests asked for: real tastes above the five-call floor, the sample guest below it. */
function GuestTastes({ sessions }) {
  if (sessions.state === 'loading') return <p className="brief-dim">Loading the call log.</p>;
  if (sessions.state === 'error') return <p className="brief-dim">The call log could not be read just now, so this section is left off.</p>;
  const d = sessions.data;
  if (!d.gate.open) {
    return (
      <>
        <ol className="brief-ranked">
          {SAMPLE_TASTES.map((t) => <li key={t}><span>{t}</span></li>)}
        </ol>
        <p className="brief-note">Shown as an example until five guests have called. <span className="tnum">{d.gate.count}</span> of {d.gate.min} so far.</p>
      </>
    );
  }
  const list = d.sessions ?? [];
  const counts = new Map();
  for (const s of list) for (const name of new Set(s.entities.map((n) => n.toLowerCase()))) counts.set(name, (counts.get(name) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!top.length) return <p className="brief-dim">Guests have called, but none named a taste yet.</p>;
  const scope = d.total > list.length ? `the last ${list.length} calls` : `${list.length} calls`;
  return (
    <>
      <ol className="brief-ranked">
        {top.map(([name, n]) => <li key={name}><span className="brief-cap">{name}</span><span className="num tnum">{n} of {list.length}</span></li>)}
      </ol>
      <p className="brief-note">From the inn's own call log, {scope}. No names, numbers, or transcripts kept.</p>
    </>
  );
}

/** (d) What the area is strong in: ranked lists only; a section that is not ready gets one line. */
function AreaStrengths({ ins, inn }) {
  if (ins.state === 'loading') return <p className="brief-dim">Loading area insights.</p>;
  if (ins.state === 'error') return <p className="brief-dim">Qloo did not answer this time, so area insights are left off this copy.</p>;
  const d = ins.data;
  // Sections that are not ready share one line per reason, so a gated inn costs one line, not two.
  const REASON = {
    gated: 'After five guest calls, this brief adds',
    skipped: 'Left off until guests name two favorites:',
    degraded: 'Left off because Qloo did not answer this time:',
  };
  const omitted = [];
  const off = (label, sec) => ({ label, reason: REASON[sec.status] ?? REASON.degraded });
  const blocks = [];

  const heat = d.heatmap;
  if (heat.status === 'ok' && heat.cells?.length) {
    blocks.push(
      <div key="heat">
        <p className="brief-sub">Taste affinity by block, {d.area.radius_miles} mi{heat.basis === 'area' ? ', area-wide' : ', guest tastes'}</p>
        <ol className="brief-ranked">
          {heat.cells.slice(0, 3).map((c) => (
            <li key={c.geohash ?? `${c.lat},${c.lng}`}>
              <span className="tnum">{milesBetween(inn, c).toFixed(1)} mi {direction(inn, c)}</span>
              <span className="num tnum">{(c.affinity ?? 0).toFixed(2)}</span>
            </li>
          ))}
        </ol>
      </div>,
    );
  } else omitted.push(off('the taste map', heat));

  const demo = d.demographics;
  if (demo.status === 'ok' && demo.age) {
    const bands = Object.entries(demo.age).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (bands.length) {
      blocks.push(
        <div key="demo">
          <p className="brief-sub">Ages leaning in, vs. area average</p>
          <ol className="brief-ranked">
            {bands.map(([k, v]) => <li key={k}><span>{AGE[k] ?? k.replace(/_/g, ' ')}</span><span className="num tnum">{signed(v)}</span></li>)}
          </ol>
        </div>,
      );
    }
  } else omitted.push(off('who shares these tastes', demo));

  const cmp = d.compare;
  if (cmp.status === 'ok' && cmp.items?.length) {
    const items = [...cmp.items].sort((p, q) => Math.abs(q.scores.difference ?? 0) - Math.abs(p.scores.difference ?? 0)).slice(0, 2);
    blocks.push(
      <div key="cmp">
        <p className="brief-sub">{cmp.groups?.label ? `${cmp.groups.label}: (+) leans to your callers, (-) to the town` : `${cmp.groups?.a ?? 'One favorite'} (+) vs. ${cmp.groups?.b ?? 'another'} (-) fans`}</p>
        <ol className="brief-ranked">
          {items.map((it) => {
            const v = it.scores.difference ?? 0;
            return <li key={it.id ?? it.name}><span>{it.name}{Math.abs(v) < 0.05 ? ', about even' : ''}</span><span className="num tnum">{signed(v)}</span></li>;
          })}
        </ol>
      </div>,
    );
  } else omitted.push(off('two kinds of guests compared', cmp));

  return (
    <div className="brief-area">
      {blocks}
      <div className="brief-area-notes">
      {[...new Set(omitted.map((o) => o.reason))].map((reason) => (
        <p key={reason} className="brief-note">{reason} {omitted.filter((o) => o.reason === reason).map((o) => o.label).join(' and ')}.</p>
      ))}
      <p className="brief-note">As of {new Date(d.as_of).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. Aggregate, anonymous.</p>
      </div>
    </div>
  );
}

// ---- page -------------------------------------------------------------------------------------

export default function Brief({ id, health }) {
  const prop = useApiOnce(`/properties/${id}`);
  const sessions = useApiOnce(`/properties/${id}/sessions`);
  const ins = useApiOnce(`/properties/${id}/insights?radius=2`);
  const fp = useApiOnce(`/properties/${id}/fingerprint`);
  const rails = useApiOnce('/guardrails');
  const name = prop.data?.config?.property?.name;

  useEffect(() => {
    // The title doubles as the file name when the innkeeper saves the page as a PDF.
    if (name) document.title = `Innkeeper brief, ${name}`;
  }, [name]);

  if (prop.state === 'loading') return <div className="brief-screen"><div className="brief-page skeleton" style={{ minHeight: '40rem' }} aria-busy="true" aria-label="Loading the brief" /></div>;
  if (prop.state === 'error') {
    return (
      <div className="container stack">
        <h1 style={{ fontSize: 'var(--text-2xl)' }}>{prop.status === 404 ? 'No property by that name.' : "We couldn't load this brief."}</h1>
        <p className="row"><Link to="/property/demo/brief" className="btn btn-secondary">Open the demo inn's brief</Link></p>
      </div>
    );
  }

  const cfg = prop.data.config;
  const inn = { lat: cfg.property.lat, lng: cfg.property.lng };
  const town = townOf(cfg.property.address);
  // Only the demo property has a public number today (PUBLIC_DEMO_NUMBER via /api/health-summary).
  // Any other inn gets a write-in line: we never print a number we cannot vouch for.
  const number = id === 'demo' ? health?.data?.demo_number ?? null : null;
  const locked = rails.state === 'ok' ? rails.data.locked : LOCKED_RULES;
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const ready = [sessions, ins, rails, fp].every((s) => s.state !== 'loading') && health?.state !== 'checking';
  const sampleTastes = sessions.state === 'ok' && !sessions.data.gate.open;

  return (
    <div className="brief-screen">
      <div className="brief-toolbar" role="toolbar" aria-label="Brief actions">
        <Link to={`/property/${id}`} className="btn btn-text"><span aria-hidden="true" className="brief-back">&larr;</span>Back to the front desk</Link>
        <button type="button" className="btn btn-primary" onClick={() => window.print()} disabled={!ready}>Print or save as PDF</button>
      </div>

      <article className="brief-page" data-brief-ready={ready ? 'true' : 'false'} aria-label={`Innkeeper brief for ${cfg.property.name}`}>
        <header className="brief-head">
          <div className="brief-head-main">
            <p className="brief-eyebrow">Front desk concierge brief</p>
            <h1>{cfg.property.name}</h1>
            <p className="brief-meta">{town && <>{town} · </>}Prepared {today}</p>
          </div>
          <div className="brief-head-number">
            <p className="brief-eyebrow">The concierge line</p>
            {number
              ? <p className="brief-number tnum">{formatPhone(number)}</p>
              : <p className="brief-number-pending">{id === 'demo' ? 'Number goes live at submission' : 'Your number appears here once it is published'}</p>}
          </div>
        </header>

        <div className="brief-grid">
          <Section title="What it does" className="brief-span">
            <p className="brief-prose">
              Guests call the front desk concierge from their own phone, wherever they are.
              They name two things they love, like a band, a film, or a kind of food.
              They get one text with three places nearby and the reason for each.
            </p>
          </Section>

          <Section title="What guests asked for" aside={sampleTastes ? <SampleBadge /> : null}>
            <GuestTastes sessions={sessions} />
            <FingerprintSizeLine fp={fp} />
          </Section>

          <Section title="What the area is strong in" className="brief-span2" aside={<Src>Qloo</Src>}>
            <AreaStrengths ins={ins} inn={inn} />
          </Section>

          <Section title="How picks are made" className="brief-span">
            <ul className="brief-sources">
              <li><Src>Qloo</Src> The taste graph matches what a guest names to nearby places that people with that taste love, each with a reason.</li>
              <li><Src>Ticketmaster</Src> Live music and events near the inn, tonight or this weekend.</li>
              <li><Src>Innkeeper</Src> Your own favorites, by name, with the reason you gave.</li>
            </ul>
            <p className="brief-note">Distances are given as the tools report them. Places are described only from what the tools return. Texts go only to the number that called.</p>
          </Section>

          <Section title="What it will not do" className="brief-span" aside={<span className="brief-aside"><Icon name="lock" />Always on, for every inn</span>}>
            <ul className="brief-rules">
              {locked.map((r) => <li key={r.id}>{r.rule}</li>)}
            </ul>
          </Section>
        </div>

        <div className="brief-tear" aria-label="Room cards to cut out">
          <p className="brief-tear-label"><span aria-hidden="true">✂</span> Cut along the dashed lines: a room card for the welcome folder and a smaller one for the nightstand.</p>
          <div className="brief-cards">
            <RoomCard name={cfg.property.name} number={number} variant="large" label="Room card, 4 by 6 proportions" />
            <RoomCard name={cfg.property.name} number={number} variant="tent" label="Nightstand card, 3 by 5 proportions" />
          </div>
        </div>
      </article>
    </div>
  );
}
