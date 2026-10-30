// `/`: the landing. One idea per screen, shown rather than told: the guest moment and the
// number, a call as it happens, a real recording, how it works, one concierge per property (with
// Marisol's own line, quieter than the main number), the measured proof, and the number again.
// Every visible word lives in content/landing.js; the scripted call lives in content/call-scene.js.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons.jsx';
import { Link } from '../router.jsx';
import { Banner, formatPhone, LiveBadge, telHref, Toast } from '../components/ui.jsx';
import { FilmSlot } from '../components/landing/FilmSlot.jsx';
import { CallScene } from '../components/landing/CallScene.jsx';
import { RealCall } from '../components/landing/RealCall.jsx';
import { HowSteps } from '../components/landing/HowSteps.jsx';
import { CAPABILITIES, CLOSER, HERO, MARISOL, MEDIA, MEMORY, PROOF, PROPERTIES, REAL_CALL, SCENE, STEPS } from '../content/landing.js';
import '../landing.css';

/** The number as the page's one loud thing: a tel: link, with a copy button on desktop. */
function CallNumber({ number, label, note, onCopy, cardRef, health }) {
  if (!number) return <p className="lx-number-pending">{CLOSER.noNumber}</p>;
  const pretty = formatPhone(number);
  return (
    <div className="lx-number-block" ref={cardRef}>
      <a className="lx-number" href={telHref(number)} aria-label={`${label}, ${pretty}`}>
        <span className="lx-number-label"><Icon name="phone" />{label}</span>
        <span className="lx-number-digits tnum">{pretty}</span>
      </a>
      <div className="lx-number-meta">
        {health?.state === 'answering' && <LiveBadge state="answering" lastSessionAt={health.data?.last_session_at} />}
        {note && <span className="lx-number-note">{note}</span>}
        {onCopy && <button type="button" className="btn btn-text only-fine" onClick={onCopy}><Icon name="copy" />{HERO.copy}</button>}
      </div>
    </div>
  );
}

function Tile({ t, number }) {
  const body = (
    <>
      <span className="lx-tile-top">
        <Icon name="bell" />
        <span className="lx-tile-kind">{t.kind}</span>
        {!t.to && !t.tel && <span className="lx-tile-example">{PROPERTIES.example}</span>}
      </span>
      <span className="lx-tile-name">{t.name}</span>
      <span className="lx-tile-place">{t.place}</span>
      <span className="lx-tile-rule" aria-hidden="true" />
      <span className="lx-tile-voice">Ask for <strong>{t.concierge}</strong></span>
      {t.tel && number && <span className="lx-tile-number tnum">{formatPhone(number)}</span>}
      {(t.to || (t.tel && number)) && <span className="lx-tile-go" aria-hidden="true"><Icon name="arrow" /></span>}
    </>
  );
  if (t.to) return <Link to={t.to} className="lx-tile" data-tone={t.tone}>{body}</Link>;
  if (t.tel && number) return <a href={telHref(number)} className="lx-tile" data-tone={t.tone}>{body}</a>;
  return <div className="lx-tile" data-tone={t.tone}>{body}</div>;
}

