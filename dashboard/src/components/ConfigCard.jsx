// ConfigCard: the live card the interview fills, grouped into five cells, each row
// carrying where its value came from (DESIGN-LANGUAGE.md 5.3).
import { Icon } from '../icons.jsx';
import { MASK, getPath } from './fields.jsx';

const LANG = { en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', ja: 'Japanese', zh: 'Chinese', ko: 'Korean' };
const HUMOR = ['None', 'One dry beat per call', 'Light and warm'];
const filled = (v) => (Array.isArray(v) ? v.some((x) => (typeof x === 'string' ? x.trim() : x)) : v !== undefined && v !== null && String(v).trim() !== '');
const count = (arr, key) => (arr ?? []).filter((x) => (key ? x?.[key]?.trim() : String(x ?? '').trim())).length;

/** The five cells, the questions that fill them, and what "ready" means for each. */
export function cells(d) {
  return [
    { id: 'place', title: 'Place', q: 1, ready: filled(d.property?.name) && filled(d.property?.address) && filled(d.property?.lat) && filled(d.property?.lng), rows: [
      { label: 'Name', path: 'property.name', q: 1 },
      { label: 'Address', path: 'property.address', q: 1 },
      { label: 'Map pin', path: 'property.lat', q: 1, show: () => (filled(d.property?.lat) && filled(d.property?.lng) ? `${d.property.lat}, ${d.property.lng}` : '') },
      { label: 'Time zone', path: 'property.timezone', q: 1 },
      { label: 'Feel', path: 'voice.feel', q: 1 },
      { label: 'Kind', path: 'property.kind', q: 0, show: (v) => (v === 'rental' ? 'Short-term rental' : v === 'inn' ? 'Inn' : '') },
      { label: 'Website', path: 'property.website', q: 0 },
    ] },
    { id: 'guests', title: 'Guests', q: 2, ready: filled(d.guests?.typical) && filled(d.guests?.here_for), rows: [
      { label: 'Who stays', path: 'guests.typical', q: 2 },
      { label: 'Here for', path: 'guests.here_for', q: 2 },
    ] },
    { id: 'voice', title: 'Voice', q: 3, ready: filled(d.voice?.persona_id) && filled(d.voice?.languages), rows: [
      { label: 'Persona', path: 'voice.persona_id', step: 'persona', show: (v) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : '') },
      { label: 'Humor', path: 'voice.humor_level', q: 3, show: (v) => HUMOR[v] ?? '' },
      { label: 'Languages', path: 'voice.languages', q: 11, show: (v) => (v ?? []).map((c) => LANG[c] ?? c).join(', ') },
    ] },
    { id: 'house', title: 'House', q: 4, ready: filled(d.logistics?.checkin) && filled(d.logistics?.checkout), rows: [
      { label: 'Check-in', path: 'logistics.checkin', q: 4 },
      { label: 'Checkout', path: 'logistics.checkout', q: 4 },
      { label: 'Parking', path: 'logistics.parking', q: 4 },
      { label: 'Door note', path: 'logistics.access_note', q: 4, secret: true },
      { label: 'Wifi note', path: 'logistics.wifi_note', q: 5, secret: true },
      { label: 'Stay sheet', path: 'stay', q: 5, show: (v) => plural(Object.values(v ?? {}).filter((x) => String(x ?? '').trim()).length, 'topic') },
      { label: 'House rules', path: 'rules.list', q: 6, show: (v) => plural(count(v), 'rule') },
      { label: 'Never bends', path: 'rules.never_bend', q: 6, show: (v) => plural(count(v), 'rule') },
      { label: 'Your picks', path: 'picks', q: 7, show: (v) => (v ?? []).map((p) => p?.name).filter(Boolean).join(', ') },
      { label: 'Never mention', path: 'avoid', q: 8, show: (v) => (v ?? []).map((p) => p?.name).filter(Boolean).join(', ') },
      { label: 'Guest questions', path: 'faq', q: 9, show: (v) => plural(count(v, 'q'), 'answer') },
    ] },
    { id: 'handoff', title: 'Handoff', q: 10, ready: filled(d.handoff?.name) && filled(d.handoff?.hours) && count(d.handoff?.triggers) > 0, rows: [
      { label: 'Hand off to', path: 'handoff.name', q: 10 },
      { label: 'Phone ends in', path: 'handoff.phone_last4', q: 10 },
      { label: 'Reachable', path: 'handoff.hours', q: 10 },
      { label: 'When', path: 'handoff.triggers', q: 10, show: (v) => (v ?? []).filter((x) => x?.trim()).join('; ') },
    ] },
  ];
}

const plural = (n, w) => (n ? `${n} ${w}${n === 1 ? '' : 's'}` : '');

function Provenance({ kind }) {
  if (kind === 'typed') return <span className="prov"><Icon name="keyboard" />Typed</span>;
  if (kind === 'default') return <span className="prov default">Default</span>;
  if (kind === 'sample') return <span className="prov default">Sample</span>;
  return null;
}

export function readiness(d) {
  const c = cells(d);
  return { ready: c.filter((x) => x.ready).length, total: c.length };
}

export default function ConfigCard({ draft, prov, onJump }) {
  const all = cells(draft);
  const { ready, total } = readiness(draft);
  const name = draft.property?.name?.trim() || 'Your place';
  return (
    <section className="card config-card" aria-labelledby="cfg-h">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id="cfg-h">{name}</h2>
        <span className="micro">Config card</span>
      </div>
      <div className="row" style={{ marginTop: 'var(--space-2)' }}>
        <span className="bricks" aria-hidden="true">{all.map((c) => <span key={c.id} className={c.ready ? 'on' : ''} />)}</span>
        <span className="dim tnum" style={{ fontSize: 'var(--text-sm)' }}>{ready} of {total} sections ready</span>
      </div>
      {all.map((cell) => (
        <div className="config-cell" key={cell.id}>
          <h3>{cell.ready && <Icon name="check" width="14" height="14" />}{cell.title}</h3>
          {cell.rows.map((r) => {
            const raw = getPath(draft, r.path);
            const shown = r.secret ? (filled(raw) ? (raw === MASK ? 'Kept from the sample' : 'Saved, sent by text only') : '') : r.show ? r.show(raw) : (raw ?? '');
            const has = filled(shown);
            const kind = has ? (prov[r.path] ?? 'typed') : null;
            return (
              <div className="cfg-row" key={r.path}>
                <span className="micro">{r.label}</span>
                <button type="button" className={`cfg-edit val${has ? '' : ' empty'}${r.secret ? ' secret' : ''}`}
                                    onClick={() => onJump(r)} aria-label={`${r.label}: ${has ? shown : 'not answered yet'}. Edit`}>
                  {r.secret && has && <Icon name="lock" width="14" height="14" />}
                  {has ? shown : 'Not answered yet'}
                </button>
                {r.secret && has ? <span className="prov secret">Never spoken</span> : <Provenance kind={kind} />}
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
