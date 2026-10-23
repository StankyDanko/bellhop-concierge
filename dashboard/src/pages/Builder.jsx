// `/build`: the typed innkeeper interview (Q0 to Q11), guardrails, persona, preview, publish.
// The draft lives in this browser until it is saved; Preview compiles it on the server
// without writing anything (DESIGN-LANGUAGE.md 5.3 to 5.9, R8 section 5).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../icons.jsx';
import { Link } from '../router.jsx';
import ConfigCard, { readiness } from '../components/ConfigCard.jsx';
import { LinesField, ListEditor, MASK, Segmented, SecretField, setPath, Switch, TextField, getPath } from '../components/fields.jsx';
import { Banner, Toast } from '../components/ui.jsx';

const STORE = 'bc-builder-v1';
const STEPS = [
  { id: 'interview', label: 'Interview' },
  { id: 'guardrails', label: 'Guardrails' },
  { id: 'persona', label: 'Persona' },
  { id: 'preview', label: 'Preview' },
  { id: 'publish', label: 'Publish' },
];
const LANGS = [['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['pt', 'Portuguese'], ['it', 'Italian']];
const ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];
const CATEGORIES = ['food', 'drinks', 'music', 'outdoors', 'arts', 'shopping', 'coffee', 'other'];
const FIELD_LABELS = {
  'property.name': 'Name of the inn', 'property.address': 'Street address', 'property.lat': 'Latitude', 'property.lng': 'Longitude',
  'property.website': 'Website', 'property.timezone': 'Time zone', 'voice.feel': 'The feeling you want', 'guests.typical': 'Who usually stays',
  'guests.here_for': 'What they come for', 'logistics.checkin': 'Check-in', 'logistics.checkout': 'Checkout', 'logistics.parking': 'Parking',
  'handoff.name': 'Your first name', 'handoff.hours': 'When you are reachable', 'handoff.triggers': 'Send guests to you for', 'handoff.phone_last4': 'Last four digits',
  'picks.name': 'A favorite spot name', 'picks.why': 'Why you love a spot', 'faq.q': 'A guest question', 'faq.a': 'An answer', 'avoid.name': 'A place to skip',
  'rules.list': 'House rules', 'rules.never_bend': 'Rules you never bend', picks: 'Your favorite spots',
  'property.kind': 'Inn or short-term rental', 'stay.welcome': 'Your welcome', 'stay.amenities': 'Pool or building amenities',
  'stay.trash': 'Trash and recycling day', 'stay.quiet_hours': 'Quiet hours', 'stay.contact': 'How guests reach you', 'stay.transit': 'Getting around',
};
/** The stay sheet's fields, in the order the builder asks them (config/schema.js STAY_FIELDS). */
const STAY_ROWS = [
  ['welcome', 'Your welcome, in your words', 240, 'Welcome in. The coffee in the kitchen is yours.'],
  ['amenities', 'Pool or building amenities, and their hours', 240, 'The pool is open from eight in the morning to ten at night.'],
  ['trash', 'Trash and recycling day', 160, 'Trash and recycling go to the curb on Tuesday night.'],
  ['quiet_hours', 'Quiet hours', 160, 'Ten at night to eight in the morning.'],
  ['contact', 'How guests reach you', 200, 'Message me through the booking app.'],
  ['transit', 'A tip for getting around', 200, 'The trolley stops at the corner.'],
];
const SAMPLES = { inn: ['demo', 'the sample inn'], rental: ['miami', 'the sample rental'] };
const LINT_WORDS = {
  em_dash: 'A long dash the voice stumbles on',
  forbidden_word: 'A word this product never uses',
  phone_number: 'A phone number in spoken text',
  url: 'A web address in spoken text',
  heteronym_live: 'A word the voice mispronounces',
  heteronym: 'A word the voice may say two ways',
  punctuation: 'Punctuation the voice reads awkwardly',
  unfilled_slot: 'A blank left in the instructions',
};
const HUMOR_TEXT = [
  'None. Warm and plain, no jokes.',
  'Dry. At most one light remark per call, never about the guest.',
  'Light. Up to two warm remarks per call, never about the guest.',
];

function blankConfig() {
  return {
    schema_version: 1,
    property: { kind: 'inn', name: '', address: '', lat: '', lng: '', timezone: 'America/New_York', website: '' },
    voice: { persona_id: 'harper', humor_level: 1, languages: ['en'], feel: '' },
    guests: { typical: '', here_for: '' },
    logistics: { checkin: '', checkout: '', parking: '', access_note: '', wifi_note: '' },
    rules: { list: [], never_bend: [] },
    picks: [], avoid: [], faq: [],
    handoff: { name: '', phone_last4: '', triggers: [], hours: '' },
    permissions: { send_itinerary_sms: true, suggest_partners: false, upsell: false },
    trust_level: 'test',
    stay: Object.fromEntries(STAY_ROWS.map(([k]) => [k, ''])),
  };
}
const DEFAULT_PROV = Object.fromEntries(['property.timezone', 'voice.persona_id', 'voice.humor_level', 'voice.languages'].map((k) => [k, 'default']));

/** Every leaf path that has a value, for marking a whole loaded config with one provenance. */
function leafPaths(obj, prefix = '') {
  return Object.entries(obj ?? {}).flatMap(([k, v]) => {
    const p = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === 'object' && !Array.isArray(v) ? leafPaths(v, p) : [p];
  });
}

/** Turn the editable draft into the shape config/schema.js accepts. */
export function cleanConfig(d) {
  const c = structuredClone(d);
  const trim = (o) => { for (const k of Object.keys(o)) if (typeof o[k] === 'string') o[k] = o[k].trim(); };
  ['property', 'voice', 'guests', 'logistics', 'handoff'].forEach((k) => trim(c[k]));
  for (const [obj, key] of [[c.property, 'website'], [c.voice, 'feel'], [c.logistics, 'parking'], [c.logistics, 'access_note'], [c.logistics, 'wifi_note'], [c.handoff, 'phone_last4']]) {
    if (obj[key] === '' || obj[key] == null) delete obj[key];
  }
  for (const k of ['lat', 'lng']) if (c.property[k] !== '' && c.property[k] != null) c.property[k] = Number(c.property[k]);
  const lines = (a) => (a ?? []).map((s) => String(s).trim()).filter(Boolean);
  c.rules.list = lines(c.rules.list);
  c.rules.never_bend = lines(c.rules.never_bend);
  c.handoff.triggers = lines(c.handoff.triggers);
  c.picks = (c.picks ?? []).filter((p) => p.name?.trim()).map((p) => ({ ...p, name: p.name.trim(), why: (p.why ?? '').trim(), ...(p.partner ? { partner: true } : { partner: undefined }) }));
  c.picks.forEach((p) => { if (p.partner === undefined) delete p.partner; });
  c.avoid = (c.avoid ?? []).filter((a) => a.name?.trim()).map((a) => ({ name: a.name.trim(), reason: (a.reason ?? '').trim() }));
  c.faq = (c.faq ?? []).filter((f) => f.q?.trim()).map((f) => ({ q: f.q.trim(), a: (f.a ?? '').trim() }));
  // The stay sheet is optional: empty fields go, and so does a sheet with nothing in it.
  const stay = Object.fromEntries(Object.entries(c.stay ?? {}).map(([k, v]) => [k, String(v ?? '').trim()]).filter(([, v]) => v));
  if (Object.keys(stay).length) c.stay = stay; else delete c.stay;
  // An inn is the default kind, so an inn's saved config stays exactly what it was.
  if (c.property.kind !== 'rental') delete c.property.kind;
  return c;
}

/** Which question or step owns a schema path, for "Fix this" links on server errors. */
function ownerOf(path) {
  const p = path.replace(/\[\d+\]/g, '');
  if (p === 'property.website' || p === 'property.kind') return { q: 0 };
  if (p.startsWith('stay')) return { q: 5 };
  if (p.startsWith('property.') || p === 'voice.feel') return { q: 1 };
  if (p.startsWith('guests')) return { q: 2 };
  if (p === 'voice.humor_level') return { q: 3 };
  if (p === 'logistics.wifi_note') return { q: 5 };
  if (p.startsWith('logistics')) return { q: 4 };
  if (p.startsWith('rules')) return { q: 6 };
  if (p.startsWith('picks')) return { q: 7 };
  if (p.startsWith('avoid')) return { q: 8 };
  if (p.startsWith('faq')) return { q: 9 };
  if (p.startsWith('handoff')) return { q: 10 };
  if (p.startsWith('permissions') || p === 'voice.languages') return { q: 11 };
  if (p === 'voice.persona_id') return { step: 'persona' };
  return { step: 'publish' };
}

function parseErrors(list) {
  const map = {};
  for (const e of list ?? []) {
    const m = /^([^:]+): (.*)$/.exec(e);
    if (m) map[m[1].trim()] ??= m[2];
  }
  return map;
}

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORE) ?? 'null'); } catch { return null; }
}

