// The guest taste fingerprint (GET /api/properties/:id/fingerprint): what the people who
// call this number like, ranked by how many calls named each taste. Aggregate only, shown
// with its sample size, and never dressed up as a description of the callers themselves.
import { SampleBadge } from './ui.jsx';
import '../fingerprint.css';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
/** 9 -> "nine"; past twenty, digits read fine. */
export const inWords = (n) => WORDS[n] ?? String(n);
const calls = (n) => `${n} ${n === 1 ? 'call' : 'calls'}`;

/**
 * The one sentence every gated panel uses for "how many so far", read from the sessions
 * API's `tastes` counts: all calls, calls that count toward the floor, and calls where
 * something the guest named resolved. Only a call whose own lookups resolved a taste counts
 * toward the floor, so the floor's number is the resolved one. `count` is the floor's own
 * number, used when the counts have not loaded.
 * @param {{ calls: number, signal: number, resolved: number } | undefined} tastes
 * @param {number} count
 */
export function tasteCountText(tastes, count) {
  if (!tastes || (tastes.calls === tastes.signal && tastes.signal === tastes.resolved)) return `You have ${count}.`;
  return `You have ${calls(tastes.calls)}, ${tastes.resolved} that named a taste the tools could resolve.`;
}

/** The small tag on every innkeeper panel saying what the numbers describe. */
export function BasisTag({ basis, n }) {
  if (basis === 'callers') return <span className="chip chip-mono fp-tag fp-tag-callers" title={`Built from ${calls(n)} to this number`}>Callers <span className="tnum">{n}</span></span>;
  if (basis === 'sample') return <span className="chip chip-mono fp-tag fp-tag-sample" title={`Example data: ${calls(n)} from fictional callers`}>Sample</span>;
  if (basis === 'area') return <span className="chip chip-mono fp-tag" title="No guest tastes used: the whole area around the inn">Area</span>;
  return null;
}

function Chips({ items }) {
  return (
    <ul className="fp-chips" aria-label="Tastes, with how many calls named each">
      {items.map((e) => (
        <li key={e.id} className="fp-chip">
          <span className="fp-chip-name">{e.name ?? 'A taste Qloo knows by id'}</span>
          <span className="fp-chip-n tnum" aria-label={`${calls(e.sessions)}`}>{e.sessions}</span>
        </li>
      ))}
    </ul>
  );
}

/** The card at the top of the insights section. `fp` is a useApi state. */
export function FingerprintCard({ fp, onSample, tastes }) {
  const head = (d) => (
    <div className="panel-head">
      <h3>Your callers' taste fingerprint</h3>
      <div className="row">
        {d && <BasisTag basis={d.basis === 'none' ? null : d.basis} n={d.sessions} />}
        {d?.basis === 'sample' && <SampleBadge />}
      </div>
    </div>
  );
  if (fp.state === 'loading') return <section className="card fp-card" aria-busy="true" aria-label="Loading the taste fingerprint">{head(null)}<div className="skeleton" style={{ height: '6rem', marginTop: 'var(--space-3)' }} /></section>;
  if (fp.state === 'error') return <section className="card fp-card" aria-label="Your callers' taste fingerprint">{head(null)}<p className="dim fp-line">The fingerprint could not be read just now. Your concierge keeps answering calls as normal.</p></section>;

  const d = fp.data;
  if (d.basis === 'none') {
    return (
      <section className="card fp-card" aria-label="Your callers' taste fingerprint">
        {head(d)}
        <p className="fp-line">People who call this number, not the town.</p>
        <div className="gate-bricks" aria-hidden="true">{Array.from({ length: d.gate.min }, (_, i) => <span key={i} className={i < d.gate.count ? 'on' : ''} />)}</div>
        <p>Your fingerprint appears after {d.gate.min} calls that name a taste. {tasteCountText(tastes, d.gate.count)} Until then no single caller can be picked out of it.</p>
        {onSample && <button type="button" className="btn btn-text fp-preview" onClick={onSample}>Preview it with sample callers</button>}
      </section>
    );
  }

  const items = [...d.entities, ...d.tags].sort((a, b) => b.sessions - a.sessions).slice(0, 10);
  return (
    <section className="card fp-card" aria-label="Your callers' taste fingerprint">
      {head(d)}
      <p className="fp-line">{d.basis === 'sample' ? 'Fictional callers, to show how it looks. Yours replaces it after five calls.' : 'People who call this number, not the town.'}</p>
      <p className="fp-size">
        <span className="fp-size-n tnum">{d.sessions}</span>
        <span className="fp-size-unit">{d.sessions === 1 ? 'call' : 'calls'}, all time</span>
        <span className="fp-size-words">({inWords(d.sessions)} {d.basis === 'sample' ? 'sample ' : ''}{d.sessions === 1 ? 'call' : 'calls'} that named a taste)</span>
      </p>
      {items.length ? <Chips items={items} /> : <p className="dim fp-line">No tastes named yet.</p>}
      <p className="micro fp-caveat">Qloo describes people who share these tastes around here, not your callers.</p>
      <p className="micro mono panel-foot">Sent to Qloo as signal.interests.entities and signal.interests.tags</p>
    </section>
  );
}

/** One line for the brief: the fingerprint's sample size and what it describes. */
export function FingerprintSizeLine({ fp }) {
  if (fp.state !== 'ok') return null;
  const d = fp.data;
  if (d.basis === 'callers') {
    return <p className="brief-note fp-brief-line">Taste fingerprint from <span className="tnum">{d.sessions}</span> {d.sessions === 1 ? 'call' : 'calls'}, all time. People who call this number, not the town.</p>;
  }
  return <p className="brief-note fp-brief-line">Taste fingerprint starts after {d.gate.min} calls that name a taste. <span className="tnum">{d.gate.count}</span> so far.</p>;
}
