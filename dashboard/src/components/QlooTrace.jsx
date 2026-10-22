// The Qloo call trace and the counterfactual line.
//
// TraceTable: every upstream request a call made (endpoint, the exact params sent, mock or
// live, cache, time, result count). The API key is never in the data, so it cannot show.
// Counterfactual: the places with no taste signal next to the places with it (whole lists).
// SessionTrace: the expandable "Qloo calls (n)" block on a Calls row.
// RequestBehind: the landing's "The request behind this pick".
import { useId, useState } from 'react';
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

const LIST_STYLE = { margin: 'var(--space-1) 0 0', paddingLeft: '1.25rem', display: 'grid', gap: 'var(--space-1)', fontSize: 'var(--text-sm)', minWidth: 0, overflowWrap: 'anywhere' };
const PAIR_STYLE = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 12rem), 1fr))', gap: 'var(--space-3)', minWidth: 0 };
const AGREE_SAY = { borderLeftColor: 'var(--color-border-strong)' };

/** One side of the contrast: a ranked list, each place marked when it is on the other list too. */
function ContrastList({ label, chip, items, other, highlightMoved }) {
  const onOther = (p) => other.some((o) => (p.entity_id && o.entity_id === p.entity_id) || o.name === p.name);
  return (
    <section aria-label={label} style={{ minWidth: 0 }}>
      {chip}
      <ol style={LIST_STYLE}>
        {items.map((p) => {
          const shared = onOther(p);
          return (
            <li key={p.entity_id || p.name}>
              {highlightMoved && !shared ? <strong className="cf-why">{p.name}</strong> : <span>{p.name}</span>}
              {shared && <span className="dim"> (on both lists)</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The numbers under the two lists, each one read straight from the payload. */
function ContrastFacts({ cf }) {
  const n = cf.with_list.length;
  const pop = cf.popularity_mean ?? {};
  const hasPop = typeof pop.without === 'number' && typeof pop.with === 'number';
  return (
    <p className="micro">
      <span className="num">{cf.overlap5}</span> of <span className="num">{n}</span> on both lists
      {hasPop && <>, average popularity <span className="num">{pop.without.toFixed(2)}</span> without your words and <span className="num">{pop.with.toFixed(2)}</span> with them</>}
    </p>
  );
}

/**
 * Without Qloo taste vs. with it. With the whole-list payload (with_list, without_list), the two
 * lists side by side; when the town and the guest agree, a quiet neutral state that says so and
 * pads nothing into a fake difference. Older stored sessions carry only the top pick each way,
 * and render as before.
 */
export function Counterfactual({ cf }) {
  if (!cf) return null;
  if (Array.isArray(cf.with_list) && Array.isArray(cf.without_list)) {
    const agrees = cf.verdict === 'agrees';
    return (
      <div className="cf" aria-label="What this guest would have heard without their tastes">
        <p className="micro">{agrees ? 'Your taste and the town agree' : 'Without your tastes, and with them'}</p>
        <div style={PAIR_STYLE}>
          <ContrastList label="Most popular nearby, with no taste" chip={<span className="chip chip-mono">Popularity only</span>}
            items={cf.without_list} other={cf.with_list} highlightMoved={false} />
          <ContrastList label="Ranked for this guest's tastes" chip={<SourceChip source="Qloo" />}
            items={cf.with_list} other={cf.without_list} highlightMoved={!agrees} />
        </div>
        <ContrastFacts cf={cf} />
        <p className="cf-say" style={agrees ? AGREE_SAY : undefined}>{cf.say}</p>
      </div>
    );
  }
  return (
    <div className="cf" aria-label="What this guest would have heard without their tastes">
      <p className="micro">Without your tastes, and with them</p>
      {!cf.same && (
        <dl className="cf-pair">
          <div className="cf-row">
            <dt><span className="chip chip-mono">Popularity only</span></dt>
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

/** "Qloo calls (n)" toggle with the trace and counterfactual inside. */
export function SessionTrace({ trace, counterfactual, defaultOpen = false, note = false }) {
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
        <Counterfactual cf={counterfactual} />
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
      <SessionTrace trace={session.trace} counterfactual={session.counterfactual} defaultOpen />
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