export default function Landing({ health }) {
  const number = health.data?.demo_number;
  const tools = health.data?.tools ?? {};
  const live = PROOF.live.filter(([k]) => tools[k] === 'live');
  const [toast, setToast] = useState('');
  const heroRef = useRef(null);
  const [showBar, setShowBar] = useState(false);

  // A link to /#film (the README's "Watch the films") lands on the film: the page draws after the
  // browser's own anchor jump, so jump once the section exists.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, []);

  // Phone only: a sticky "Call Hollis" bar appears once the hero number scrolls away.
  useEffect(() => {
    if (!number || !heroRef.current || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(([e]) => setShowBar(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(heroRef.current);
    return () => io.disconnect();
  }, [number]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(number); setToast(HERO.copied); } catch { setToast(formatPhone(number)); }
  };

  return (
    <div className={`lx${number ? ' has-callbar' : ''}`}>
      {/* 1. Hero: the guest moment, the number, the film. */}
      <section className="lx-hero" aria-labelledby="lx-hero-h">
        <div className="lx-wrap lx-center">
          <p className="lx-eyebrow">{HERO.eyebrow}</p>
          <h1 id="lx-hero-h" className="lx-h1">{HERO.title}</h1>
          <p className="lx-sub lx-hero-sub">{HERO.sub}</p>
          <CallNumber number={number} label={HERO.callLabel} note={HERO.callNote} onCopy={copy} cardRef={heroRef} health={health} />
          {health.state === 'busy' && <Banner tone="warning">{CLOSER.busy}</Banner>}
        </div>
        <div className="lx-wrap lx-wide" id="film">
          <FilmSlot src={MEDIA.heroFilm} preview={MEDIA.heroLoop} poster={MEDIA.heroPoster} label={HERO.filmLabel} soundOn={HERO.soundOn} soundOff={HERO.soundOff}
            placeholder={{ quote: HERO.placeholderQuote, caption: HERO.placeholderCaption }} note={HERO.filmNote} className="lx-film-hero" />
        </div>
      </section>

      {/* 2. A call as it happens: captions, then the text, then the picks page. */}
      <section className="lx-section lx-band" aria-labelledby="lx-scene-h">
        <div className="lx-wrap lx-center">
          <p className="lx-eyebrow">{SCENE.eyebrow}</p>
          <h2 id="lx-scene-h" className="lx-h2">{SCENE.title}</h2>
          <p className="lx-sub">{SCENE.sub}</p>
        </div>
        <div className="lx-wrap lx-wide"><CallScene copy={SCENE} /></div>
      </section>

      {/* 3. A real recording with live captions; renders nothing until the file is on the server. */}
      <RealCall src={MEDIA.callAudio} cuesUrl={MEDIA.callCues} copy={REAL_CALL} />

      {/* 4. How it works: three steps beside one pinned stage. */}
      <section className="lx-section" aria-labelledby="lx-how-h">
        <div className="lx-wrap">
          <h2 className="lx-eyebrow" id="lx-how-h">{STEPS.eyebrow}</h2>
          <HowSteps copy={STEPS} />
        </div>
      </section>

      {/* 4b. Memory: one line, one big idea. */}
      <section className="lx-section lx-memory" aria-labelledby="lx-memory-h">
        <div className="lx-wrap lx-center">
          <p className="lx-eyebrow">{MEMORY.eyebrow}</p>
          <h2 id="lx-memory-h" className="lx-h2 lx-h2-xl">{MEMORY.title}</h2>
          <p className="lx-sub">{MEMORY.sub}</p>
        </div>
      </section>

      {/* 5. One concierge per property. */}
      <section className="lx-section lx-band" aria-labelledby="lx-props-h">
        <div className="lx-wrap lx-center">
          <p className="lx-eyebrow">{PROPERTIES.eyebrow}</p>
          <h2 id="lx-props-h" className="lx-h2">{PROPERTIES.title}</h2>
          <p className="lx-sub">{PROPERTIES.line}</p>
        </div>
        <div className="lx-wrap lx-wide">
          <ul className="lx-tiles">
            {PROPERTIES.tiles.map((t) => <li key={t.name}><Tile t={t} number={number} /></li>)}
          </ul>
          <p className="lx-caption">{PROPERTIES.caption}</p>
          <p className="lx-alt-line">
            {MARISOL.lead}{' '}
            <a href={telHref(MARISOL.number)}><Icon name="phone" />{MARISOL.label} <span className="tnum">{formatPhone(MARISOL.number)}</span></a>
          </p>
          <p className="lx-actions">
            <Link to="/build" className="btn btn-primary btn-lg">{PROPERTIES.build}</Link>
            <Link to="/property/miami" className="btn btn-secondary btn-lg">{PROPERTIES.open}</Link>
          </p>
        </div>
      </section>

      {/* 6. Proof, each number listed in docs/MEASUREMENTS.md with its command. */}
      <section className="lx-section" aria-labelledby="lx-proof-h">
        <div className="lx-wrap lx-center">
          <p className="lx-eyebrow">{PROOF.eyebrow}</p>
          <h2 id="lx-proof-h" className="lx-h2">{PROOF.title}</h2>
          <p className="lx-sub">{PROOF.sub}</p>
          {live.length > 0 && (
            <ul className="lx-live" aria-label="Services the line uses, as the server reports them now">
              {live.map(([k, label]) => <li key={k}><span className="lx-live-dot" aria-hidden="true" />{label} {PROOF.liveWord}</li>)}
            </ul>
          )}
        </div>
        <div className="lx-wrap lx-wide">
          <dl className="lx-facts">
            {PROOF.facts.map((f) => (
              <div key={f.value} className="lx-fact">
                <dt className="lx-fact-value tnum">{f.value}</dt>
                <dd className="lx-fact-label">{f.label}</dd>
              </div>
            ))}
          </dl>
          <p className="lx-links">
            {PROOF.links.map((l) => <a key={l.href} href={l.href} rel="noopener">{l.label}<Icon name="arrow" /></a>)}
          </p>
          <details className="lx-caps">
            <summary>{PROOF.capsSummary}</summary>
            <ul>
              {CAPABILITIES.map(([name, what, endpoint]) => (
                <li key={name}><strong>{name}.</strong> {what} <code>{endpoint}</code></li>
              ))}
            </ul>
          </details>
        </div>
      </section>

      {/* 7. The number again, with the short Hollis film when it is on the server. */}
      <section className="lx-section lx-closer" aria-labelledby="lx-closer-h">
        <div className="lx-wrap lx-center">
          <h2 id="lx-closer-h" className="lx-h2">{CLOSER.title}</h2>
          <p className="lx-sub">{CLOSER.sub}</p>
        </div>
        <div className="lx-wrap lx-wide">
          <FilmSlot src={MEDIA.hollisFilm} label={CLOSER.filmLabel} soundOn={HERO.soundOn} soundOff={HERO.soundOff} note={HERO.filmNote} className="lx-film-closer" />
        </div>
        <div className="lx-wrap lx-center">
          <CallNumber number={number} label={CLOSER.callLabel} />
        </div>
      </section>

      {number && showBar && (
        <div className="callbar only-coarse">
          <a className="btn btn-primary" href={telHref(number)}><Icon name="phone" />{HERO.callLabel} · <span className="tnum">{formatPhone(number)}</span></a>
        </div>
      )}
      <Toast message={toast} onDone={() => setToast('')} />
    </div>
  );
}
