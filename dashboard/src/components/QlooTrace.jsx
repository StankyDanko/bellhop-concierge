// The Qloo call trace and the counterfactual line.
//
// TraceTable: every upstream request a call made (endpoint, the exact params sent, mock or
// live, cache, time, result count). The API key is never in the data, so it cannot show.
// Counterfactual: the places with no taste signal next to the places with it (whole lists).
// SessionTrace: the expandable "Qloo calls (n)" block on a Calls row.
// RequestBehind: the landing's "The request behind this pick".
// CallRail: the call as numbered stations on one rail, grouped from the trace (V1).
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../icons.jsx';
import { SampleBadge, SourceChip } from './ui.jsx';
import '../trace.css';

const SOURCE_LABEL = { qloo: 'Qloo', ticketmaster: 'Ticketmaster' };

export const MOCK_NOTE = 'Mock mode: names outside the sample set resolve to nothing until the Qloo key is live.';

/**
 * True for a call whose every taste lookup came back empty from the mock fixtures: the
 * guest named something outside the sample set, so nothing could resolve.
 * @param {Array<{ tool?: string, mode?: string, results?: number }>} trace
 */
export function unresolvedInMock(trace) {
  const resolves = (trace ?? []).filter((e) => e.tool === 'resolve_taste');
  return resolves.length > 0 && resolves.every((e) => e.mode === 'mock' && !e.results);
}

export function MockNote() {
  return <p className="mock-note">{MOCK_NOTE}</p>;
}

/** What a request was for, read from its own params, so the trace explains itself. */
function purposeOf(e) {
  const p = e.params ?? {};
  if (p['filter.results.entities']) return 'Scored for one person';
  if (e.tool === 'cross_domain') return `Cross-domain: ${String(p['filter.type'] ?? '').split(':').at(-1) || 'other'}`;
  if (e.endpoint === '/v2/insights' && !Object.keys(p).some((k) => k.startsWith('signal.'))) return 'No taste signal';
  return null;
}

function ParamList({ params }) {
  const entries = Object.entries(params ?? {});
  if (!entries.length) return <span className="dim">no params</span>;
  return (
    <ul className="trace-params">
      {entries.map(([k, v]) => <li key={k}><span className="k">{k}</span>=<span className="v">{v}</span></li>)}
    </ul>
  );
}

function Facts({ e }) {
  return (
    <span className="trace-facts">
      <span className={`chip chip-mono${e.mode === 'live' ? ' chip-success' : ''}`}>{e.mode === 'live' ? 'Live' : 'Mock'}</span>
      <span className="chip chip-mono">{e.cache === 'hit' ? 'Cache hit' : 'Cache miss'}</span>
      <span className="num">{e.ms} ms</span>
      <span className="num">{e.results} result{e.results === 1 ? '' : 's'}</span>
      {e.error && <span className="chip chip-mono chip-warning">Failed: {e.error}</span>}
    </span>
  );
}

/** A table on wide containers, a stack of small cards on narrow ones (same markup). */
export function TraceTable({ trace }) {
  if (!trace?.length) return <p className="dim trace-empty">No Qloo or Ticketmaster requests were recorded for this call.</p>;
  return (
    <div className="trace-wrap">
      <div className="trace-head" aria-hidden="true">
        <span>#</span><span>Request</span><span>Params sent</span><span>How answered</span>
      </div>
      <ol className="trace-list" aria-label={`${trace.length} upstream requests, in call order`}>
        {trace.map((e) => (
          <li key={e.n} className="trace-row">
            <span className="trace-n num">{e.n}</span>
            <span className="trace-req">
              <SourceChip source={SOURCE_LABEL[e.source] ?? e.source} />
              <code className="trace-endpoint">GET {e.endpoint}</code>
              <span className="micro mono">{e.tool}</span>
              {e.mapped_from && <span className="micro mono trace-mapped">from "{e.mapped_from}"</span>}
              {purposeOf(e) && <span className="chip chip-taste trace-purpose">{purposeOf(e)}</span>}
            </span>
            <ParamList params={e.params} />
            <Facts e={e} />
          </li>
        ))}
      </ol>
    </div>
  );
}

