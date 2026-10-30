// The scripted call: caption lines arrive in order once the scene is on screen, then the text
// lands, then the picks page. The lines live in content/call-scene.js. With reduced motion the
// whole scene is shown at once. A screen reader gets the full transcript in order, not a stream.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../icons.jsx';
import { CALL_LINES, PAGE_AT, PICKS, SMS_AT, SMS_BODY } from '../../content/call-scene.js';
import { useReducedMotion, useSeenOnce } from './hooks.js';

const END = PAGE_AT + 600;
const TYPING_LEAD = 700;

function clockOf(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function CallScene({ copy }) {
  const ref = useRef(null);
  const seen = useSeenOnce(ref, 0.3);
  const reduced = useReducedMotion();
  const [t, setT] = useState(reduced ? END : -1);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (reduced) { setT(END); return undefined; }
    if (!seen) return undefined;
    const start = performance.now();
    const id = setInterval(() => {
      const now = performance.now() - start;
      setT(now);
      if (now >= END) clearInterval(id);
    }, 100);
    return () => clearInterval(id);
  }, [seen, reduced, run]);

  const shown = CALL_LINES.filter((l) => t >= l.at);
  const next = CALL_LINES.find((l) => t < l.at && t >= l.at - TYPING_LEAD && t >= 0);
  const done = t >= END;
  const callClock = clockOf(Math.max(0, Math.min(t, SMS_AT)));

  return (
    <div className="lx-scene" ref={ref} data-done={done ? 'yes' : 'no'}>
      <ol className="visually-hidden" aria-label={copy.transcriptLabel}>
        {CALL_LINES.map((l) => <li key={l.at}>{l.who === 'concierge' ? copy.concierge : copy.guest}: {l.text}</li>)}
        <li>{copy.smsLabel}: {SMS_BODY}</li>
      </ol>

      <div className="lx-call" aria-hidden="true">
        <div className="lx-call-head">
          <span className="lx-call-avatar">M</span>
          <div className="lx-call-who">
            <p className="lx-call-name">{copy.callTitle}</p>
            <p className="lx-call-sub">{copy.callSub}</p>
          </div>
          <span className="lx-call-clock" data-live={t >= 0 && t < SMS_AT ? 'yes' : 'no'}>
            <span className="lx-call-dot" />{callClock}
          </span>
        </div>
        <div className="lx-call-lines">
          <ol>
            {shown.map((l) => (
              <li key={l.at} className="lx-line" data-who={l.who}>{l.text}</li>
            ))}
            {next && <li className="lx-line lx-typing" data-who={next.who}><span /><span /><span /></li>}
          </ol>
        </div>
      </div>

      <div className="lx-scene-side" aria-hidden="true">
        <div className="lx-sms" data-show={t >= SMS_AT ? 'yes' : 'no'}>
          <p className="lx-sms-from"><Icon name="bell" />{copy.smsLabel}</p>
          <p className="lx-sms-body">{SMS_BODY}</p>
        </div>
        <div className="lx-page" data-show={t >= PAGE_AT ? 'yes' : 'no'}>
          <p className="lx-page-brand">{copy.pageBrand}</p>
          <p className="lx-page-title">{copy.pageTitle}</p>
          <ul>
            {PICKS.map((p) => (
              <li key={p.name}>
                <span className="lx-page-name">{p.name}</span>
                <span className="lx-page-detail">{p.detail}</span>
                <span className="lx-page-why">{p.why}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {!reduced && (
        <button type="button" className="btn btn-text lx-replay" onClick={() => { setT(0); setRun((n) => n + 1); }} hidden={!done}>
          <Icon name="play" />{copy.replay}
        </button>
      )}
    </div>
  );
}
