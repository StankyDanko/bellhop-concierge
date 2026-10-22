// `/property/:id`: sessions (aggregate only), the text a guest gets, area insights with
// every degraded and gated state, and suggestions derived from the insights.
import { Fragment, useCallback, useEffect, useId, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../icons.jsx';
import { Link } from '../router.jsx';
import { Banner, clock, LiveBadge, SampleBadge, SmsPreview, SourceChip, Stat, ViaChip } from '../components/ui.jsx';
import { Counterfactual, MockNote, SampleSessionCard, SessionTrace, TraceTable, unresolvedInMock } from '../components/QlooTrace.jsx';
import { BasisTag, FingerprintCard, HotAreas, LeanPanel, tasteCountText } from '../components/Fingerprint.jsx';
import '../property.css';

/** What the guest named, or a muted "none resolved" rather than a blank. */
function Tastes({ entities }) {
  return entities.length ? entities.join(', ') : <span className="none-resolved">none resolved</span>;
}

/** One Calls table row plus its expandable Qloo trace row. */
function SessionTableRow({ s }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const n = s.trace?.length ?? 0;
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
        <td>
          <button type="button" className="trace-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
            <span>Qloo calls (<span className="num">{n}</span>)</span><Icon name="chev" />
          </button>
        </td>
      </tr>
      {mock && <tr className="note-row"><td colSpan={7}><MockNote /></td></tr>}
      <tr id={id} hidden={!open}>
        <td colSpan={7} className="trace-cell">
          <div className="trace-body">{mock && <MockNote />}<TraceTable trace={s.trace} /><Counterfactual cf={s.counterfactual} /></div>
        </td>
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

// ---- geometry for the heatmap ---------------------------------------------------------------

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

// ---- panels -------------------------------------------------------------------------------------

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

function GateCard({ count, min, onSample, tastes }) {
  return (
    <div>
      <div className="gate-bricks" aria-hidden="true">{Array.from({ length: min }, (_, i) => <span key={i} className={i < count ? 'on' : ''} />)}</div>
      <p>Taste insights switch on after {min} calls that name a taste. {tasteCountText(tastes, count)} This keeps any single guest from being picked out of the numbers.</p>
      {onSample && <button type="button" className="btn btn-text" onClick={onSample} style={{ marginTop: 'var(--space-2)', paddingInline: 0 }}>Preview what it will look like</button>}
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

function Heatmap({ data, inn, onRetry }) {
  const sec = data.heatmap;
  const cells = sec.cells ?? [];
  const meta = `Radius ${data.area.radius_miles} mi, ${{ callers: "by your callers' tastes", sample: "by sample callers' tastes" }[sec.basis] ?? 'area-wide, no guest data'}`;
  let body;
  if (sec.status !== 'ok') body = <SectionState sec={sec} asOf={data.as_of} onRetry={onRetry} />;
  else if (!cells.length) body = <p className="dim" style={{ marginTop: 'var(--space-3)' }}>Not enough overlap in what your guests named to draw a map yet. It tends to sharpen after a few more calls.</p>;
  else {
    const pts = [...cells, inn];
    const lats = pts.map((p) => p.lat); const lngs = pts.map((p) => p.lng);
    const pad = 0.15;
    const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    const x = (lng) => `${(pad + ((lng - minLng) / ((maxLng - minLng) || 1)) * (1 - 2 * pad)) * 100}%`;
    const y = (lat) => `${(pad + ((maxLat - lat) / ((maxLat - minLat) || 1)) * (1 - 2 * pad)) * 100}%`;
    const ranked = cells.slice(0, 3);
    body = (
      <>
        <div className="heat" role="img" aria-label={`Map of ${cells.length} areas around the inn, shaded by taste affinity. The list below has the same information.`}>
          {cells.map((c) => <span key={c.geohash ?? `${c.lat},${c.lng}`} className="cell" style={{ left: x(c.lng), top: y(c.lat), opacity: 0.2 + 0.7 * (c.affinity ?? 0) }} />)}
          <span className="inn" style={{ left: x(inn.lng), top: y(inn.lat) }} />
        </div>
        <p className="legend"><span><span className="sw" />Darker means stronger taste affinity</span><span><span className="sw inn" />The inn</span></p>
        <p className="micro" style={{ marginTop: 'var(--space-3)' }}>Hottest {ranked.length} areas</p>
        <ol className="ranked">
          {ranked.map((c) => (
            <li key={c.geohash ?? `${c.lat},${c.lng}`}>
              <span>{milesBetween(inn, c).toFixed(1)} mi {direction(inn, c)} of the inn</span>
              <span className="num">affinity {(c.affinity ?? 0).toFixed(2)}{typeof c.quality_affinity === 'number' ? `, quality ${c.quality_affinity.toFixed(2)}` : ''}</span>
            </li>
          ))}
        </ol>
      </>
    );
  }
  return <PanelShell title="Where tastes run hottest" meta={meta} sample={data.sample} basis={sec} footer="Aggregate, anonymous. Qloo heatmap.">{body}</PanelShell>;
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
    <PanelShell title="Who shares these tastes" sample={data.sample} basis={sec}
      meta={sec.status === 'ok' ? `Across ${sec.interests_counted} guest interest${sec.interests_counted === 1 ? '' : 's'}` : null}
      footer={data.sample ? 'Shown with example data until 5 calls name a taste.'
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
    if (band && v > 0) out.push({ title: 'Stock for the crowd that shows up', text: `Guests who share these tastes lean ${AGE[band] ?? band} (${signed(v)} vs. area average). A record player in the parlor and a shelf of local zines fit that crowd.`, source: 'Qloo demographics' });
  }
  const hot = data.heatmap.status === 'ok' ? data.heatmap.cells?.[0] : null;
  if (hot) out.push({ title: 'Walk the hottest block', text: `Taste affinity peaks ${milesBetween(inn, hot).toFixed(1)} mi ${direction(inn, hot)} of the inn (affinity ${(hot.affinity ?? 0).toFixed(2)}). A coffee shop or bar there is a natural partner for a guest discount card.`, source: 'Qloo heatmap' });
  if (data.interests?.length) out.push({ title: 'Put their favorites on the room card', text: `Guests keep naming ${data.interests.slice(0, 3).join(', ')}. A line on the room card ("Ask the front desk what fans of ${data.interests[0]} love nearby") invites the call.`, source: data.sample ? 'Sample guest tastes' : 'Own call log' });
  return out;
}

// ---- page ---------------------------------------------------------------------------------------

export default function Property({ id, health }) {
  const [prop] = useApi(`/properties/${id}`);
  const [sessions, reloadSessions] = useApi(`/properties/${id}/sessions`);
  const [itin] = useApi(`/properties/${id}/itinerary-sample`);
  const [radius, setRadius] = useState(2);
  // The demo inn opens with the labeled sample on, so a first visit never lands on dark
  // panels. Every panel it fills carries the sample badge. Other inns start on their own data.
  const [sample, setSample] = useState(id === 'demo');
  const [ins, reloadIns] = useApi(`/properties/${id}/insights?radius=${radius}${sample ? '&sample=1' : ''}`);
  const [fp] = useApi(`/properties/${id}/fingerprint${sample ? '?sample=1' : ''}`);

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

  return (
    <div className="container">
      <header className="prop-head">
        <p className="micro" style={{ width: '100%' }}>Innkeeper dashboard{isDemo ? ', sample inn' : ''}</p>
        <h1>{cfg.property.name}</h1>
        <LiveBadge state={badgeState} lastSessionAt={health.data?.last_session_at} />
        <span className={`chip ${p.status === 'published' ? 'chip-success' : ''}`}>{p.status === 'published' ? 'Published' : 'Draft'}</span>
        <span className="chip chip-mono">Trust: {cfg.trust_level}</span>
        {delayed > 0 && <span className="chip chip-warning">{delayed} of 3 panels delayed</span>}
        <Link to={`/property/${id}/brief`} className="btn btn-text">Print the innkeeper brief</Link>
      </header>
      <nav className="jump" aria-label="Sections">
        <a href="#calls">Calls</a><a href="#text">The text a guest gets</a><a href="#insights">Area insights</a><a href="#suggest">Suggestions</a>
      </nav>

      <section id="calls" className="section" aria-labelledby="calls-h">
        <div className="section-head"><h2 id="calls-h">Calls</h2><span className="micro">Aggregate only. No names, numbers, or transcripts.</span></div>
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
              <div className="card" style={{ marginTop: 'var(--space-4)' }}>
                <p>No calls yet. Share your number on a room card, or make a preview call to see how a call looks here.</p>
                <p style={{ marginTop: 'var(--space-3)' }}><Link to="/build" className="btn btn-secondary">Open the builder</Link></p>
              </div>
            ) : (
              <div className="sessions-wrap" style={{ marginTop: 'var(--space-4)' }}>
                <ul className="session-cards">
                  {list.map((s) => (
                    <li key={`${s.started_at}-${s.persona}`}>
                      <p className="row" style={{ justifyContent: 'space-between' }}>
                        <span className="tnum">{clock(s.started_at)}</span>
                        <span className={`chip ${s.sms_sent ? 'chip-success' : ''}`}>{s.sms_sent ? 'Itinerary sent' : 'No text needed'}</span>
                      </p>
                      <p className="dim" style={{ fontSize: 'var(--text-sm)', marginTop: 'var(--space-1)' }}>Tastes named: <Tastes entities={s.entities} /></p>
                      {unresolvedInMock(s.trace) && <MockNote />}
                      <SessionTrace trace={s.trace} counterfactual={s.counterfactual} note={unresolvedInMock(s.trace)} />
                    </li>
                  ))}
                </ul>
                <table className="session-table">
                  <caption className="visually-hidden">Recent calls, newest first</caption>
                  <thead><tr><th scope="col">Time</th><th scope="col">Voice</th><th scope="col">Tastes named</th><th scope="col">Picks</th><th scope="col">Events</th><th scope="col">Texted</th><th scope="col">Qloo trace</th></tr></thead>
                  <tbody>
                    {list.map((s) => <SessionTableRow key={`${s.started_at}-${s.persona}`} s={s} />)}
                  </tbody>
                </table>
              </div>
            )}
            {(list.length === 0 || isDemo) && <SampleSessionCard session={sessions.data?.sample_session} />}
          </>
        )}
      </section>

      <section id="text" className="section" aria-labelledby="text-h">
        <div className="section-head"><h2 id="text-h">The text a guest gets</h2><SampleBadge>Sample guest</SampleBadge></div>
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
            <p className="dim" style={{ fontSize: 'var(--text-sm)', marginTop: 'var(--space-3)' }}>
              Built by the compose_itinerary tool for the same sample guest as the demo page: one Qloo pick, one Ticketmaster listing, and your own first favorite. Links are https only, and the whole text stays under 320 characters.
            </p>
            {itin.state === 'ok' && <p style={{ marginTop: 'var(--space-2)' }}><ViaChip upstream={itin.data.upstream} /></p>}
          </div>
        </div>
      </section>

      <section id="insights" className="section" aria-labelledby="ins-h">
        <div className="section-head">
          <h2 id="ins-h">Area insights</h2>
          <div className="row">
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
        </div>
        <div style={{ marginBottom: 'var(--space-4)' }}><FingerprintCard fp={fp} tastes={tastes} onSample={() => setSample(true)} /></div>
        {ins.state === 'ok' && <p className="micro mono" style={{ marginBottom: 'var(--space-3)' }}>As of {new Date(ins.data.as_of).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · <ViaChip upstream={ins.data.upstream} /></p>}
        {ins.state === 'loading' && (
          <div className="insights-top" aria-busy="true" aria-label="Loading insights">
            <div className="skeleton" style={{ height: '18rem' }} /><div className="skeleton" style={{ height: '18rem' }} />
          </div>
        )}
        {ins.state === 'error' && (
          <Banner tone="danger" action={<button type="button" className="btn btn-text" onClick={reloadIns}>Try again</button>}>
            We couldn't reach the insights service. Your concierge keeps answering calls as normal.
          </Banner>
        )}
        {ins.state === 'ok' && (
          <div className="stack">
            {ins.data.sample && <Banner tone="info">Showing sample callers' tastes ({ins.data.interests.join(', ')}). Shown with example data until 5 calls name a taste.</Banner>}
            <div className="insights-top">
              <Heatmap data={ins.data} inn={inn} onRetry={reloadIns} />
              <Demographics data={ins.data} tastes={tastes} onRetry={reloadIns} onSample={() => setSample(true)} />
            </div>
            <HotAreas data={ins.data} onRetry={reloadIns} />
            <LeanPanel data={ins.data} tastes={tastes} onRetry={reloadIns} />
          </div>
        )}
      </section>

      <section id="suggest" className="section" aria-labelledby="sg-h">
        <div className="section-head"><h2 id="sg-h">What to stock or partner with</h2><span className="micro">A suggestion, not a forecast</span></div>
        {ins.state === 'ok' && (() => {
          const guestOpen = ins.data.gate.open || ins.data.sample;
          const items = guestOpen ? deriveSuggestions(ins.data, inn) : [];
          if (!guestOpen) return <div className="card"><GateCard count={ins.data.gate.count} min={ins.data.gate.min} tastes={tastes} onSample={() => setSample(true)} /></div>;
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
        <p className="dim" style={{ fontSize: 'var(--text-sm)', marginTop: 'var(--space-3)' }}>Each suggestion is written from the panels above by a fixed template. We do not predict revenue or reviews.</p>
      </section>
    </div>
  );
}
