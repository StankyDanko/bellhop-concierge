// A 16:9 film slot. Plays a muted loop as a preview; one tap plays the film from the top with
// sound. With a `preview` file, the loop is that short cut and the tap swaps in the full film, so
// the page never downloads the whole film just to decorate the hero. When the file is not on the
// server, the hero slot shows a designed still and any other slot renders nothing, so a film that
// has not landed yet never leaves a broken box.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../icons.jsx';
import { useAsset, useReducedMotion } from './hooks.js';

/** Bar heights for the still's voice line, fixed so every render matches. */
const WAVE = [0.3, 0.5, 0.8, 0.55, 0.9, 0.4, 0.65, 1, 0.7, 0.45, 0.85, 0.6, 0.35, 0.75, 0.5, 0.95, 0.55, 0.4, 0.7, 0.3, 0.6, 0.45, 0.8, 0.35];

function Placeholder({ quote, caption }) {
  return (
    <div className="lx-film-still" role="img" aria-label={`${quote} ${caption}`}>
      <span className="lx-film-ring" aria-hidden="true"><Icon name="phone" /></span>
      <p className="lx-film-quote" aria-hidden="true">{quote}</p>
      <p className="lx-film-caption" aria-hidden="true">{caption}</p>
      <span className="lx-wave" aria-hidden="true">{WAVE.map((h, i) => <i key={i} style={{ '--h': h, '--d': `${(i % 7) * 0.11}s` }} />)}</span>
    </div>
  );
}

export function FilmSlot({ src, preview, poster, label, soundOn, soundOff, placeholder, note, className = '' }) {
  const film = useAsset(preview ?? src, 'video/');
  const still = useAsset(poster, 'image/');
  const reduced = useReducedMotion();
  const ref = useRef(null);
  const [sound, setSound] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v || film !== 'ok') return;
    if (!reduced && !sound) v.play?.().catch(() => { /* autoplay refused: the poster and the button stay */ });
  }, [film, reduced, sound]);

  if (film !== 'ok' || failed) {
    if (!placeholder) return null;
    return <figure className={`lx-film ${className}`}><Placeholder {...placeholder} /></figure>;
  }

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (sound) { v.muted = true; setSound(false); return; }
    // Swapped by hand, inside the tap, so the browser counts the play as the reader's own.
    if (preview && !v.currentSrc.endsWith(src)) v.src = src;
    v.muted = false;
    v.loop = false;
    v.currentTime = 0;
    v.play?.().catch(() => {});
    setSound(true);
  };

  return (
    <>
    <figure className={`lx-film ${className}`} data-sound={sound ? 'on' : 'off'}>
      <video
        ref={ref}
        src={preview ?? src}
        poster={still === 'ok' ? poster : undefined}
        muted={!sound}
        loop={!sound}
        playsInline
        preload="metadata"
        autoPlay={!reduced}
        controls={sound}
        aria-label={label}
        onError={() => setFailed(true)}
      />
      <button type="button" className="lx-film-sound" onClick={toggle} aria-pressed={sound}>
        <Icon name={sound ? 'muted' : 'sound'} />
        {sound ? soundOff : soundOn}
      </button>
    </figure>
    {note && <p className="lx-film-note">{note}</p>}
    </>
  );
}
