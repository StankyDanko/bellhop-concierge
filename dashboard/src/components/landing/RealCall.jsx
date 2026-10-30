// A recorded call with its captions lit in time. The audio and the cue file are optional: with
// no recording on the server the section renders nothing; with audio and no cues it is a plain
// player. Cues: [{ start, end, speaker, text }], seconds.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../icons.jsx';
import { useAsset } from './hooks.js';

function clockOf(s) {
  const n = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

/** Keeps only well-formed cues, in time order. */
export function cleanCues(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start && typeof c.text === 'string' && c.text.trim())
    .map((c) => ({ start: c.start, end: c.end, speaker: String(c.speaker ?? ''), text: c.text.trim() }))
    .sort((a, b) => a.start - b.start);
}

function useCues(url, enabled) {
  const [cues, setCues] = useState([]);
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    fetch(url).then((r) => (r.ok ? r.json() : [])).then((j) => { if (active) setCues(cleanCues(j)); }).catch(() => {});
    return () => { active = false; };
  }, [url, enabled]);
  return cues;
}

export function RealCall({ src, cuesUrl, copy }) {
  const audio = useAsset(src, 'audio/');
  const cues = useCues(cuesUrl, audio === 'ok');
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);

  if (audio !== 'ok') return null;

  const at = cues.findIndex((c) => time >= c.start && time < c.end);
  const last = at >= 0 ? at : cues.reduce((k, c, i) => (c.start <= time ? i : k), -1);
  const cur = last >= 0 ? cues[last] : null;
  const prev = last > 0 ? cues[last - 1] : null;

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {}); else a.pause();
  };

  return (
    <section className="lx-section lx-listen" aria-labelledby="lx-listen-h">
      <div className="lx-wrap lx-center">
        <p className="lx-eyebrow">{copy.eyebrow}</p>
        <h2 id="lx-listen-h" className="lx-h2">{copy.title}</h2>
        <p className="lx-sub">{copy.sub}</p>
      </div>
      <div className="lx-wrap lx-player">
        <audio ref={ref} src={src} preload="metadata"
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} />
        {cues.length > 0 && (
          <div className="lx-captions" aria-live="off">
            <p className="lx-cap-prev" aria-hidden="true">{prev ? prev.text : ' '}</p>
            <p className="lx-cap-cur" data-speaker={cur?.speaker?.toLowerCase() ?? ''}>
              {cur && <span className="lx-cap-who">{cur.speaker}</span>}
              {cur ? cur.text : ' '}
            </p>
          </div>
        )}
        <div className="lx-controls">
          <button type="button" className="lx-play" onClick={toggle} aria-label={playing ? copy.pause : copy.play}>
            <Icon name={playing ? 'pause' : 'play'} />
          </button>
          <input className="lx-seek" type="range" min="0" max={dur || 0} step="0.1" value={Math.min(time, dur || 0)}
            aria-label={copy.seek} style={{ '--p': dur ? `${(time / dur) * 100}%` : '0%' }}
            onChange={(e) => { const a = ref.current; if (a) a.currentTime = Number(e.target.value); setTime(Number(e.target.value)); }} />
          <span className="lx-time tnum">{clockOf(time)} / {clockOf(dur)}</span>
        </div>
      </div>
    </section>
  );
}