const keyOf = (p) => p?.entity_id || p?.name;
const sameItem = (a, b) => (a.entity_id && a.entity_id === b.entity_id) || a.name === b.name;

/**
 * V2, "Your words moved the answer": the town's most popular list next to the guest's list.
 * A place on both lists is joined by a thin line (wide containers) and says where it ranked
 * without the guest's words (every width). A place only the guest's words found carries the
 * taste dot and "new". When the two agree, a quiet neutral state says so and pads nothing.
 */
function ContrastLists({ cf }) {
  const without = cf.without_list;
  const withL = cf.with_list;
  const agrees = cf.verdict === 'agrees';
  const rows = Math.max(without.length, withL.length, 1);
  const links = withL
    .map((p, j) => ({ j, i: without.findIndex((w) => sameItem(w, p)) }))
    .filter((l) => l.i >= 0);
  return (
    <div className="cf-lists" style={{ '--cf-rows': rows }}>
      <p className="cf-col-head cf-head-without">
        <span className="micro">Without your words</span>
        <span className="cf-col-sub">The town's most popular</span>
      </p>
      <p className="cf-col-head cf-head-with">
        <span className="micro cf-with-label">With them</span>
        <span className="cf-col-sub">Ranked by Qloo for this guest</span>
      </p>
      <ol className="cf-list cf-list-without" aria-label="Most popular nearby, with no taste">
        {without.map((p, i) => {
          const kept = withL.some((o) => sameItem(o, p));
          return (
            <li key={keyOf(p)} className="cf-item" data-kept={kept ? 'yes' : 'no'}>
              <span className="cf-rank num">{i + 1}</span>
              <span className="cf-name" title={p.name}>{p.name}</span>
            </li>
          );
        })}
      </ol>
      <svg className="cf-links" viewBox={`0 0 10 ${rows}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {links.map(({ i, j }) => (
          <line key={`${i}-${j}`} x1="0" y1={i + 0.5} x2="10" y2={j + 0.5} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <ol className="cf-list cf-list-with" aria-label="Ranked for this guest's tastes">
        {withL.map((p, j) => {
          const i = without.findIndex((w) => sameItem(w, p));
          const isNew = i < 0;
          return (
            <li key={keyOf(p)} className="cf-item" data-new={isNew && !agrees ? 'yes' : 'no'}>
              <span className="cf-rank num">{j + 1}</span>
              <span className="cf-name" title={p.name}>{p.name}</span>
              {isNew
                ? <span className="cf-tag cf-tag-new"><span className="cf-dot" aria-hidden="true" />new</span>
                : <span className="cf-tag">was <span className="num">{i + 1}</span></span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Without Qloo taste vs. with it. With the whole-list payload (with_list, without_list), the two
 * lists side by side; when the town and the guest agree, a quiet neutral state that says so and
 * pads nothing into a fake difference. Older stored sessions carry only the top pick each way,
 * and render as the two-row pair.
 * @param {{ cf: any, mentions?: string[] }} props  mentions: what the guest said, when known
 */
export function Counterfactual({ cf, mentions }) {
  if (!cf) return null;
  const said = (mentions ?? []).filter(Boolean);
  if (Array.isArray(cf.with_list) && Array.isArray(cf.without_list) && cf.with_list.length && cf.without_list.length) {
    const agrees = cf.verdict === 'agrees';
    return (
      <figure className="cf" data-verdict={agrees ? 'agrees' : 'moved'} aria-label="The same search with and without what the guest said">
        <p className="cf-say">{cf.say}</p>
        {said.length > 0 && (
          <p className="cf-said">
            <span className="micro">The guest said</span>
            {said.map((m) => <span key={m} className="chip chip-taste cf-said-chip">{m}</span>)}
          </p>
        )}
        <ContrastLists cf={cf} />
        <figcaption className="cf-foot">
          Same kind of place, same distance, same filters. Only the guest's words differ.
          {' '}<span className="num">{cf.overlap5}</span> of <span className="num">{cf.with_list.length}</span> on both lists.
        </figcaption>
      </figure>
    );
  }
  return (
    <div className="cf" data-verdict={cf.same ? 'agrees' : 'moved'} aria-label="What this guest would have heard without their tastes">
      <p className="micro">Without your words, and with them</p>
      {!cf.same && cf.without_qloo_taste?.name && cf.with_qloo?.name && (
        <dl className="cf-pair">
          <div className="cf-row">
            <dt><span className="chip chip-mono">Without your words</span></dt>
            <dd><strong>{cf.without_qloo_taste.name}</strong> <span className="dim">{cf.without_qloo_taste.reason}</span></dd>
          </div>
          <div className="cf-row">
            <dt><SourceChip source="Qloo" /></dt>
            <dd><strong>{cf.with_qloo.name}</strong> <span className="cf-why">{cf.with_qloo.why}</span></dd>
          </div>
        </dl>
      )}
      <p className="cf-say">{cf.say}</p>
    </div>
  );
}

// ---- V1: how a call becomes a plan ------------------------------------------------------

const hasSignal = (e) => Object.keys(e.params ?? {}).some((k) => k.startsWith('signal.'));
const forOnePerson = (e) => Boolean(e.params?.['filter.results.entities']);
const quoted = (xs) => xs.map((x) => `"${x}"`).join(', ');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Group a call's trace into the stations of the rail. Counts come from the trace itself;
 * a station with no requests (other than the two bookends) is left out.
 * @param {Array<any>} trace
 * @param {{ said?: string[], plusOne?: string[], textChars?: number }} [ctx]
 */
export function stationsOf(trace, { said = [], plusOne = [], textChars } = {}) {
  const rows = trace ?? [];
  const pick = (fn) => rows.filter(fn);
  const results = (rs) => rs.reduce((a, e) => a + (Number(e.results) || 0), 0);
  const resolve = pick((e) => e.tool === 'resolve_taste');
  const ranked = pick((e) => e.tool === 'recommend_nearby' && hasSignal(e) && !forOnePerson(e));
  const person = pick((e) => e.tool === 'recommend_nearby' && forOnePerson(e));
  const plain = pick((e) => e.tool === 'recommend_nearby' && !hasSignal(e));
  const cross = pick((e) => e.tool === 'cross_domain');
  const events = pick((e) => e.tool === 'events_nearby');
  const asked = resolve.map((e) => e.mapped_from || e.params?.query || e.params?.['filter.query']).filter(Boolean);
  const crossType = String(cross[0]?.params?.['filter.type'] ?? '').split(':').at(-1);
  const all = [
    { id: 'said', label: 'The guest names things', rows: [], keep: true,
      caption: said.length ? `${quoted(said)}${plusOne.length ? `, and for the plus-one ${quoted(plusOne)}` : ''}.` : 'A band, a film, a kind of food.' },
    { id: 'resolve', label: 'Each name becomes a Qloo id', rows: resolve,
      caption: asked.length ? `${quoted([...new Set(asked)])}, looked up one by one.` : 'One lookup per thing named.' },
    { id: 'ranked', label: 'Places near the inn, ranked by that taste', rows: ranked,
      caption: `${plural(results(ranked), 'place')} came back, each with its reason.` },
    { id: 'person', label: 'Scored once per person', rows: person,
      caption: 'The same places, scored for the guest and for the plus-one. Nobody is named.' },
    { id: 'plain', label: 'The same search without the taste', rows: plain,
      caption: "The town's popular list, for the comparison above." },
    { id: 'cross', label: 'One taste picks another kind of thing', rows: cross,
      caption: crossType ? `One kind of taste in, a ${crossType} out.` : 'One kind of taste in, another kind of pick out.' },
    { id: 'events', label: 'What is on nearby', rows: events,
      caption: `${plural(results(events), 'event')} came back.` },
    { id: 'text', label: 'One text, at most 320 characters', rows: [], keep: true,
      // 320: MAX_CHARS in server/lib/sms.js (grep -n "MAX_CHARS = 320" server/lib/sms.js)
      caption: typeof textChars === 'number' ? `This one: ${textChars} characters.` : 'Each pick with its reason, and a link.' },
  ];
  return all.filter((s) => s.keep || s.rows.length > 0).map((s) => ({
    ...s,
    source: s.rows[0]?.source ?? null,
    endpoints: [...new Set(s.rows.map((e) => `GET ${e.endpoint}`))],
  }));
}

/** Reads --dwell-step (ms) from the root; 0 under reduced motion (styles.css). */
function dwellMs() {
  if (typeof window === 'undefined') return 0;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--dwell-step').trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) ? (raw.endsWith('ms') ? n : n * 1000) : 0;
}

/**
 * The request rail. Static by default; one user-started "Step through the call" highlights the
 * stations in order. Under reduced motion the button shows every caption at once instead.
 * @param {{ trace: any[], said?: string[], plusOne?: string[], textChars?: number, header?: any }} props
 */
export function CallRail({ trace, said, plusOne, textChars, header }) {
  const stations = stationsOf(trace, { said, plusOne, textChars });
  const [mode, setMode] = useState('idle'); // idle | playing | all
  const [step, setStep] = useState(0);
  const [still, setStill] = useState(false);
  const timer = useRef(null);
  const total = stations.length;

  useEffect(() => { setStill(dwellMs() === 0); }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (mode !== 'playing') return undefined;
    const ms = dwellMs();
    if (!ms) { setMode('all'); return undefined; }
    timer.current = setTimeout(() => {
      if (step + 1 >= total) setMode('all');
      else setStep(step + 1);
    }, ms);
    return () => clearTimeout(timer.current);
  }, [mode, step, total]);
  useEffect(() => {
    if (mode !== 'playing') return undefined;
    const onKey = (ev) => { if (ev.key === 'Escape') setMode('all'); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  const start = () => {
    if (still) { setMode((m) => (m === 'all' ? 'idle' : 'all')); return; }
    if (mode === 'playing') { setMode('all'); return; }
    setStep(0); setMode('playing');
  };
  const label = still
    ? (mode === 'all' ? 'Hide each step' : 'Show each step')
    : (mode === 'playing' ? 'Show all' : (mode === 'all' ? 'Step through it again' : 'Step through the call'));
  const qloo = (trace ?? []).filter((e) => e.source === 'qloo').length;
  const modes = [...new Set((trace ?? []).map((e) => e.mode).filter(Boolean))];

  return (
    <div className="rail-wrap" data-mode={mode}>
      <div className="rail-head">
        <div className="row rail-chips">
          {header}
          {modes.length === 1 && <span className="chip chip-mono">{modes[0] === 'live' ? 'Live' : 'Mock'}</span>}
          <span className="micro mono tnum">{plural((trace ?? []).length, 'request')}, {qloo} to Qloo</span>
        </div>
        <div className="row rail-controls">
          <button type="button" className="btn btn-secondary rail-btn" onClick={start} aria-pressed={mode !== 'idle'}>{label}</button>
          {mode === 'playing' && <span className="micro mono tnum" aria-live="polite">Step {step + 1} of {total}</span>}
        </div>
      </div>
      <ol className="rail" aria-label="The requests one call makes, in order">
        {stations.map((s, i) => {
          const current = mode === 'playing' && i === step;
          const shown = mode === 'all' || current;
          return (
            <li key={s.id} className="station" data-source={s.source ?? 'none'} data-current={current ? 'yes' : 'no'}
              data-dim={mode === 'playing' && !current ? 'yes' : 'no'} aria-current={current ? 'step' : undefined}>
              <span className="station-n num" aria-hidden="true">{i + 1}</span>
              <div className="station-body">
                <p className="station-label">{s.label}</p>
                {s.rows.length > 0 && (
                  <p className="station-meta">
                    <SourceChip source={SOURCE_LABEL[s.source] ?? s.source} />
                    <span className="station-count num">{plural(s.rows.length, 'request')}</span>
                  </p>
                )}
                {s.endpoints.length > 0 && <p className="station-endpoint mono">{s.endpoints.join(' · ')}</p>}
                <p className="station-caption" hidden={!shown}>{s.caption}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** "Qloo calls (n)" toggle with the trace and counterfactual inside. */
export function SessionTrace({ trace, counterfactual, defaultOpen = false, note = false, mentions }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const n = trace?.length ?? 0;
  return (
    <div className="session-trace">
      <button type="button" className="trace-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span>Qloo calls (<span className="num">{n}</span>)</span>
        <Icon name="chev" className="chev" />
      </button>
      <div id={id} className="trace-body" hidden={!open}>
        {note && <MockNote />}
        <TraceTable trace={trace} />
        <Counterfactual cf={counterfactual} mentions={mentions} />
      </div>
    </div>
  );
}

const FAVORS_CHIP = { both: 'For both', guest: 'Leans to the guest', companion: 'For the plus-one' };
const SIGNED_AS = { guest: 'as leaning to the guest', companion: 'as one for the plus-one' };

/** The sample call, from server/fixtures/sample-session.json, always badged. */
export function SampleSessionCard({ session }) {
  if (!session) return null;
  const plusOne = session.companion_mentions?.length > 0;
  const film = session.cross_domain;
  const signed = session.signed_text;
  return (
    <article className="card trace-sample" aria-label="A sample call">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>{session.label ?? 'Sample call'}</h3>
        <SampleBadge>Sample</SampleBadge>
      </div>
      <p className="dim sample-lede">
        A made-up guest who named {session.entities.join(' and ')}{plusOne ? `, calling for two. The plus-one loves ${session.companion_mentions.join(' and ')}` : ''}. This is how every real call appears here: each request the concierge sent to Qloo, exactly as sent.
      </p>
      {session.picks?.length > 0 && (
        <div className="sample-grid">
          <section className="sample-block" aria-label="What the guest heard">
            <p className="micro">What the guest heard</p>
            <ol className="sample-picks">
              {session.picks.map((p) => (
                <li key={p.name}>
                  <p className="sample-pick-head"><strong>{p.name}</strong>{p.favors && <span className={`chip ${p.favors === 'both' ? 'chip-taste' : ''}`}>{FAVORS_CHIP[p.favors] ?? p.favors}</span>}</p>
                  <p className="dim sample-pick-why">{p.why}.{p.favors_line ? ` "${p.favors_line}"` : ''}</p>
                </li>
              ))}
            </ol>
            {plusOne && <p className="micro sample-foot">Each pick scored once per person, one Qloo call each. Nobody is named.</p>}
          </section>
          {film && (
            <section className="sample-block" aria-label="Cross-domain pick">
              <p className="micro">A film to watch at the inn</p>
              <p className="sample-pick-head"><strong>{film.name}</strong>{film.year && <span className="dim tnum">{film.year}</span>}<SourceChip source="Qloo" /></p>
              <p className="dim sample-pick-why">{film.why}. Music taste in, a film out: one domain's signals, another's filter.type.</p>
            </section>
          )}
        </div>
      )}
      {signed && (
        <section className="sample-signed" aria-label="Signed picks">
          <p className="sample-signed-line"><Icon name="check" />Every pick carries a signed token. A claim the server did not sign is dropped before the text goes out.</p>
          {signed.dropped && (
            <p className="dim sample-pick-why">
              Here the text asked to print <code>{signed.dropped.claim}</code>. The server signed that pick {SIGNED_AS[signed.dropped.signed_for] ?? 'without that claim'}, not for both, so <code>(both)</code> was dropped and the pick went out by name.
            </p>
          )}
          {signed.body && <p className="sms sample-sms" aria-label="The text this sample guest got">{signed.body}</p>}
        </section>
      )}
      <SessionTrace trace={session.trace} counterfactual={session.counterfactual} mentions={session.entities} defaultOpen />
    </article>
  );
}

/** Landing: the exact Qloo request behind the sample pick, then the counterfactual line. */
export function RequestBehind({ request, counterfactual }) {
  if (!request) return null;
  return (
    <div className="request-behind">
      <p className="micro">The request behind this pick</p>
      <pre className="request-code"><code>{`GET ${request.endpoint}\n${Object.entries(request.params).map(([k, v]) => `  ${k}=${v}`).join('\n')}`}</code></pre>
      <p className="trace-facts-line"><Facts e={request} /></p>
      <Counterfactual cf={counterfactual} />
    </div>
  );
}
