// `/`: the judge landing. In five seconds: the number, that it is live (truthfully),
// what it does, and that Qloo is why (DESIGN-LANGUAGE.md section 9).
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../icons.jsx';
import { Link } from '../router.jsx';
import { Banner, formatPhone, LiveBadge, PickCard, SampleBadge, SmsPreview, telHref, Toast, ViaChip } from '../components/ui.jsx';
import { Counterfactual, RequestBehind } from '../components/QlooTrace.jsx';

/** The eight Qloo capabilities the tool server calls (server/README.md, "How Qloo is load-bearing"). */
const CAPABILITIES = [
  ['Entity search', 'A band name becomes a Qloo artist id.', 'GET /search'],
  ['Tag search', '"Thai food" becomes a cuisine tag.', 'GET /v2/tags'],
  ['Location-scoped insights', 'Places near the inn, ranked for this guest.', 'GET /v2/insights filter.location'],
  ['Cross-domain affinity', 'A music taste picks a restaurant, and a film to watch at the inn.', 'GET /v2/insights signal.* + filter.type'],
  ['Explainability', 'The reason shown with every pick.', 'feature.explainability=true'],
  ['Heatmap', 'Where around the inn a taste runs hottest.', 'GET /v2/insights filter.type=urn:heatmap'],
  ['Demographics', 'Which age groups lean toward guest tastes.', 'GET /v2/insights filter.type=urn:demographics'],
  ['Audience compare', 'How two kinds of guests differ.', 'GET /v2/analysis/compare'],
];

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

const useSamplePick = () => useGet('/sample-pick');

/** Proof under the call card: without and with Qloo, then the text the sample guest gets. */
function HeroProof({ pick, itin }) {
  const cf = pick.state === 'ok' && pick.data.places.length > 0 ? pick.data.counterfactual : null;
  const sms = itin.state === 'ok' ? itin.data.itinerary : null;
  if (!cf && !sms) return null;
  return (
    <div className="hero-proof">
      <div className="hero-proof-grid">
        {cf && <Counterfactual cf={cf} />}
        {sms && (
          <div className="hero-sms">
            <div className="row hero-sms-head">
              <p className="micro">The text a guest gets</p>
              <SampleBadge>Sample</SampleBadge>
            </div>
            <SmsPreview itinerary={sms} />
          </div>
        )}
      </div>
    </div>
  );
}

function NumberCard({ number, onCopy, cardRef, live }) {
  if (!number) {
    return (
      <div className="number-card" ref={cardRef}>
        <p className="micro">Call or text back</p>
        <p className="the-number pending">Number goes live at submission</p>
        <p className="caption">The phone line opens with the hackathon submission. Until then, the builder and dashboard below work in full.</p>
      </div>
    );
  }
  const pretty = formatPhone(number);
  return (
    <div className="number-card" ref={cardRef}>
      <p className="micro">Call the demo inn, free</p>
      <a className="number-link" href={telHref(number)} aria-label={`Call ${pretty}`}>
        <span className="the-number">{pretty}</span>
      </a>
      <p className="caption">{live ? 'The inn is fictional. The calls and texts are real.' : 'The inn is fictional. Today the line answers with sample places until the Qloo key is live.'}</p>
      <div className="row number-actions">
        <a className="btn btn-primary btn-lg only-coarse" href={telHref(number)}><Icon name="phone" />Call now</a>
        <button type="button" className="btn btn-primary only-fine" onClick={onCopy}><Icon name="copy" />Copy number</button>
        <Link to="/build" className="btn btn-text">Build your own concierge <Icon name="arrow" /></Link>
      </div>
    </div>
  );
}

