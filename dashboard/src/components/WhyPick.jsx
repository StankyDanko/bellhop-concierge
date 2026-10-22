// V3, "Why this pick": one pick with its reason traced to the signal (DESIGN-BRIEF section 2).
//
// Honest rules, measured on the live API (key-day verification): Qloo's explainability names
// entity drivers only (an artist, a film). It never attributes a tag such as a cuisine. So a
// tag the guest asked for is shown as "matches your words", read from the place's own tag
// list, with no score. When Qloo gives no per-input reason (basis "affinity"), the card says
// so in a neutral state.
import { useId, useState } from 'react';
import { Icon } from '../icons.jsx';
import { SourceChip } from './ui.jsx';
import { RequestBehind } from './QlooTrace.jsx';

const PRICE = ['', '$', '$$', '$$$', '$$$$'];
const isWordMatch = (d) => d.source === 'tag_match' || String(d.id ?? '').startsWith('urn:tag:');

/** The reason sentence with each Qloo-named driver underlined in taste purple. */
function Reason({ text, names }) {
  const found = names.filter((n) => n && text.includes(n));
  if (!found.length) return <>{text}</>;
  const re = new RegExp(`(${found.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return <>{text.split(re).map((part, i) => (found.includes(part) ? <span key={i} className="why-driver">{part}</span> : part))}</>;
}

/**
 * @param {{ place: any, request?: any }} props
 */
export function WhyPick({ place, request }) {
  const [open, setOpen] = useState(true);
  const id = useId();
  if (!place) return null;
  const trace = place.why_trace ?? { basis: 'affinity', drivers: [] };
  const drivers = trace.drivers ?? [];
  const named = drivers.filter((d) => !isWordMatch(d));
  const words = drivers.filter(isWordMatch);
  const explained = trace.basis === 'explainability' && named.length > 0;
  const max = Math.max(0.01, ...named.map((d) => d.score ?? 0));
  const meta = [
    typeof place.distance_miles === 'number' ? `${place.distance_miles.toFixed(1)} mi away` : null,
    place.price_level ? `${PRICE[place.price_level]} price` : null,
    typeof place.rating === 'number' ? `${place.rating.toFixed(1)} of 5 rating` : null,
  ].filter(Boolean);
  const tags = (place.tags ?? []).slice(0, 6);

  return (
    <article className="whypick" aria-label={`Why ${place.name} was picked`}>
      <div className="whypick-head">
        <h3 className="whypick-name">{place.name}</h3>
        <SourceChip source={place.source ?? 'Qloo'} />
      </div>
      {meta.length > 0 && <p className="pick-meta tnum">{meta.join(' · ')}</p>}

      <p className={`whypick-reason${explained ? '' : ' neutral'}`}>
        {explained ? <Reason text={place.why ?? ''} names={named.map((d) => d.name)} /> : 'Strong match for your overall taste'}
      </p>

      <button type="button" className="btn btn-text whypick-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide the signal' : 'Show the signal'} <Icon name="chev" className="chev" />
      </button>
      <div id={id} className="whypick-trace" hidden={!open}>
        {explained ? (
          <>
            <p className="micro">Qloo names</p>
            <ul className="whypick-drivers">
              {named.map((d) => (
                <li key={d.id ?? d.name} className="driver">
                  <span className="driver-name" title={d.name}>{d.name}</span>
                  <span className="bar" aria-hidden="true"><span style={{ transform: `scaleX(${(d.score ?? 0) / max})` }} /></span>
                  <span className="num">{typeof d.score === 'number' ? d.score.toFixed(2) : 'n/a'}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="micro mono">Qloo affinity, no per-input reason</p>
        )}
        {words.length > 0 && (
          <>
            <p className="micro">From what the guest said</p>
            <ul className="whypick-words">
              {words.map((d) => (
                <li key={d.id ?? d.name}><span className="chip">{d.name}</span><span className="dim">matches your words, read from the place's own tags</span></li>
              ))}
            </ul>
          </>
        )}
        {tags.length > 0 && (
          <p className="whypick-tags"><span className="micro">The place itself</span>{tags.map((t) => <span key={t} className="chip">{t}</span>)}</p>
        )}
        <p className="micro mono whypick-foot">
          Qloo explainability, from this response{typeof place.affinity === 'number' ? `. Affinity ${place.affinity.toFixed(2)}` : ''}
        </p>
      </div>

      {request && (
        <details className="whypick-request">
          <summary>See the exact request</summary>
          <RequestBehind request={request} />
        </details>
      )}
    </article>
  );
}
