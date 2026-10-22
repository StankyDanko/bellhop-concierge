// `/property/:id`: the innkeeper dashboard. One idea per section, in the order an innkeeper
// asks them (DESIGN-BRIEF section 4): what my callers love, every call and what it asked Qloo,
// the text a guest gets, who shares these tastes nearby, and what to stock or partner with.
// The page opens with a short key: what is sample, what is real, and the five-call floor,
// said once. Panels below point back to it instead of repeating it.
import { Fragment, useCallback, useEffect, useId, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../icons.jsx';
import { Link } from '../router.jsx';
import { Banner, clock, LiveBadge, SampleBadge, SmsPreview, SourceChip, Stat, ViaChip } from '../components/ui.jsx';
import { Counterfactual, MockNote, requestsLabel, SampleSessionCard, TraceTable, unresolvedInMock } from '../components/QlooTrace.jsx';
import { BasisTag, HotAreas, inWords, LeanPanel, tasteCountText } from '../components/Fingerprint.jsx';
import { AreaCard } from '../components/AreaCard.jsx';
import { WhyPick } from '../components/WhyPick.jsx';
import '../property.css';

/**
 * Call limits per line, in plain words. Mirrors TRUST_LIMITS in compiler/compile.js
 * (grep -n "daily_limit" compiler/compile.js: test 20, suggest 100, live 300).
 */
const TRUST_WORDS = {
  test: 'Test line, 20 calls a day',
  suggest: 'Suggest line, 100 calls a day',
  live: 'Live line, 300 calls a day',
};

/** What the guest named, or a muted "none resolved" rather than a blank. */
function Tastes({ entities }) {
  return entities.length ? entities.join(', ') : <span className="none-resolved">none resolved</span>;
}


/** The toggle both call layouts share: every request for one call, exactly as sent. */
function CallTraceToggle({ trace, open, onToggle, controls }) {
  return (
    <button type="button" className="trace-toggle" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      <span className="tnum">{requestsLabel(trace)}</span><Icon name="chev" className="chev" />
    </button>
  );
}

function CallTraceBody({ s, mock }) {
  return (
    <div className="trace-body">
      {mock && <MockNote />}
      <p className="micro">Every request, exactly as sent</p>
      <TraceTable trace={s.trace} />
      <Counterfactual cf={s.counterfactual} mentions={s.entities} />
    </div>
  );
}

/** One call as a card (narrow layouts). */
function SessionCard({ s }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const mock = unresolvedInMock(s.trace);
  return (
    <li>
      <p className="row" style={{ justifyContent: 'space-between' }}>
        <span className="tnum">{clock(s.started_at)}</span>
        <span className={`chip ${s.sms_sent ? 'chip-success' : ''}`}>{s.sms_sent ? 'Plan texted' : 'No text needed'}</span>
      </p>
      <p className="dim call-tastes">Tastes named: <Tastes entities={s.entities} /></p>
      {mock && <MockNote />}
      <div className="session-trace">
        <CallTraceToggle trace={s.trace} open={open} onToggle={() => setOpen((o) => !o)} controls={id} />
        <div id={id} hidden={!open}><CallTraceBody s={s} /></div>
      </div>
    </li>
  );
}

/** One Calls table row plus its expandable trace row. */
function SessionTableRow({ s }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const mock = unresolvedInMock(s.trace);
  return (
    <Fragment>
      <tr className={mock ? 'has-note' : undefined}>
        <td className="tnum">{clock(s.started_at)}</td>
        <td>{s.persona ?? ''}</td>
        <td><Tastes entities={s.entities} /></td>
        <td className="n">{s.picks_count}</td>
        <td className="n">{s.events_count}</td>
        <td>{s.sms_sent ? 'Yes' : 'No'}</td>
        <td><CallTraceToggle trace={s.trace} open={open} onToggle={() => setOpen((o) => !o)} controls={id} /></td>
      </tr>
      {mock && <tr className="note-row"><td colSpan={7}><MockNote /></td></tr>}
      <tr id={id} hidden={!open}>
        <td colSpan={7} className="trace-cell"><CallTraceBody s={s} /></td>
      </tr>
    </Fragment>
  );
}

function useApi(path) {
  const [s, setS] = useState({ state: 'loading' });
  const load = useCallback(() => {
    let active = true;
    setS((p) => ({ ...p, state: 'loading' }));
    api(path).then((r) => { if (active) setS(r.ok ? { state: 'ok', data: r.data } : { state: 'error', status: r.status, data: r.data }); });
    return () => { active = false; };
  }, [path]);
  useEffect(() => load(), [load]);
  return [s, load];
}

// ---- geometry for the suggestions ----------------------------------------------------------------

const toRad = (d) => (d * Math.PI) / 180;
function milesBetween(a, b) {
  const R = 3958.8;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function direction(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(deg / 45) % 8];
}
const AGE = { '24_and_younger': '24 and under', '25_to_29': '25 to 29', '30_to_34': '30 to 34', '35_to_44': '35 to 44', '45_to_54': '45 to 54', '55_and_older': '55 and over' };
const signed = (n) => `${n > 0 ? '+' : ''}${n.toFixed(2)}`;

// ---- layout pieces -------------------------------------------------------------------------------

/** A dashboard section: headline sentence, one supporting line, then the visual. */
function Part({ id, title, line, aside, children }) {
  return (
    <section id={id} className="section part" aria-labelledby={`${id}-h`}>
      <div className="part-head">
        <div className="part-title">
          <h2 id={`${id}-h`}>{title}</h2>
          {line && <p className="part-line">{line}</p>}
        </div>
        {aside && <div className="part-aside">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

function PanelShell({ title, source = 'Qloo', meta, sample, basis, children, footer }) {
  return (
    <section className="card" aria-label={title}>
      <div className="panel-head">
        <h3>{title}</h3>
        <div className="row">{basis && <BasisTag basis={basis.basis} n={basis.sample_size} />}<SourceChip source={source} />{sample && <SampleBadge />}</div>
      </div>
      {meta && <p className="micro mono" style={{ marginTop: 'var(--space-1)' }}>{meta}</p>}
      {children}
      {footer && <p className="micro panel-foot">{footer}</p>}
    </section>
  );
}

/** A dark panel: the bricks, and a pointer to the floor stated once at the top. */
function GateCard({ count, min, onSample, tastes }) {
  return (
    <div>
      <div className="gate-bricks" aria-hidden="true">{Array.from({ length: min }, (_, i) => <span key={i} className={i < count ? 'on' : ''} />)}</div>
      <p>Opens at {inWords(min)} calls that name a taste. {tasteCountText(tastes, count)}</p>
      {onSample && <button type="button" className="btn btn-text gate-preview" onClick={onSample}>Preview it with sample callers</button>}
    </div>
  );
}

/** The amber "degraded" treatment, copy per DESIGN-LANGUAGE.md 5.13. */
function Degraded({ asOf, onRetry, demographics }) {
  return (
    <Banner tone="warning" action={<button type="button" className="btn btn-text" onClick={onRetry}>Try again now</button>}>
      {demographics ? "Age and gender lean isn't available for this area right now." : `Qloo didn't answer this time${asOf ? `, as of ${new Date(asOf).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}. We'll try again in a minute.`}
    </Banner>
  );
}

function SectionState({ sec, asOf, onRetry, onSample, demographics, skippedText, tastes }) {
  if (sec.status === 'gated') return <GateCard count={sec.count} min={sec.min} onSample={onSample} tastes={tastes} />;
  if (sec.status === 'degraded') return <Degraded asOf={asOf} onRetry={onRetry} demographics={demographics} />;
  if (sec.status === 'skipped') return <Banner tone="info">{skippedText}</Banner>;
  return null;
}

function Diverging({ rows }) {
  const max = Math.max(0.05, ...rows.map(([, v]) => Math.abs(v)));
  return (
    <div className="diverge">
      {rows.map(([label, v]) => (
        <div className="drow" key={label}>
          <span>{label}</span>
          <span className="track" aria-hidden="true">
            <span className={`fill${v < 0 ? ' neg' : ''}`} style={v >= 0 ? { left: '50%', width: `${(v / max) * 50}%` } : { right: '50%', width: `${(-v / max) * 50}%` }} />
          </span>
          <span className="v">{signed(v)}</span>
        </div>
      ))}
    </div>
  );
}

function Demographics({ data, onRetry, onSample, tastes }) {
  const sec = data.demographics;
  let body;
  if (sec.status !== 'ok') body = <SectionState sec={sec} asOf={data.as_of} onRetry={onRetry} onSample={onSample} tastes={tastes} demographics skippedText="Add a few things your guests love and this section fills in." />;
  else {
    body = (
      <>
        <p className="micro" style={{ marginTop: 'var(--space-3)' }}>Age, index vs. area average</p>
        <Diverging rows={Object.entries(sec.age ?? {}).map(([k, v]) => [AGE[k] ?? k.replace(/_/g, ' '), v])} />
        <p className="micro" style={{ marginTop: 'var(--space-4)' }}>Gender, index vs. area average</p>
        <Diverging rows={Object.entries(sec.gender ?? {}).map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v])} />
      </>
    );
  }
  return (
    <PanelShell title="Age and gender lean" sample={data.sample} basis={sec}
      meta={sec.status === 'ok' ? `Across ${sec.interests_counted} guest interest${sec.interests_counted === 1 ? '' : 's'}` : null}
      footer={data.sample ? 'Fictional callers, to show how it looks.'
        : sec.status === 'gated' ? null
          : `Aggregate, anonymous. People who like these things around here, from the tastes of ${sec.sample_size} ${sec.sample_size === 1 ? 'call' : 'calls'}.`}>
      {body}
    </PanelShell>
  );
}

/** Text templates over the panel data. Observations plus an action; never a forecast. */
function deriveSuggestions(data, inn) {
  const out = [];
  const demo = data.demographics;
  if (demo.status === 'ok' && demo.age) {
    const [band, v] = Object.entries(demo.age).sort((p, q) => q[1] - p[1])[0] ?? [];
    if (band && v > 0) out.push({ title: 'Who shares these tastes nearby', text: `Guests who share these tastes lean ${AGE[band] ?? band} (${signed(v)} vs. area average).`, source: 'Qloo demographics' });
  }
  const hot = data.heatmap.status === 'ok' ? data.heatmap.cells?.[0] : null;
  if (hot) out.push({ title: 'Walk the hottest block', text: `Taste affinity peaks ${milesBetween(inn, hot).toFixed(1)} mi ${direction(inn, hot)} of the inn (affinity ${(hot.affinity ?? 0).toFixed(2)}). A coffee shop or bar there is a natural partner for a guest discount card.`, source: 'Qloo heatmap' });
  if (data.interests?.length) out.push({ title: 'Put their favorites on the room card', text: `Guests keep naming ${data.interests.slice(0, 3).join(', ')}. A line on the room card ("Ask the front desk what fans of ${data.interests[0]} love nearby") invites the call.`, source: data.sample ? 'Sample guest tastes' : 'Own call log' });
  return out;
}

/**
 * How to read this page: the sample marking, where Qloo data shows, and the five-call floor,
 * said once and kindly. Dark panels below show their bricks and point back here.
 */
function ReadingKey({ gate, sample, tastes, qlooMode }) {
  const min = gate?.min ?? 5;
  const count = gate?.count ?? 0;
  const open = Boolean(gate?.open);
  return (
    <aside className="card reading-key" aria-label="How to read this page">
      <ul className="key-list">
        <li>
          <SampleBadge>Sample</SampleBadge>
          <span>Fictional callers, to show how the page looks. Never mixed into your own numbers.</span>
        </li>
        <li>
          <span className="chip chip-mono chip-qloo">Qloo</span>
          <span>From Qloo's taste graph.{qlooMode ? ` On this server Qloo is ${qlooMode === 'live' ? 'live' : 'answering from sample fixtures'}.` : ''}</span>
        </li>
        <li>
          <span className="key-bricks" aria-hidden="true">{Array.from({ length: min }, (_, i) => <span key={i} className={i < count ? 'on' : ''} />)}</span>
          <span>
            {open
              ? `Your own taste panels are open: ${count} calls have named a taste.`
              : `Your own taste panels open at ${inWords(min)} calls that name a taste, so no single guest can be picked out. ${tasteCountText(tastes, count)}${sample ? ' Until then the sample fills them.' : ''}`}
          </span>
        </li>
      </ul>
    </aside>
  );
}

// ---- page ---------------------------------------------------------------------------------------

export default function Property({ id, health }) {
  const [prop] = useApi(`/properties/${id}`);
  const [sessions, reloadSessions] = useApi(`/properties/${id}/sessions`);
  const [itin] = useApi(`/properties/${id}/itinerary-sample`);
  const [pick] = useApi('/sample-pick');
  const [radius, setRadius] = useState(2);
  // The demo inn opens with the labeled sample on, so a first visit never lands on dark
  // panels. Every panel it fills carries the sample badge. Other inns start on their own data.
  const [sample, setSample] = useState(id === 'demo');
  const [ins, reloadIns] = useApi(`/properties/${id}/insights?radius=${radius}${sample ? '&sample=1' : ''}`);
  const [fp] = useApi(`/properties/${id}/fingerprint${sample ? '?sample=1' : ''}`);
  return (
    <PropertyView id={id} health={health} prop={prop} sessions={sessions} reloadSessions={reloadSessions} itin={itin} pick={pick}
      ins={ins} reloadIns={reloadIns} fp={fp} radius={radius} setRadius={setRadius} sample={sample} setSample={setSample} />
  );
}

/** The page body over already-fetched states; exported so a check can render it with no browser. */
export function PropertyView({ id, health, prop, sessions, reloadSessions, itin, pick, ins, reloadIns, fp, radius, setRadius, sample, setSample }) {
  if (prop.state === 'loading') return <div className="container"><div className="skeleton" style={{ height: '6rem' }} aria-busy="true" aria-label="Loading the property" /></div>;
  if (prop.state === 'error') {
    return (
      <div className="container stack">
        <h1 style={{ fontSize: 'var(--text-2xl)' }}>{prop.status === 404 ? 'No property by that name.' : "We couldn't load this property."}</h1>
        <p className="dim">{prop.status === 404 ? 'Build one first, or open the demo inn.' : 'The line is still answering. Try again in a moment.'}</p>
        <p className="row"><Link to="/build" className="btn btn-primary">Build your concierge</Link><Link to="/property/demo" className="btn btn-secondary">Open the demo inn</Link></p>
      </div>
    );
  }

  const p = prop.data;
  const cfg = p.config;
  const inn = { lat: cfg.property.lat, lng: cfg.property.lng };
  const isDemo = id === 'demo';
  const badgeState = isDemo ? health.state : p.status === 'published' ? 'test' : 'paused';
  const list = sessions.data?.sessions ?? [];
  const total = sessions.data?.total ?? 0;
  const tastes = sessions.data?.tastes;
  const capped = total > list.length;
  const texts = list.filter((s) => s.sms_sent).length;
  const picks = list.reduce((n, s) => n + s.picks_count, 0);
  const panels = ins.state === 'ok' ? [ins.data.heatmap, ins.data.demographics, ins.data.compare] : [];
  const delayed = panels.filter((s) => s.status === 'degraded').length;
  const gate = ins.state === 'ok' ? ins.data.gate : fp.state === 'ok' ? fp.data.gate : sessions.data?.gate;
  const areaDark = fp.state === 'ok' && fp.data.basis === 'none';
  const onSample = () => setSample(true);

  // V3 for the Qloo line of the sample text: the same sample guest's pick, matched by name when
  // the text's Qloo line is in the sample-pick list, otherwise the first sample pick, labeled so.
  const qlooLine = itin.state === 'ok' ? itin.data.picks?.find((pk) => String(pk.source).toLowerCase() === 'qloo') : null;
  const places = pick?.state === 'ok' ? pick.data.places ?? [] : [];
  const matched = qlooLine ? places.find((pl) => pl.name === qlooLine.name) : null;
  const whyPlace = matched ?? places[0] ?? null;

  return (
    <div className="container property">
      <header className="prop-head">
        <p className="micro">Innkeeper dashboard{isDemo ? ', sample inn' : ''}</p>
        <h1>{cfg.property.name}</h1>
        <p className="prop-lede">What the people who call your number love, every call with the requests behind it, and the text each guest gets.</p>
        <div className="prop-chips">
          <LiveBadge state={badgeState} lastSessionAt={health.data?.last_session_at} />
          <span className={`chip ${p.status === 'published' ? 'chip-success' : ''}`}>{p.status === 'published' ? 'Published' : 'Not published'}</span>
          <span className="chip">{TRUST_WORDS[cfg.trust_level] ?? `Line limits: ${cfg.trust_level}`}</span>
          {delayed > 0 && <span className="chip chip-warning">{delayed} of 3 panels delayed</span>}
          <Link to={`/property/${id}/brief`} className="btn btn-text prop-print">Print the innkeeper brief <Icon name="arrow" /></Link>
        </div>
      </header>

      <ReadingKey gate={gate} sample={sample && !gate?.open} tastes={tastes} qlooMode={health.data?.tools?.qloo} />

      <nav className="jump" aria-label="Sections">
        <a href="#callers">Callers</a><a href="#calls">Calls</a><a href="#text">The text</a><a href="#more">More</a><a href="#suggest">Suggestions</a>
      </nav>

      {/* 1. V4: what the callers love, the two lists, and the named areas, on one grid. */}
      <Part id="callers" title="What your callers love." line="The people who call this number, not the town."
        aside={(
          <div className="row part-controls">
            <fieldset className="fieldset">
              <legend className="visually-hidden">Radius</legend>
              <div className="segmented">
                {[1, 2, 5].map((r) => (
                  <label key={r}><input type="radio" name="radius" checked={radius === r} onChange={() => setRadius(r)} />{r} mi</label>
                ))}
              </div>
            </fieldset>
            {ins.state === 'ok' && !ins.data.gate.open && (
              <button type="button" className="chip-btn" aria-pressed={sample} onClick={() => setSample((s) => !s)}>{sample && <Icon name="check" />}Sample data</button>
            )}
          </div>
        )}>
        {(ins.state === 'loading' || fp.state === 'loading') && <div className="skeleton" style={{ height: '22rem' }} aria-busy="true" aria-label="Loading what your callers love" />}
        {ins.state === 'error' && (
          <Banner tone="danger" action={<button type="button" className="btn btn-text" onClick={reloadIns}>Try again</button>}>
            We couldn't reach the insights service. Your concierge keeps answering calls as normal.
          </Banner>
        )}
        {ins.state === 'ok' && fp.state !== 'loading' && (
          <div className="callers-grid">
            <section className="callers-map" aria-label="Your callers' taste fingerprint, on the map around the inn">
              <AreaCard insights={ins.data} fingerprint={fp.state === 'ok' ? fp.data : null} />
              {areaDark && !sample && <button type="button" className="btn btn-text gate-preview" onClick={onSample}>Preview it with sample callers</button>}
            </section>
            <div className="callers-pair">
              <LeanPanel data={ins.data} tastes={tastes} onRetry={reloadIns} />
              <HotAreas data={ins.data} onRetry={reloadIns} />
            </div>
            <p className="micro mono callers-asof">As of {new Date(ins.data.as_of).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} <ViaChip upstream={ins.data.upstream} /></p>
          </div>
        )}
      </Part>

      {/* 2. Calls: the own log, honest in mock and live, with every request behind each call. */}
      <Part id="calls" title="Every call, and what it asked Qloo." line="Aggregate only. No names, numbers, or transcripts.">
        {sessions.state === 'loading' && <div className="skeleton" style={{ height: '8rem' }} aria-busy="true" aria-label="Loading calls" />}
        {sessions.state === 'error' && <Banner tone="danger" action={<button type="button" className="btn btn-text" onClick={reloadSessions}>Try again</button>}>We couldn't load your calls. The line is still answering.</Banner>}
        {sessions.state === 'ok' && (
          <>
            <div className="stats">
              <Stat label="Calls logged" value={total} unit={total === 1 ? 'call' : 'calls'} source="Own log, all time" />
              <Stat label="Texts sent" value={texts} unit={texts === 1 ? 'text' : 'texts'} source={capped ? `Own log, last ${list.length} calls` : 'Own log, all time'} />
              <Stat label="Picks given" value={picks} unit={picks === 1 ? 'pick' : 'picks'} source={capped ? `Own log, last ${list.length} calls` : 'Own log, all time'} />
            </div>
            {list.length === 0 ? (
              <div className="card calls-empty">
                <p>{isDemo ? 'No real calls on this line yet. The sample call below shows how each one will look.' : 'No calls yet. Share your number on a room card, or make a preview call to see how a call looks here.'}</p>
                {!isDemo && <p style={{ marginTop: 'var(--space-3)' }}><Link to="/build" className="btn btn-secondary">Open the builder</Link></p>}
              </div>
            ) : (
              <div className="sessions-wrap calls-list">
                <ul className="session-cards">
                  {list.map((s) => <SessionCard key={`${s.started_at}-${s.persona}`} s={s} />)}
                </ul>
                <table className="session-table">
                  <caption className="visually-hidden">Recent calls, newest first</caption>
                  <thead><tr><th scope="col">Time</th><th scope="col">Voice</th><th scope="col">Tastes named</th><th scope="col">Picks</th><th scope="col">Events</th><th scope="col">Texted</th><th scope="col">Requests</th></tr></thead>
                  <tbody>
                    {list.map((s) => <SessionTableRow key={`${s.started_at}-${s.persona}`} s={s} />)}
                  </tbody>
                </table>
              </div>
            )}
            {(list.length === 0 || isDemo) && <div className="calls-sample"><SampleSessionCard session={sessions.data?.sample_session} /></div>}
          </>
        )}
      </Part>

      {/* 3. The text, where each line came from, and V3 for the Qloo line. */}
      <Part id="text" title="The text a guest gets." line="One pick from Qloo, one listing from Ticketmaster, and one of your favorites, in at most 320 characters."
        aside={<SampleBadge>Sample guest</SampleBadge>}>
        <div className="grid grid-2">
          <div className="card">
            {itin.state === 'loading' && <div className="skeleton" style={{ height: '8rem' }} />}
            {itin.state === 'error' && <Banner tone="warning">Qloo didn't answer this time. The concierge still takes calls, and falls back to your own picks.</Banner>}
            {itin.state === 'ok' && <SmsPreview itinerary={itin.data.itinerary} />}
          </div>
          <div className="card">
            <h3>Where each line came from</h3>
            {itin.state === 'ok' && (
              <ol className="ranked" style={{ marginTop: 'var(--space-3)' }}>
                {itin.data.picks.map((pk) => <li key={pk.name}><span>{pk.name}</span><SourceChip source={pk.source} /></li>)}
              </ol>
            )}
            <p className="dim text-note">
              The same sample guest as the front page. Links are https only, and the whole text stays at most 320 characters long.
            </p>
            {itin.state === 'ok' && <p style={{ marginTop: 'var(--space-2)' }}><ViaChip upstream={itin.data.upstream} /></p>}
          </div>
        </div>
        {whyPlace && (
          <div className="text-why">
            <p className="micro">{matched ? 'Why the Qloo line was picked' : 'Why a pick was made, for the same sample guest'}</p>
            <WhyPick place={whyPlace} request={pick.data.request} />
          </div>
        )}
      </Part>

      {/* 4. More: who shares these tastes nearby (not a description of the guests). */}
      <Part id="more" title="Who shares these tastes nearby." line="What Qloo knows about people with these tastes around the inn. Not a description of your guests.">
        {ins.state === 'ok' && <div className="more-grid"><Demographics data={ins.data} tastes={tastes} onRetry={reloadIns} onSample={onSample} /></div>}
      </Part>

      {/* 5. Suggestions. */}
      <Part id="suggest" title="What to stock or partner with." line="A suggestion from the panels above, not a forecast.">
        {ins.state === 'ok' && (() => {
          const guestOpen = ins.data.gate.open || ins.data.sample;
          const items = guestOpen ? deriveSuggestions(ins.data, inn) : [];
          if (!guestOpen) return <div className="card"><GateCard count={ins.data.gate.count} min={ins.data.gate.min} tastes={tastes} onSample={onSample} /></div>;
          if (!items.length) return <p className="dim">Nothing to suggest yet. Suggestions appear once the panels above have data.</p>;
          return (
            <div className="suggestions">
              {items.map((s) => (
                <article className="card" key={s.title}>
                  <div className="row" style={{ justifyContent: 'space-between' }}><h3>{s.title}</h3>{ins.data.sample && <SampleBadge />}</div>
                  <p style={{ marginTop: 'var(--space-2)' }}>{s.text}</p>
                  <p className="micro mono panel-foot">Derived from {s.source}</p>
                </article>
              ))}
            </div>
          );
        })()}
        <p className="dim text-note">Each suggestion is written from the panels above by a fixed template. We do not predict revenue or reviews.</p>
      </Part>
    </div>
  );
}