// ---- questions ----------------------------------------------------------------------

function questions(ctx) {
  const d = ctx.draft;
  const kind = d.property.kind === 'rental' ? 'rental' : 'inn';
  const sampleName = SAMPLES[kind][1];
  return [
    {
      title: 'Start from your website or listing',
      ask: 'Is this an inn or a short-term rental? Paste your website so the concierge can text it to guests, then choose where to begin.',
      body: (
        <>
          <Segmented name="kind" legend="What kind of place" value={kind} describedBy="kind-help"
            options={[{ value: 'inn', label: 'Inn' }, { value: 'rental', label: 'Short-term rental' }]}
            onChange={ctx.setKind} />
          <p className="help dim" id="kind-help" style={{ marginTop: 'var(--space-2)' }}>
            {kind === 'rental'
              ? 'A home with no front desk. Guests can ask about the stay, like checkout or trash day, and you are the rental host they message.'
              : 'A front desk with an innkeeper. Guests ask about the evening, and you handle the rest.'}
          </p>
          <TextField ctx={ctx} path="property.website" label="Website" type="url" inputMode="url" autoComplete="url" placeholder="https://your-place.example" help="Optional. Must start with https. It is texted, never read aloud." />
          <Banner tone="info">Reading a listing automatically is coming in the hosted service. For now, start from {sampleName} and change what you like, or start blank.</Banner>
          <div className="row" style={{ marginTop: 'var(--space-4)' }}>
            <button type="button" className="btn btn-secondary" onClick={ctx.loadSample} disabled={ctx.sampleState === 'loading'}>
              {ctx.sampleState === 'loading' ? `Loading ${sampleName}` : `Start from ${sampleName}`}
            </button>
            <button type="button" className="btn btn-text" onClick={ctx.startBlank}>Start blank</button>
          </div>
          {ctx.sampleState === 'error' && <Banner tone="danger">We couldn't load {sampleName}. Start blank, or try again in a moment.</Banner>}
        </>
      ),
    },
    {
      title: 'Your place',
      ask: 'What is the place called, where is it, and what feeling do you want guests to have?',
      body: (
        <>
          <TextField ctx={ctx} path="property.name" label={kind === 'rental' ? 'Name of the rental' : 'Name of the inn'} required maxLength={60} autoComplete="organization" />
          <TextField ctx={ctx} path="property.address" label="Street address" required maxLength={160} autoComplete="street-address" help="Used to find picks nearby. Never read aloud." />
          <div className="field-row" style={{ marginTop: 'var(--space-4)' }}>
            <TextField ctx={ctx} path="property.lat" label="Latitude" type="number" inputMode="decimal" required help="From your map pin, for example 32.0749" />
            <TextField ctx={ctx} path="property.lng" label="Longitude" type="number" inputMode="decimal" required help="For example -81.0943" />
          </div>
          <div className="field">
            <label htmlFor="tz">Time zone</label>
            <select id="tz" className="select" value={d.property.timezone} onChange={(e) => ctx.update('property.timezone', e.target.value)}>
              {ZONES.map((z) => <option key={z} value={z}>{z.replace('_', ' ')}</option>)}
            </select>
            <p className="help">Sets what "tonight" means for event picks.</p>
          </div>
          <TextField ctx={ctx} path="voice.feel" label="The feeling you want guests to have" multiline maxLength={200} placeholder="Like staying with a friend who knows every kitchen in town." />
        </>
      ),
    },
    {
      title: 'Your guests',
      ask: 'Who usually stays with you, and what are they here to do?',
      body: (
        <>
          <TextField ctx={ctx} path="guests.typical" label="Who usually stays" multiline required maxLength={200} placeholder="Couples on a long weekend, a few small groups of friends." />
          <TextField ctx={ctx} path="guests.here_for" label="What they come for" multiline required maxLength={200} placeholder="Walking the squares, eating well, a night out with music." />
        </>
      ),
    },
    {
      title: 'How it sounds',
      ask: 'How much humor should your concierge use? You pick the voice itself in the Persona step.',
      body: (
        <>
          <Segmented name="humor" legend="Humor" value={d.voice.humor_level} describedBy="humor-help"
            options={[{ value: 0, label: 'None' }, { value: 1, label: 'Dry' }, { value: 2, label: 'Light' }]}
            onChange={(v) => ctx.update('voice.humor_level', v)} />
          <p className="help dim" id="humor-help" style={{ marginTop: 'var(--space-2)' }}>{HUMOR_TEXT[d.voice.humor_level]} Each persona has a ceiling; Harper stops at Dry.</p>
        </>
      ),
    },
    {
      title: 'Arriving',
      ask: 'Check-in and checkout times, how guests get in, and where they park.',
      body: (
        <>
          <div className="field-row">
            <TextField ctx={ctx} path="logistics.checkin" label="Check-in" required maxLength={80} placeholder="Four in the afternoon" help="Write times in words; the voice reads them." />
            <TextField ctx={ctx} path="logistics.checkout" label="Checkout" required maxLength={80} placeholder="Eleven in the morning" />
          </div>
          <TextField ctx={ctx} path="logistics.parking" label="Parking" multiline maxLength={160} />
          <SecretField ctx={ctx} path="logistics.access_note" label="Door, gate, or lockbox note" help="Never compiled into the concierge. Your booking system texts it to the reservation phone." />
        </>
      ),
    },
    {
      title: 'The house',
      ask: 'Your wifi details, and the stay sheet guests can ask about. The concierge never says or texts wifi details on a call; it points guests to their check-in message.',
      body: (
        <>
          <SecretField ctx={ctx} path="logistics.wifi_note" label="Wifi network and password" help="Stored as a secret. Never compiled into the concierge." />
          <fieldset className="fieldset" style={{ marginTop: 'var(--space-4)' }}>
            <legend>The stay sheet <span className="dim">(optional, every field)</span></legend>
            <p className="help dim">When a guest asks about the stay, the concierge answers from these, in your words, one topic at a time. Check-in, checkout, parking, house rules, and your favorite spots come from your other answers. Never put a code or a password here.</p>
            {STAY_ROWS.map(([k, label, max, placeholder]) => (
              <TextField key={k} ctx={ctx} path={`stay.${k}`} label={label} multiline maxLength={max} placeholder={placeholder} />
            ))}
          </fieldset>
        </>
      ),
    },
    {
      title: 'House rules',
      ask: 'The house rules that matter most, and any you never bend on.',
      body: (
        <>
          <LinesField ctx={ctx} path="rules.list" label="House rules, one per line" placeholder="Quiet hours are ten at night to eight in the morning." help="Up to twelve." />
          <LinesField ctx={ctx} path="rules.never_bend" label="Rules you never bend, one per line" placeholder="No smoking anywhere on the property." help="Up to six. The concierge never negotiates these." />
        </>
      ),
    },
    {
      title: 'Your favorite spots',
      ask: 'Tell us three to five local spots you love, and why. The concierge quotes your reason.',
      body: (
        <ListEditor ctx={ctx} path="picks" max={8} itemLabel="Spot" addLabel="Add a spot" blank={{ name: '', why: '', category: 'food' }}
          render={(i) => (
            <>
              <TextField ctx={ctx} path={`picks.${i}.name`} label="Name" maxLength={80} />
              <TextField ctx={ctx} path={`picks.${i}.why`} label="Why you love it" multiline maxLength={200} />
              <div className="field">
                <label htmlFor={`cat-${i}`}>Kind of place</label>
                <select id={`cat-${i}`} className="select" value={getPath(d, `picks.${i}.category`)} onChange={(e) => ctx.update(`picks.${i}.category`, e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </>
          )} />
      ),
    },
    {
      title: 'Places to skip',
      ask: 'Anything nearby you steer guests away from, or never want mentioned?',
      body: (
        <ListEditor ctx={ctx} path="avoid" max={20} itemLabel="Place" addLabel="Add a place to skip" blank={{ name: '', reason: '' }}
          render={(i) => (
            <>
              <TextField ctx={ctx} path={`avoid.${i}.name`} label="Name" maxLength={80} />
              <TextField ctx={ctx} path={`avoid.${i}.reason`} label="Why (for you; never said to guests)" maxLength={160} />
            </>
          )} />
      ),
    },
    {
      title: 'Guest questions',
      ask: 'What are the questions guests ask you most? Give your answer to each.',
      body: (
        <ListEditor ctx={ctx} path="faq" max={5} itemLabel="Question" addLabel="Add a question" blank={{ q: '', a: '' }}
          render={(i) => (
            <>
              <TextField ctx={ctx} path={`faq.${i}.q`} label="The question" maxLength={160} />
              <TextField ctx={ctx} path={`faq.${i}.a`} label="Your answer" multiline maxLength={280} />
            </>
          )} />
      ),
    },
    {
      title: 'Handing off to you',
      ask: 'When should the concierge send a guest to you, who is that, and when are you reachable?',
      body: (
        <>
          <div className="field-row">
            <TextField ctx={ctx} path="handoff.name" label="Your first name" required maxLength={60} autoComplete="given-name" />
            <TextField ctx={ctx} path="handoff.phone_last4" label="Last four digits of your phone" inputMode="numeric" maxLength={4} help="Shown on your dashboard only. Never compiled." />
          </div>
          <TextField ctx={ctx} path="handoff.hours" label="When you are reachable" required maxLength={120} placeholder="Eight in the morning to nine at night, every day" />
          <LinesField ctx={ctx} path="handoff.triggers" label="Send guests to you for, one per line" placeholder={'a problem with the room\na lockout'} help="Rates, bookings, refunds, and changes to a stay always go to you." />
        </>
      ),
    },
    {
      title: 'What it may do',
      ask: 'What may it do on its own, and which languages should it speak?',
      body: <OwnerToggles ctx={ctx} />,
    },
  ];
}

function OwnerToggles({ ctx, withAvoid = false }) {
  const d = ctx.draft;
  const langs = d.voice.languages ?? [];
  const toggleLang = (code) => {
    const next = langs.includes(code) ? langs.filter((c) => c !== code) : [...langs, code].slice(0, 4);
    if (next.length) ctx.update('voice.languages', next);
  };
  return (
    <div>
      <Switch label="Text the guest a plan" checked={d.permissions.send_itinerary_sms} onChange={(v) => ctx.update('permissions.send_itinerary_sms', v)}
        consequence={d.permissions.send_itinerary_sms ? 'On. After the first pick, it offers one text with each place and why.' : 'Off. It says the top two picks out loud instead.'} />
      <Switch label="Mention your partners" checked={d.permissions.suggest_partners} onChange={(v) => ctx.update('permissions.suggest_partners', v)}
        consequence={d.permissions.suggest_partners ? 'On. It may recommend a partner when it fits, and always says you work with them.' : 'Off. No business is presented as your partner.'} />
      <Switch label="Mention paid extras" checked={d.permissions.upsell} onChange={(v) => ctx.update('permissions.upsell', v)}
        consequence={d.permissions.upsell ? 'On. If asked, it may mention an extra once, from your answers only.' : 'Off. It never offers anything the inn sells.'} />
      <fieldset className="fieldset" style={{ marginTop: 'var(--space-4)' }}>
        <legend>Languages <span className="dim">(first one is where calls start, up to four)</span></legend>
        <div className="row">
          {LANGS.map(([code, name]) => (
            <button key={code} type="button" className="chip-btn" aria-pressed={langs.includes(code)} onClick={() => toggleLang(code)}>
              {langs.includes(code) && <Icon name="check" />}{name}
            </button>
          ))}
        </div>
      </fieldset>
      {withAvoid && <AvoidChips ctx={ctx} />}
    </div>
  );
}

/** Add-only chip input for places to skip (reason optional here, defaulted). */
function AvoidChips({ ctx }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const items = ctx.draft.avoid ?? [];
  const add = (e) => {
    e.preventDefault();
    const name = text.trim();
    if (!name) return;
    if (items.some((a) => a.name.trim().toLowerCase() === name.toLowerCase())) { setErr(`${name} is already on the list.`); return; }
    if (items.length >= 20) { setErr('The list holds twenty places.'); return; }
    ctx.update('avoid', [...items, { name, reason: 'Owner asked to skip it.' }]);
    setText(''); setErr('');
  };
  return (
    <form className="field" style={{ marginTop: 'var(--space-4)' }} onSubmit={add}>
      <label htmlFor="avoid-add">Places it never mentions</label>
      <div className="row">
        {items.map((a, i) => (
          <button key={a.name} type="button" className="chip-btn" aria-label={`Remove ${a.name}`} onClick={() => ctx.update('avoid', items.filter((_, j) => j !== i))}>
            {a.name}<Icon name="x" />
          </button>
        ))}
      </div>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input id="avoid-add" className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={80} aria-describedby={err ? 'avoid-err' : undefined} aria-invalid={err ? 'true' : undefined} />
        <button type="submit" className="btn btn-quiet">Add</button>
      </div>
      {err && <p className="err" id="avoid-err" role="alert"><Icon name="warn" width="16" height="16" />{err}</p>}
    </form>
  );
}

// ---- steps --------------------------------------------------------------------------------

function Interview({ ctx, q, setQ, onDone }) {
  const qs = questions(ctx);
  const cur = qs[q];
  const headRef = useRef(null);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } headRef.current?.focus(); }, [q]);
  return (
    <section className="question" aria-labelledby="q-h">
      <p className="micro mono tnum">{q === 0 ? 'Before we start' : `Question ${q} of ${qs.length - 1}`}</p>
      <div className="bricks" aria-hidden="true" style={{ marginTop: 'var(--space-2)' }}>
        {qs.slice(1).map((_, i) => <span key={i} className={i < q ? 'on' : ''} />)}
      </div>
      <h2 id="q-h" ref={headRef} tabIndex={-1}>{cur.ask}</h2>
      <div style={{ marginTop: 'var(--space-5)' }}>{cur.body}</div>
      {q > 0 && (
        <div className="mic">
          <button type="button" className="btn btn-secondary" disabled aria-describedby="mic-note"><Icon name="mic" />Talk to the builder</button>
          <p className="help dim" id="mic-note" style={{ fontSize: 'var(--text-sm)' }}>Talking to the builder is coming in the hosted service. Typing builds the same card.</p>
        </div>
      )}
      <div className="q-actions">
        {q > 0 && <button type="button" className="btn btn-quiet" onClick={() => setQ(q - 1)}>Back</button>}
        <span className="spacer" />
        {q > 0 && q < qs.length - 1 && <button type="button" className="btn btn-text" onClick={() => setQ(q + 1)}>Skip for now</button>}
        {q < qs.length - 1
          ? <button type="button" className="btn btn-primary" onClick={() => setQ(q + 1)}>{q === 0 ? 'Begin the questions' : 'Next question'}</button>
          : <button type="button" className="btn btn-primary" onClick={onDone}>Continue to guardrails</button>}
      </div>
    </section>
  );
}