export default function Landing({ health }) {
  const data = health.data;
  const number = data?.demo_number;
  const innName = data?.demo?.name ?? 'the demo inn';
  const pick = useSamplePick();
  const demoId = data?.demo?.id;
  const itin = useGet(health.state === 'checking' ? null : `/properties/${encodeURIComponent(demoId ?? 'demo')}/itinerary-sample`);
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

  return (
    <div className={`container${number ? ' has-callbar' : ''}`}>
      <section className="hero" aria-labelledby="hero-h">
        <div>
          <div className="product-intro">
            <p className="product-name">Bellhop Concierge</p>
            <p className="product-line">A phone concierge small inns put on the room card. Guests call, name what they love, and get three picks by text from Qloo's taste graph.</p>
          </div>
          <div className="eyebrow-row">
            <span className="micro">{innName}, a sample inn</span>
            <LiveBadge state={health.state} lastSessionAt={data?.last_session_at} />
          </div>
          <h1 id="hero-h">Call the front desk at {innName}.</h1>
          <p className="lead">Tell it three things you love. It texts you three places nearby, with the reason for each.</p>
          <NumberCard number={number} onCopy={copy} cardRef={cardRef} live={health.state === 'answering'} />
          <HeroProof pick={pick} itin={itin} />
          <p className="qloo-line">
            <span className="chip chip-mono chip-qloo">Qloo</span>
            <span>Picks come from Qloo's taste graph, with the reason shown. Events from Ticketmaster.</span>
          </p>
          {health.state === 'busy' && (
            <Banner tone="warning">We couldn't reach the concierge's tool server just now. The number stays the same; try again in a minute.</Banner>
          )}
        </div>

        <aside className="card pick-panel" aria-labelledby="qloo-h">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 id="qloo-h" style={{ fontSize: 'var(--text-lg)' }}>Built on Qloo</h2>
            <div className="row"><SampleBadge>Sample guest</SampleBadge>{pick.data && <ViaChip upstream={pick.data.upstream} />}</div>
          </div>
          <p className="dim" style={{ fontSize: 'var(--text-sm)', marginTop: 'var(--space-2)' }}>
            A guest says: <span className="mono">"{(pick.data?.mentions ?? ['Sturgill Simpson', 'thai food']).join('", "')}"</span>. The tool server asks Qloo, and every pick comes back with its reason.
          </p>
          <div style={{ marginTop: 'var(--space-4)' }}>
            {pick.state === 'loading' && <div className="skeleton" style={{ height: '9rem' }} aria-busy="true" aria-label="Loading a sample pick" />}
            {pick.state === 'error' && <Banner tone="warning">Qloo didn't answer this time. The concierge still takes calls and falls back to the owner's own picks.</Banner>}
            {pick.state === 'ok' && pick.data.places.length === 0 && <p className="dim">No sample pick came back for this area. Try again shortly.</p>}
            {pick.state === 'ok' && pick.data.places.slice(0, 2).map((p, i) => <PickCard key={p.entity_id ?? p.name} place={p} defaultOpen={i === 0} />)}
          </div>
          <p className="micro" style={{ marginTop: 'var(--space-3)' }}>The real response shape from this server's recommend_nearby tool.</p>
          {pick.state === 'ok' && pick.data.places.length > 0 && <RequestBehind request={pick.data.request} />}
        </aside>
      </section>

      <section className="section" aria-labelledby="how-h">
        <div className="section-head"><h2 id="how-h">How it works</h2></div>
        <ol className="steps">
          <li><p className="micro mono">1 · Voice</p><p>You call and name something you love: a band, a film, a kind of food.</p></li>
          <li><p className="micro mono">2 · Qloo</p><p>Qloo's taste graph finds places and events near the inn that people with your taste love.</p></li>
          <li><p className="micro mono">3 · SMS</p><p>You get one text with each pick and the reason for it, under 320 characters.</p></li>
        </ol>
      </section>

      <section className="section" aria-labelledby="cap-h">
        <details>
          <summary id="cap-h">See how Qloo is used ({CAPABILITIES.length} capabilities)</summary>
          <ul className="cap-list">
            {CAPABILITIES.map(([name, what, endpoint]) => (
              <li key={name}><strong style={{ fontWeight: 600 }}>{name}.</strong> {what}<br /><code>{endpoint}</code></li>
            ))}
          </ul>
        </details>
      </section>

      <section className="section card card-lg" aria-labelledby="own-h">
        <div className="stack">
          <h2 id="own-h" style={{ fontSize: 'var(--text-xl)' }}>Run your own concierge in about three minutes.</h2>
          <p className="buyer-line">
            For the innkeeper with no night desk: "what is around here" is 9.0% of 10 million guest messages (<a href="https://www.conduit.ai/blog/what-10-million-guest-messages-are-about" target="_blank" rel="noopener noreferrer">Conduit, 2026</a>).
          </p>
          <p className="prose dim">Answer eleven short questions, pick a voice, and see exactly what your concierge will be told before anything goes live. The safety rules are on for every inn, and you can read every one of them.</p>
          <div className="row">
            <Link to="/build" className="btn btn-primary btn-lg">Build yours</Link>
            <Link to="/property/demo" className="btn btn-secondary btn-lg">See the innkeeper dashboard</Link>
            <Link to="/property/demo/brief" className="btn btn-text">See the one-page innkeeper brief</Link>
          </div>
          {data?.tools && (
            <p className="micro mono">Tool server: Qloo {data.tools.qloo}, Ticketmaster {data.tools.ticketmaster}. Checked {new Date(data.checked_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</p>
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
