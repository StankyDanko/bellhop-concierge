// Small hooks the landing sections share: does a media file exist, is a block on screen,
// does the reader ask for less motion.
import { useEffect, useState } from 'react';

/**
 * Asks the server whether a file is there before the page draws a player for it, so a missing
 * film or recording leaves no broken box. 'checking' | 'ok' | 'missing'. The type check keeps a
 * dev server's HTML fallback from passing for a video.
 * @param {string} url
 * @param {string} kind the media type prefix, e.g. 'video/', 'audio/', 'image/', 'application/json'
 */
export function useAsset(url, kind) {
  const [state, setState] = useState('checking');
  useEffect(() => {
    if (!url || typeof fetch !== 'function') { setState('missing'); return undefined; }
    let active = true;
    fetch(url, { method: 'HEAD' })
      .then((r) => { if (active) setState(r.ok && (r.headers.get('content-type') ?? '').startsWith(kind) ? 'ok' : 'missing'); })
      .catch(() => { if (active) setState('missing'); });
    return () => { active = false; };
  }, [url, kind]);
  return state;
}

/** True once the element has been on screen (threshold share visible). Stays true. */
export function useSeenOnce(ref, threshold = 0.35) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return undefined; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, threshold, seen]);
  return seen;
}

export function useReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return undefined;
    const on = () => setReduced(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return Boolean(reduced);
}