function Guardrails({ ctx, onNext }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(() => window.matchMedia?.('(min-width: 1024px)').matches ?? true);
  useEffect(() => { api('/guardrails').then((r) => setData(r.ok ? r.data : { error: true })); }, []);
  const d = ctx.draft;
  return (
    <section aria-labelledby="g-h" className="stack">
      <h2 id="g-h" style={{ fontSize: 'var(--text-xl)' }}>Guardrails</h2>
      <div className="guard-wrap"><div className="guard">
        <div>
          <h3 style={{ fontSize: 'var(--text-md)' }}>Yours to adjust</h3>
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Segmented name="humor-g" legend="Humor" value={d.voice.humor_level}
              options={[{ value: 0, label: 'None' }, { value: 1, label: 'Dry' }, { value: 2, label: 'Light' }]}
              onChange={(v) => ctx.update('voice.humor_level', v)} describedBy="humor-g-help" />
            <p className="help dim" id="humor-g-help" style={{ fontSize: 'var(--text-sm)', marginTop: 'var(--space-1)' }}>Humor: {HUMOR_TEXT[d.voice.humor_level]}</p>
            <OwnerToggles ctx={ctx} withAvoid />
          </div>
        </div>
        <div>
          <h3 style={{ fontSize: 'var(--text-md)' }}>Always on. Not adjustable, by design.</h3>
          <button type="button" className="btn btn-text locked-toggle" aria-expanded={open} aria-controls="locked-list" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide' : 'Show'} the rules that are always on ({data?.locked?.length ?? 0})
          </button>
          {data?.error && <Banner tone="danger">We couldn't load the safety rules. This is a bug on our side; nothing was published.</Banner>}
          <ul id="locked-list" className="locked-list" hidden={!open} style={{ marginTop: 'var(--space-3)' }}>
            {(data?.locked ?? []).map((r) => (
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
              <li key={r.id} className="locked" tabIndex={0} aria-label={`Locked: ${r.rule} ${r.why}`}>
                <Icon name="lock" />
                <span>{r.rule}</span>
                <span className="why-line">{r.why}</span>
              </li>
            ))}
          </ul>
        </div>
      </div></div>
      <div className="q-actions"><span className="spacer" /><button type="button" className="btn btn-primary" onClick={onNext}>Looks right</button></div>
    </section>
  );
}

function PersonaStep({ ctx, onNext }) {
  const [list, setList] = useState(null);
  const kind = ctx.draft.property?.kind === 'rental' ? 'rental' : 'inn';
  // Only the voices for this kind of place: the server refuses a rental with an inn voice, and the reverse.
  useEffect(() => { api('/personas').then((r) => setList(r.ok ? r.data.personas.filter((p) => (p.kind ?? 'inn') === kind) : [])); }, [kind]);
  const sel = ctx.draft.voice.persona_id;
  const chosen = list?.find((p) => p.id === sel);
  return (
    <section aria-labelledby="p-h" className="stack">
      <h2 id="p-h" style={{ fontSize: 'var(--text-xl)' }}>Pick a voice</h2>
      <fieldset className="fieldset">
        <legend className="visually-hidden">Persona</legend>
        <div className="personas">
          {list === null && [0, 1].map((i) => <div key={i} className="skeleton" style={{ height: '11rem' }} />)}
          {list?.map((p) => (
            <label key={p.id} className="persona">
              <input type="radio" name="persona" value={p.id} checked={sel === p.id} onChange={() => ctx.update('voice.persona_id', p.id)} />
              <span className="row" style={{ justifyContent: 'space-between' }}>
                <strong style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>{p.display_name}</strong>
                {sel === p.id && <span className="chip chip-accent"><Icon name="check" />Selected</span>}
              </span>
              <span>{p.title.replace(`${p.display_name}, `, '').replace(/^./, (c) => c.toUpperCase())}. {p.character}</span>
              <span className="sample">"{p.sample}"</span>
              <span className="micro">Humor up to {['none', 'dry', 'light'][p.humor_ceiling]}</span>
            </label>
          ))}
          <div className="persona disabled" aria-disabled="true">
            <span className="micro">Coming later</span>
            <strong style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>Custom voice</strong>
            <span className="dim">Want a voice that sounds like your place? The hosted service builds one with you.</span>
          </div>
        </div>
      </fieldset>
      {ctx.draft.voice.humor_level > (chosen?.humor_ceiling ?? 2) && (
        <Banner tone="info">{chosen.display_name} keeps humor at {['none', 'dry', 'light'][chosen.humor_ceiling]}, so your humor setting is capped for this voice.</Banner>
      )}
      <p className="dim" style={{ fontSize: 'var(--text-sm)' }}>Voice samples play in the hosted service. The line in quotes is how they sound.</p>
      <div className="q-actions"><span className="spacer" /><button type="button" className="btn btn-primary" disabled={!chosen} onClick={onNext}>Choose {chosen?.display_name ?? 'a voice'}</button></div>
    </section>
  );
}

function PreviewStep({ ctx, preview, runPreview, onNext, goTo }) {
  const r = preview.result;
  const errs = r?.errors ?? [];
  // Deployment placeholders (tool server address, secret ids) are expected in a public preview: one line, not eight.
  const placeholders = (r?.lint ?? []).filter((f) => f.rule === 'placeholder' && f.severity !== 'error').length;
  const findings = (r?.lint ?? []).filter((f) => !(f.rule === 'placeholder' && f.severity !== 'error'));
  const notes = findings.filter((f) => f.severity !== 'error').length;
  return (
    <section aria-labelledby="pv-h" className="stack">
      <h2 id="pv-h" style={{ fontSize: 'var(--text-xl)' }}>What your concierge will be told.</h2>
      <p className="prose dim">The opening line, the start of its instructions, and the tools it may use, compiled from your answers and checked. Nothing is saved or published.</p>
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={runPreview} disabled={preview.state === 'loading'} aria-busy={preview.state === 'loading'}>
          {preview.state === 'loading' ? 'Building the preview' : r ? 'Build the preview again' : 'Build the preview'}
        </button>
      </div>
      <div aria-live="polite">
        {preview.state === 'neterror' && <Banner tone="danger">Something broke on our side. Nothing you entered was lost. Try again.</Banner>}
        {errs.length > 0 && (
          <div className="card" style={{ marginTop: 'var(--space-3)' }}>
            <h3>A few answers need a change</h3>
            <ul className="lint-list" style={{ marginTop: 'var(--space-3)' }}>
              {errs.map((e) => {
                const [path, msg] = e.split(/: (.*)/s);
                const own = ownerOf(path);
                return (
                  <li key={e}>
                    <span className="chip chip-danger">Fix</span>
                    <span><strong style={{ fontWeight: 600 }}>{FIELD_LABELS[path.replace(/\[\d+\]/g, '')] ?? path}</strong>: {msg}</span>
                    <button type="button" className="btn btn-text" onClick={() => goTo(own)}>Go to {own.q !== undefined ? `question ${own.q}` : own.step}</button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {r?.ok && (
          <div className="stack" style={{ marginTop: 'var(--space-3)' }}>
            <div className="row">
              {r.meta.errors === 0 ? <span className="chip chip-success"><Icon name="check" />Checks passed</span> : <span className="chip chip-danger">{r.meta.errors} problem{r.meta.errors === 1 ? '' : 's'} to fix</span>}
              {notes > 0 && <span className="chip chip-warning">{notes} note{notes === 1 ? '' : 's'}</span>}
            </div>
            {placeholders > 0 && <p className="dim" style={{ fontSize: 'var(--text-sm)' }}>{placeholders} deployment settings, such as the tool server address, are filled in when the hosted service deploys it.</p>}
            {findings.length > 0 && (
              <ul className="lint-list">
                {findings.map((f, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <li key={i}><span className={`chip ${f.severity === 'error' ? 'chip-danger' : 'chip-warning'}`}>{f.severity === 'error' ? 'Problem' : 'Note'}</span><span>{LINT_WORDS[f.rule] ?? f.rule.replace(/_/g, ' ')}{f.where ? <span className="dim"> in {f.where}</span> : null}{f.excerpt ? <span className="mono dim">: {f.excerpt}</span> : null}</span></li>
                ))}
              </ul>
            )}
            <div>
              <p className="micro">How every call opens</p>
              <p className="quote" style={{ marginTop: 'var(--space-2)' }}>{r.first_message}</p>
            </div>
            <div>
              <p className="micro">The start of its instructions{r.prompt_truncated ? `, first ${r.prompt_preview.length.toLocaleString()} characters` : ''}</p>
              <pre className="prompt-pre" tabIndex={0} aria-label="Instructions preview" style={{ marginTop: 'var(--space-2)' }}>{r.prompt_preview}</pre>
            </div>
            <div>
              <p className="micro">Tools it can use</p>
              <div className="row" style={{ marginTop: 'var(--space-2)' }}>{r.tools.map((t) => <span key={t} className="chip chip-mono">{t}</span>)}</div>
            </div>
            <details className="pv-details">
              <summary>Details</summary>
              <p className="micro mono tnum" style={{ marginTop: 'var(--space-2)' }}>About {r.meta.prompt_tokens_approx.toLocaleString()} tokens, compiler estimate</p>
            </details>
            <Banner tone="info">Preview calls ring through the hosted service. This public build shows exactly what your concierge will be told and which tools it has.</Banner>
          </div>
        )}
      </div>
      <div className="q-actions">
        <span className="spacer" />
        <button type="button" className="btn btn-primary" disabled={!preview.passed} aria-describedby={preview.passed ? undefined : 'pv-gate'} onClick={onNext}>Continue to publish</button>
      </div>
      {!preview.passed && <p className="help dim" id="pv-gate" style={{ fontSize: 'var(--text-sm)' }}>Build a preview with no problems first. Then you can publish.</p>}
    </section>
  );
}

function PublishStep({ ctx, preview, publish, setPublish }) {
  const d = ctx.draft;
  const dlg = useRef(null);
  const [token, setToken] = useState(() => { try { return sessionStorage.getItem('bc-admin') ?? ''; } catch { return ''; } });
  const [id, setId] = useState('demo');
  const idOk = /^[a-z0-9-]{1,40}$/.test(id);
  const name = d.property.name?.trim() || 'your inn';
  const doPublish = async () => {
    dlg.current?.close();
    try { sessionStorage.setItem('bc-admin', token); } catch { /* storage blocked */ }
    setPublish({ state: 'loading' });
    const put = await api(`/properties/${id}`, { method: 'PUT', body: { config: cleanConfig(d) }, adminToken: token });
    if (!put.ok) { setPublish({ state: 'error', code: put.data?.error?.code, errors: put.data?.errors }); return; }
    const pub = await api(`/properties/${id}/publish`, { method: 'POST', adminToken: token });
    setPublish(pub.ok ? { state: 'done', data: pub.data, id } : { state: 'error', code: pub.data?.error?.code });
  };
  const errText = {
    writes_disabled: 'Saving is turned off on this public demo. The owner of a deployment sets an admin key to enable it.',
    unauthorized: 'That admin key did not match. Nothing was saved.',
    invalid_config: 'Some answers need a change. Nothing was saved.',
    lint_failed: 'The safety rules are incomplete. This is a bug on our side, nothing was published.',
  };
  return (
    <section aria-labelledby="pb-h" className="stack">
      <h2 id="pb-h" style={{ fontSize: 'var(--text-xl)' }}>Publish</h2>
      <p className="prose dim">On a public demo with no admin key, publishing is turned off. On your own copy, publishing does three things, in order:</p>
      <ol className="prose pub-rail" aria-label="What publishing does, in order">
        <li>Your card becomes a voice agent.</li>
        <li>The number answers.</li>
        <li>Calls show on your dashboard.</li>
      </ol>
      <fieldset className="fieldset">
        <legend>Who can reach it</legend>
        <div className="ladder">
          {[
            ['test', 'Test', 'Only you can reach it. Call it as much as you like.'],
            ['suggest', 'Suggest', 'Guests can call. It texts a plan only when a guest asks.'],
            ['live', 'Live', 'Guests call, and it offers the text after the first pick.'],
          ].map(([v, t, s]) => (
            <label key={v} className="rung">
              <input type="radio" name="trust" value={v} checked={d.trust_level === v} onChange={() => ctx.update('trust_level', v)} />
              <strong style={{ fontWeight: 600 }}>{t}</strong>
              <span className="dim" style={{ fontSize: 'var(--text-sm)' }}>{s}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Banner tone="info">Publishing is handled by the hosted service. Publishing here saves your concierge and marks it published; the hosted service then connects it to a phone line.</Banner>
      <div className="field-row">
        <div className="field">
          <label htmlFor="pid">Property id</label>
          <input id="pid" className="input" value={id} onChange={(e) => setId(e.target.value.toLowerCase())} aria-invalid={idOk ? undefined : 'true'} aria-describedby="pid-help" autoComplete="off" spellCheck={false} />
          <p className="help" id="pid-help">Lowercase letters, numbers, and dashes. Your dashboard lives at /property/{idOk ? id : '...'}.</p>
        </div>
        <div className="field">
          <label htmlFor="tok">Admin key</label>
          <input id="tok" className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="current-password" aria-describedby="tok-help" />
          <p className="help" id="tok-help">Set by whoever runs this server. Kept in this tab only.</p>
        </div>
      </div>
      <div className="q-actions">
        <span className="spacer" />
        <button type="button" className="btn btn-primary btn-lg" disabled={!preview.passed || !idOk || !token || publish.state === 'loading'}
          aria-describedby="pub-gate" onClick={() => dlg.current?.showModal()}>
          {publish.state === 'loading' ? 'Publishing' : 'Publish concierge'}
        </button>
      </div>
      <p className="help dim" id="pub-gate" style={{ fontSize: 'var(--text-sm)' }}>
        {!preview.passed ? 'Build a preview with no problems first.' : !token ? 'Enter the admin key to publish.' : 'You can pause it any time.'}
      </p>
      <div aria-live="polite">
        {publish.state === 'error' && (
          <Banner tone="danger">
            {errText[publish.code] ?? "We couldn't publish. Nothing changed and your answers are saved in this browser."}
            {publish.errors?.length > 0 && <ul style={{ marginTop: 'var(--space-2)', paddingLeft: 'var(--space-4)' }}>{publish.errors.map((e) => <li key={e} className="mono">{e}</li>)}</ul>}
          </Banner>
        )}
        {publish.state === 'done' && (
          <div className="card" style={{ marginTop: 'var(--space-3)' }}>
            <p className="row"><span className="chip chip-success"><Icon name="check" />Published</span><span className="micro mono">{new Date(publish.data.published_at).toLocaleString()}</span></p>
            <p style={{ marginTop: 'var(--space-2)' }}>
              {publish.data.webhook === 'sent' ? 'The hosted service was notified and will connect the line.' : publish.data.webhook === 'failed' ? "Saved and marked published, but the hosted service didn't confirm. It will retry when the owner republishes." : 'Saved and marked published on this server.'}
            </p>
            <p style={{ marginTop: 'var(--space-3)' }}><Link to={`/property/${publish.id}`} className="btn btn-secondary">Open the dashboard</Link></p>
          </div>
        )}
      </div>
      <dialog ref={dlg} className="sheet" aria-labelledby="dlg-h">
        <h2 id="dlg-h" style={{ fontSize: 'var(--text-lg)' }}>Publish {name}?</h2>
        <p style={{ marginTop: 'var(--space-3)' }}>Guests who call this number will reach your concierge. You can pause it any time.</p>
        <div className="row" style={{ marginTop: 'var(--space-6)', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-quiet" onClick={() => dlg.current?.close()}>Not yet</button>
          <button type="button" className="btn btn-primary" onClick={doPublish}>Publish concierge</button>
        </div>
      </dialog>
    </section>
  );
}

// ---- page ------------------------------------------------------------------------------------

export default function Builder() {
  const saved = useMemo(loadSaved, []);
  const [draft, setDraft] = useState(saved?.draft ?? blankConfig());
  const [prov, setProv] = useState(saved?.prov ?? DEFAULT_PROV);
  const [step, setStep] = useState(saved?.step ?? 'interview');
  const [q, setQ] = useState(saved?.q ?? 0);
  const [sampleState, setSampleState] = useState('idle');
  const [preview, setPreview] = useState({ state: 'idle', result: null, passed: false });
  const [publish, setPublish] = useState({ state: 'idle' });
  const [errors, setErrors] = useState({});
  const [cardOpen, setCardOpen] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ draft, prov, step, q })); } catch { /* storage blocked */ }
  }, [draft, prov, step, q]);

  const update = useCallback((path, value) => {
    setDraft((d) => setPath(d, path, value));
    setProv((p) => ({ ...p, [path.replace(/\.\d+.*$/, '')]: 'typed', [path]: 'typed' }));
    setPreview((p) => (p.passed ? { ...p, passed: false, stale: true } : p));
  }, []);

  const kind = draft.property?.kind === 'rental' ? 'rental' : 'inn';
  const loadSample = async () => {
    setSampleState('loading');
    const [id, label] = SAMPLES[kind];
    const r = await api(`/properties/${id}`);
    if (!r.ok) { setSampleState('error'); return; }
    // Fields the sample leaves out (an inn has no stay sheet) come back blank, so every input stays controlled.
    const blank = blankConfig();
    setDraft({ ...r.data.config, property: { ...r.data.config.property, kind }, stay: { ...blank.stay, ...(r.data.config.stay ?? {}) } });
    setProv(Object.fromEntries([...leafPaths(r.data.config), 'picks', 'avoid', 'faq', 'rules.list', 'rules.never_bend', 'handoff.triggers'].map((k) => [k, 'sample'])));
    setSampleState('idle');
    setErrors({});
    setToast(`Loaded ${label}. Change anything you like.`);
    setQ(1);
  };
  const startBlank = () => { const b = blankConfig(); b.property.kind = kind; b.voice.persona_id = kind === 'rental' ? 'marisol' : 'harper'; setDraft(b); setProv(DEFAULT_PROV); setErrors({}); setQ(1); };
  /** Inn or rental, chosen first: the persona follows, so the preview never pairs a rental with an inn voice. */
  const setKind = (next) => {
    if (next === kind) return;
    update('property.kind', next);
    update('voice.persona_id', next === 'rental' ? 'marisol' : 'harper');
  };

  const runPreview = async () => {
    setPreview((p) => ({ ...p, state: 'loading' }));
    const r = await api('/properties/demo/compile', { method: 'POST', body: { config: cleanConfig(draft), persona: draft.voice.persona_id } });
    if (r.status === 0 || r.status >= 500) { setPreview({ state: 'neterror', result: null, passed: false }); return; }
    setErrors(parseErrors(r.data?.errors));
    setPreview({ state: 'done', result: r.data, passed: Boolean(r.ok && r.data.meta?.errors === 0) });
  };

  const goTo = (own) => {
    if (own.q !== undefined) { setStep('interview'); setQ(own.q); } else setStep(own.step);
    setCardOpen(false);
  };
  const ctx = { draft, update, errors, loadSample, startBlank, sampleState, setKind };
  const { ready, total } = readiness(draft);

  return (
    <div className="container">
      <div className="stack-sm" style={{ marginBottom: 'var(--space-6)' }}>
        <p className="micro">Build your concierge</p>
        <h1 style={{ fontSize: 'var(--text-2xl)', letterSpacing: 'var(--tracking-display)' }}>Eleven questions, then a preview.</h1>
        <p className="lead">Your answers fill the card as you go. Nothing goes live until you preview it and press Publish.</p>
      </div>
      <nav aria-label="Builder steps">
        <ol className="stepper">
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <button type="button" aria-current={step === s.id ? 'step' : undefined} onClick={() => setStep(s.id)}>
                <span className="n">{i + 1}</span>{s.label}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div className={`builder${step === 'interview' ? '' : ' wide'}`}>
        <div>
          {step === 'interview' && <Interview ctx={ctx} q={q} setQ={setQ} onDone={() => setStep('guardrails')} />}
          {step === 'guardrails' && <Guardrails ctx={ctx} onNext={() => setStep('persona')} />}
          {step === 'persona' && <PersonaStep ctx={ctx} onNext={() => setStep('preview')} />}
          {step === 'preview' && <PreviewStep ctx={ctx} preview={preview} runPreview={runPreview} onNext={() => setStep('publish')} goTo={goTo} />}
          {step === 'publish' && <PublishStep ctx={ctx} preview={preview} publish={publish} setPublish={setPublish} />}
        </div>
        <aside className="builder-aside" aria-label="Your config card">
          <button type="button" className="btn btn-quiet btn-block card-toggle" aria-expanded={cardOpen} aria-controls="cfg-wrap" onClick={() => setCardOpen((o) => !o)}>
            Your card, <span className="tnum">{ready} of {total}</span> sections ready <Icon name="chev" />
          </button>
          <div id="cfg-wrap" className={`cfg-wrap${cardOpen ? ' open' : ''}`}>
            <ConfigCard draft={draft} prov={prov} onJump={(row) => goTo(row.step ? { step: row.step } : { q: row.q })} />
          </div>
        </aside>
      </div>
      <Toast message={toast} onDone={() => setToast('')} />
    </div>
  );
}

export { MASK };
