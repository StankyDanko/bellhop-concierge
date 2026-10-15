// Inline icons (stroke = currentColor). Decorative by default: aria-hidden.
const P = {
  bell: 'M5 18h14M7 18a5 5 0 0 1 10 0M12 11V9',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
  why: 'M6 6v6a4 4 0 0 0 4 4h4M6 6a2 2 0 1 0 0-.01M18 16a2 2 0 1 0 0 .01M14 12a2 2 0 1 0 0-.01M10 12h2',
  chev: 'M6 9l6 6 6-6',
  keyboard: 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M8 14h8',
  mic: 'M12 4a3 3 0 0 1 3 3v4a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v3',
  check: 'M5 12l4 4 10-10',
  phone: 'M6 3h3l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  warn: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  moon: 'M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z',
  dash: 'M5 12h14',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  arrow: 'M5 12h14M13 6l6 6-6 6',
};

export function Icon({ name, label, ...rest }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={label ? undefined : 'true'} role={label ? 'img' : undefined} aria-label={label} focusable="false" {...rest}>
      <path d={P[name]} />
    </svg>
  );
}
