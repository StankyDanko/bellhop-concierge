// `/`: the judge landing. One idea per section, each one shown rather than told
// (DESIGN-BRIEF section 3): the product and the number, what the guest's words changed,
// how a call becomes a plan, why a pick was made, what the innkeeper sees, the safety rules,
// and how to run your own. Every visual is fed by what the server returns.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../icons.jsx';
import { Link } from '../router.jsx';
import { Banner, formatPhone, LiveBadge, SampleBadge, SmsPreview, telHref, Toast, ViaChip } from '../components/ui.jsx';
import { CallRail, Counterfactual } from '../components/QlooTrace.jsx';
import { WhyPick } from '../components/WhyPick.jsx';
import { AreaCard } from '../components/AreaCard.jsx';

/** The eight Qloo capabilities the tool server calls (server/README.md, "How Qloo is load-bearing"). */
const CAPABILITIES = [
  ['Entity search', 'A band name becomes a Qloo artist id.', 'GET /search'],
  ['Tag search', '"Thai food" becomes a cuisine tag.', 'GET /v2/tags'],
  ['Location-scoped insights', 'Places near the inn, ranked for this guest.', 'GET /v2/insights filter.location'],
  ['Cross-domain affinity', 'A music taste picks a restaurant, and a film to watch at the inn.', 'GET /v2/insights signal.* + filter.type'],
  ['Explainability', 'The reason behind a pick, when Qloo names one.', 'feature.explainability=true'],
  ['Heatmap', 'Where around the inn a taste runs hottest.', 'GET /v2/insights filter.type=urn:heatmap'],
  ['Demographics', 'Which age groups lean toward guest tastes.', 'GET /v2/insights filter.type=urn:demographics'],
  ['Audience compare', 'How two kinds of guests differ.', 'GET /v2/analysis/compare'],
];

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen'];

/** One GET on mount; path null waits (the demo inn id comes from /health). */
function useGet(path) {
  const [s, setS] = useState({ state: 'loading' });
  useEffect(() => {
    if (!path) return undefined;
    let active = true;
    api(path).then((r) => { if (active) setS(r.ok ? { state: 'ok', data: r.data } : { state: 'error' }); });
    return () => { active = false; };
  }, [path]);
  return s;
}

function NumberCard({ number, onCopy, cardRef, live, innName, health }) {
  const badge = <LiveBadge state={health.state} lastSessionAt={health.data?.last_session_at} />;
  if (!number) {
    return (
      <div className="number-card" ref={cardRef}>
        <div className="number-card-head"><p className="micro">Try it: {innName}, a sample inn</p>{badge}</div>
        <p className="the-number pending">Number goes live at submission</p>
        <p className="caption">The phone line opens with the hackathon submission. Until then, everything on this page and the dashboard works in full.</p>
      </div>
    );
  }
  const pretty = formatPhone(number);
  return (
    <div className="number-card" ref={cardRef}>
      <div className="number-card-head"><p className="micro">Try it: call {innName}, a sample inn</p>{badge}</div>
      <a className="number-link" href={telHref(number)} aria-label={`Call ${pretty}`}>
        <span className="the-number">{pretty}</span>
      </a>
      <p className="caption">{live ? 'The inn is fictional. The calls and texts are real.' : 'The inn is fictional. Today the line answers with sample places until the Qloo key is live.'}</p>
      <div className="row number-actions">
        <a className="btn btn-primary btn-lg only-coarse" href={telHref(number)}><Icon name="phone" />Call now</a>
        <button type="button" className="btn btn-primary only-fine" onClick={onCopy}><Icon name="copy" />Copy number</button>
        <Link to="/build" className="btn btn-text">Build your own <Icon name="arrow" /></Link>
      </div>
    </div>
  );
}

/** A section: headline sentence, one supporting line, one visual. */
function Chapter({ id, title, line, children, aside }) {
  return (
    <section className="chapter" aria-labelledby={id}>
      <div className="chapter-head">
        <h2 id={id}>{title}</h2>
        {line && <p className="chapter-line">{line}</p>}
        {aside}
      </div>
      {children}
    </section>
  );
}

