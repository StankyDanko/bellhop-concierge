// Shared bricks: LiveBadge, chips, Stat, PickCard with WhyChip, SmsPreview, banners.
// Component names follow DESIGN-LANGUAGE.md section 5.
import { useEffect, useId, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../icons.jsx';

// ---- formatting ----------------------------------------------------------------

/** "+1 555 010 0199" style input -> "(555) 010-0199" for US numbers; anything else is shown as given. */
export function formatPhone(raw) {
  const d = String(raw ?? '').replace(/\D/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : String(raw ?? '');
}

export function telHref(raw) {
  const d = String(raw ?? '').replace(/[^\d+]/g, '');
  return d ? `tel:${d}` : undefined;
}

export function timeAgo(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const m = Math.round((now - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const days = Math.round(h / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function clock(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ---- health (the LiveBadge truth source) --------------------------------------------

/** Reads /api/health-summary on mount and every 30 s. Never assumes the line is up. */
export function useHealth() {
  const [health, setHealth] = useState({ state: 'checking', data: null });
  useEffect(() => {
    let active = true;
    const load = async () => {
      const r = await api('/health-summary');
      if (!active) return;
      setHealth(r.ok ? { state: r.data.line.state, data: r.data } : { state: 'busy', data: null });
    };
    load();
    const t = setInterval(load, 30000);
    return () => { active = false; clearInterval(t); };
  }, []);
  return health;
}

const BADGE_LABEL = {
  checking: 'Checking the line',
  answering: 'Answering now',
  test: 'Test mode',
  paused: 'Paused',
  busy: 'Line busy, try again in a minute',
};

export function LiveBadge({ state = 'checking', lastSessionAt }) {
  const ago = state === 'answering' && lastSessionAt ? timeAgo(lastSessionAt) : null;
  return (
    <span className="live-badge" data-live-badge data-state={state} role="status">
      <span className="live-dot" aria-hidden="true" />
      {state === 'busy' && <Icon name="warn" width="14" height="14" />}
      {BADGE_LABEL[state] ?? BADGE_LABEL.checking}
      {ago && <span className="dim" style={{ fontWeight: 500 }}>· last call {ago}</span>}
    </span>
  );
}

// ---- chips ----------------------------------------------------------------------------

export function SourceChip({ source }) {
  const s = String(source ?? '').toLowerCase();
  if (s === 'qloo') return <span className="chip chip-mono chip-qloo">Qloo</span>;
  if (s === 'ticketmaster') return <span className="chip chip-mono chip-info">Ticketmaster</span>;
  if (s === 'owner') return <span className="chip chip-mono">Owner's pick</span>;
  return <span className="chip chip-mono">{source}</span>;
}

export function SampleBadge({ children = 'Sample data' }) {
  return <span className="chip chip-mono chip-sample">{children}</span>;
}

/** How the server answered: live Qloo, cached, or the mock fixtures. Honest by construction. */
export function ViaChip({ upstream }) {
  const vias = [...new Set((upstream ?? []).filter((u) => u.service === 'qloo').map((u) => u.via))];
  if (!vias.length) return null;
  const label = vias.includes('mock') ? 'Mock fixtures' : vias.includes('cache') ? 'Qloo, cached' : 'Qloo, live';
  return <span className="chip chip-mono" title="How the tool server answered this request">{label}</span>;
}

// ---- Stat: a number never travels without its source ------------------------------------

export function Stat({ label, value, unit, source }) {
  if (!source) throw new Error(`Stat "${label}" needs a source`);
  return (
    <div className="card stat">
      <p className="micro">{label}</p>
      <p className="value">{value}{unit && <span className="unit">{unit}</span>}</p>
      <p className="micro mono source">{source}</p>
    </div>
  );
}

// ---- PickCard + WhyChip ------------------------------------------------------------------

export function WhyChip({ place, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const trace = place.why_trace ?? { basis: 'affinity', drivers: [] };
  const explained = trace.basis === 'explainability' && trace.drivers?.length > 0;
  const max = Math.max(1, ...(trace.drivers ?? []).map((d) => d.score ?? 0));
  return (
    <div className={`why${explained ? '' : ' neutral'}`}>
      <button type="button" className="why-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <Icon name="why" />
        <span>{explained ? place.why : 'Strong match for your overall taste'}</span>
        <Icon name="chev" className="chev" />
      </button>
      <div id={id} className="why-body" hidden={!open}>
        {explained ? (
          <>
            <p className="micro" style={{ color: 'inherit' }}>Why Qloo picked it, by what you said</p>
            {trace.drivers.map((d) => (
              <div className="driver" key={d.id}>
                <span className="driver-name" title={d.name}>{d.name}</span>
                <span className="bar" aria-hidden="true"><span style={{ transform: `scaleX(${(d.score ?? 0) / max})` }} /></span>
                <span className="num">{(d.score ?? 0).toFixed(2)}</span>
              </div>
            ))}
            <p className="micro mono why-foot" style={{ color: 'inherit' }}>
              Qloo explainability, affinity {typeof place.affinity === 'number' ? place.affinity.toFixed(2) : 'n/a'}
            </p>
          </>
        ) : (
          <p className="micro mono">Qloo affinity, no per-input reason</p>
        )}
      </div>
    </div>
  );
}

const PRICE = ['', '$', '$$', '$$$', '$$$$'];

export function PickCard({ place, defaultOpen }) {
  const meta = [
    typeof place.distance_miles === 'number' ? `${place.distance_miles.toFixed(1)} mi away` : null,
    place.price_level ? `${PRICE[place.price_level]} price` : null,
    typeof place.rating === 'number' ? `${place.rating.toFixed(1)} of 5 rating` : null,
  ].filter(Boolean);
  return (
    <article className="pick">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 className="pick-name">{place.name}</h3>
        <SourceChip source={place.source ?? 'Qloo'} />
      </div>
      {meta.length > 0 && <p className="pick-meta tnum">{meta.join(' · ')}</p>}
      <WhyChip place={place} defaultOpen={defaultOpen} />
    </article>
  );
}

// ---- SmsPreview ---------------------------------------------------------------------------

const TRUNC_WORDS = {
  drop_header: 'header dropped', drop_last_why: 'last reason dropped', trim_why_32: 'reasons trimmed', trim_why_20: 'reasons trimmed short', drop_last_pick: 'last pick dropped',
  drop_why: 'reasons dropped', drop_detail: 'times dropped', trim_name: 'names trimmed', drop_link: 'links dropped',
};

export function SmsPreview({ itinerary }) {
  if (!itinerary) return <p className="dim">No text yet. Once a guest asks for the plan, this shows what they received.</p>;
  const steps = [...new Set((itinerary.truncation ?? []).map((t) => TRUNC_WORDS[t] ?? t))];
  return (
    <div className="stack-sm">
      <p className="sms" aria-label="Text message preview">{itinerary.body}</p>
      <p className="micro mono tnum">
        {itinerary.char_count} characters, {itinerary.segments} segment{itinerary.segments === 1 ? '' : 's'}, {itinerary.encoding}
        <span className="visually-hidden">, from compose_itinerary</span>
      </p>
      {steps.length > 0 && <p><span className="chip chip-warning wrap">Shortened to fit 320 characters: {steps.join(', ')}</span></p>}
    </div>
  );
}

// ---- banners ------------------------------------------------------------------------------

export function Banner({ tone = 'info', children, action }) {
  return (
    <div className={`banner banner-${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon name={tone === 'info' ? 'info' : 'warn'} />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {action}
    </div>
  );
}

export function Toast({ message, onDone }) {
  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return <div className="toast" role="status">{message}</div>;
}