export default function Landing({ health }) {
  const data = health.data;
  const number = data?.demo_number;
  const innName = data?.demo?.name ?? 'the demo inn';
  const demoId = encodeURIComponent(data?.demo?.id ?? 'demo');
  const ready = health.state !== 'checking';
  const pick = useGet('/sample-pick');
  const itin = useGet(ready ? `/properties/${demoId}/itinerary-sample` : null);
  const calls = useGet(ready ? `/properties/${demoId}/sessions` : null);
  const insights = useGet(ready ? `/properties/${demoId}/insights?sample=1&radius=2` : null);
  const fingerprint = useGet(ready ? `/properties/${demoId}/fingerprint?sample=1` : null);
  const guardrails = useGet('/guardrails');
  const [toast, setToast] = useState('');
  const cardRef = useRef(null);
  const [showBar, setShowBar] = useState(false);

  // Phone only: a sticky "Call now" bar appears once the number card scrolls away.
  useEffect(() => {
    if (!number || !cardRef.current || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(([e]) => setShowBar(!e.isIntersecting), { threshold: 0 });
    io.observe(cardRef.current);
    return () => io.disconnect();
  }, [number]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(number); setToast('Number copied.'); } catch { setToast(`The number is ${formatPhone(number)}.`); }
  };

  const p = pick.state === 'ok' ? pick.data : null;
  const cf = p && p.places?.length > 0 ? p.counterfactual : null;
  const moved = cf?.verdict === 'moved' || (cf && !cf.verdict && cf.same === false);
  const sms = itin.state === 'ok' ? itin.data.itinerary : null;
  const session = calls.state === 'ok' ? calls.data.sample_session : null;
  const firstPick = p?.places?.[0] ?? null;
  // Twelve today: curl -s localhost:8787/api/guardrails | node -e '...locked.length' (LOCKED_RULES in server/api/guardrails.js).
  const locked = guardrails.state === 'ok' ? guardrails.data.locked?.length : null;

  return (
    <div className={`container landing${number ? ' has-callbar' : ''}`}>
      {/* 1. Hero: the product statement, then the number (volume 1). */}
      <section className="hero" aria-labelledby="hero-h">
        <div className="hero-main">
          <p className="product-name">Bellhop Concierge</p>
          <h1 id="hero-h">The front desk concierge for small inns.</h1>
          {/* "three": the stop rule in template/concierge.md (grep -n "three named things" template/concierge.md)
              and compose_itinerary's "One to three picks" (grep -n "One to three picks" compiler/tools.js). */}
          <p className="hero-lead">Guests call the number on the room card and name up to three things they love. A text follows with up to three picks nearby, and the reason for each when it fits.</p>
          <NumberCard number={number} onCopy={copy} cardRef={cardRef} live={health.state === 'answering'} innName={innName} health={health} />
          {health.state === 'busy' && (
            <Banner tone="warning">We couldn't reach the concierge's tool server just now. The number stays the same; try again in a minute.</Banner>
          )}
        </div>
        {sms && (
          <aside className="hero-sms" aria-labelledby="sms-h">
            <div className="hero-sms-head">
              <p className="micro" id="sms-h">The text a guest gets</p>
              <SampleBadge>Sample</SampleBadge>
            </div>
            <SmsPreview itinerary={sms} />
          </aside>
        )}
      </section>

      {/* 2. V2: what the guest's words changed, the two lists from the counterfactual call. */}
      {pick.state !== 'error' && (
        <Chapter id="words-h" title={moved ? 'Your words moved the answer.' : 'What your words changed.'}
          line="The same search near the inn, once with what the guest said and once without it."
          aside={p && <p className="row chapter-chips"><SampleBadge>Sample guest</SampleBadge><ViaChip upstream={p.upstream} /></p>}>
          {pick.state === 'loading' && <div className="skeleton cf-skeleton" aria-busy="true" aria-label="Loading the comparison" />}
          {cf && <Counterfactual cf={cf} mentions={p.mentions} />}
          {p && !cf && <p className="dim">No sample pick came back for this area. Try again shortly.</p>}
        </Chapter>
      )}

      {/* 3. V1: the request rail, grouped from a sample call's own trace. */}
      <Chapter id="rail-h" title="How a call becomes a plan." line="One call, a handful of requests, in this order. The innkeeper sees every one.">
        {calls.state === 'loading' && <div className="skeleton rail-skeleton" aria-busy="true" aria-label="Loading a sample call" />}
        {calls.state === 'error' && <p className="dim">Request counts appear here after a call.</p>}
        {session && (
          <CallRail trace={session.trace} said={session.entities} plusOne={session.companion_mentions}
            textChars={session.signed_text?.body?.length} header={<SampleBadge>Sample call</SampleBadge>} />
        )}
        <details className="cap-details">
          <summary>Every Qloo capability this uses ({CAPABILITIES.length})</summary>
          <ul className="cap-list">
            {CAPABILITIES.map(([name, what, endpoint]) => (
              <li key={name}><strong style={{ fontWeight: 600 }}>{name}.</strong> {what}<br /><code>{endpoint}</code></li>
            ))}
          </ul>
        </details>
      </Chapter>

      {/* 4. V3: one pick, its reason traced to the signal. */}
      <Chapter id="why-h" title="Why this pick." line="Qloo names what a pick was drawn from when it can. When it cannot, the card says so instead of inventing one.">
        {pick.state === 'loading' && <div className="skeleton why-skeleton" aria-busy="true" aria-label="Loading a sample pick" />}
        {pick.state === 'error' && <Banner tone="warning">Qloo didn't answer this time. The concierge still takes calls and falls back to the innkeeper's own picks.</Banner>}
        {firstPick && <WhyPick place={firstPick} request={p.request} />}
      </Chapter>

      {/* 5. V4 teaser: what the innkeeper sees. */}
      <Chapter id="love-h" title="What your callers love." line="For the innkeeper: the tastes of the people who call this number, on the map around the inn. Dark until five calls.">
        {(insights.state === 'loading' || fingerprint.state === 'loading') && <div className="skeleton area-skeleton" aria-busy="true" aria-label="Loading the area card" />}
        {insights.state === 'ok' && <AreaCard insights={insights.data} fingerprint={fingerprint.state === 'ok' ? fingerprint.data : null} compact />}
        {insights.state === 'error' && <Link to="/property/demo" className="btn btn-text">Open the innkeeper dashboard</Link>}
      </Chapter>

      {/* 6. Proof chips: the safety rules, each one a link to where it shows. */}
      <Chapter id="safe-h" title="Safe by default."
        line={typeof locked === 'number' && locked > 0 ? `${WORDS[locked] ?? locked} rules are always on, for every inn.` : 'The same rules are always on, for every inn.'}>
        <ul className="proof-chips">
          <li><Link to="/property/demo/brief" className="proof-chip"><Icon name="check" />Says it is automated</Link></li>
          <li><Link to="/privacy" className="proof-chip"><Icon name="lock" />Keeps no names or numbers</Link></li>
          <li><Link to="/property/demo" className="proof-chip"><Icon name="dash" />Dark until five calls</Link></li>
        </ul>
      </Chapter>

      {/* 7. Owner CTA. */}
      <section className="chapter card card-lg own" aria-labelledby="own-h">
        <div className="stack">
          <h2 id="own-h">Run your own concierge.</h2>
          {/* "Eleven": grep -c "title: '" dashboard/src/pages/Builder.jsx prints 12; entry 0 is the intro,
              so the builder renders "Question n of 11" (qs.length - 1). */}
          <p className="chapter-line">Eleven questions, then a preview. Nothing goes live until you publish.</p>
          <p className="buyer-line">
            For the innkeeper with no night desk: "what is around here" is 9.0% of 10 million guest messages (<a href="https://www.conduit.ai/blog/what-10-million-guest-messages-are-about" target="_blank" rel="noopener noreferrer">Conduit, 2026</a>).
          </p>
          <div className="row own-actions">
            <Link to="/build" className="btn btn-primary btn-lg">Build yours</Link>
            <Link to="/property/demo" className="btn btn-secondary btn-lg">See the innkeeper dashboard</Link>
            <Link to="/property/demo/brief" className="btn btn-text">See the one-page brief</Link>
          </div>
          {data?.tools && (
            <p className="micro mono">Tool server: Qloo {data.tools.qloo}, Ticketmaster {data.tools.ticketmaster}.{Number.isFinite(Date.parse(data.checked_at)) ? ` Checked ${new Date(data.checked_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''}</p>
          )}
        </div>
      </section>

      {number && showBar && (
        <div className="callbar only-coarse">
          <a className="btn btn-primary" href={telHref(number)}><Icon name="phone" />Call now · <span className="tnum">{formatPhone(number)}</span></a>
        </div>
      )}
      <Toast message={toast} onDone={() => setToast('')} />
    </div>
  );
}
