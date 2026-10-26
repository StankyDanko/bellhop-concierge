// Returning-guest memory (better-sqlite3), in its own file that the dashboard is never handed.
//
// What a caller told the concierge on one call, kept for a few days so the next call from the
// same number can pick up where it left off: the first name they gave, how many times that
// person has called, whether they already heard that every call is recorded, the tastes that
// resolved, the places that were suggested and texted, the party and stay length, and which
// opening lines were already heard. Expiry rolls from the last call, so a guest who keeps
// calling through a trip is never dropped in the middle of it.
//
// Keyed by a second keyed hash of the caller's number with its own secret (GUEST_MEMORY_SECRET)
// and a domain prefix, so a memory row and a session-log row can never be joined by hash, even
// if both files were read together. The number itself is never written down.
//
// Two tables:
//   guest_memory  one row per caller per inn, expires (see expiresAt)
//   call_links    one row per live call: which caller a conversation id belongs to and what
//                 this call has resolved, offered, composed, and texted so far. Created by the
//                 initiation webhook, committed into guest_memory by log_session or, for a call
//                 that hung up first, by the sweep.
//
// Nothing here is read by anything under server/api/ (a test enforces it).

import Database from 'better-sqlite3';
import { createHash, createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { localParts } from '../conversation/choose.js';
import { toGsm } from './sms.js';

/** Days a memory lasts after the last call when no stay length is known. */
export const TTL_DEFAULT_DAYS = 7;
/** A stated stay is clamped to 1..STAY_MAX_NIGHTS nights; memory lasts the stay plus one day. */
export const STAY_MAX_NIGHTS = 14;
/** No row ever expires more than this many days after its last call. */
export const TTL_CEILING_DAYS = 14;
/** A row older than this from its first call is gone, even if the guest keeps calling. */
export const ABSOLUTE_LIFE_DAYS = 30;
export const MAX_TASTES = 12;
export const MAX_COMPANION = 4;
/** Also the cap on ids sent in filter.exclude.entities. */
export const MAX_TEXTED = 15;
/** Ids offered on earlier calls that stay excluded from a returning guest's next picks. */
export const MAX_OFFERED_IDS = 30;
export const WORDS_MAX = 40;
export const MEMORY_LINE_MAX = 120;
/** All JSON columns of one row together; a bigger write drops the oldest entries first. */
export const ROW_JSON_MAX = 4096;
export const MAX_ROWS = 5000;
export const LINK_TTL_MIN = 60;
export const MAX_LINKS = 2000;
/** Total interest signals on one place request: the call's own first, remembered ones after. */
export const MAX_SIGNALS = 12;
/** Compositions kept per call, so a send can match an earlier one. */
const COMPOSITIONS_KEEP = 4;
/** Variety ids remembered per kind (opener, pair). */
const VARIETY_KEEP = 2;
/** What forget_guest says, whether or not anything was stored. */
export const FORGET_SAY = "Done. I've cleared what I remembered from your calls.";

const DAY_MS = 86_400_000;
const CALLER = /^\+?[0-9]{5,16}$/;
const SESSION_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /(\+?\d[\s().-]?){7,}/;
const ROOM = /\b(room|rm|suite|unit|apt)\s*#?\s*\d+/i;

export const MEMORY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS guest_memory (
    caller_hash    TEXT NOT NULL,
    property_id    TEXT NOT NULL,
    tastes_json    TEXT NOT NULL DEFAULT '[]',
    texted_json    TEXT NOT NULL DEFAULT '[]',
    party_json     TEXT NOT NULL DEFAULT '{}',
    variety_json   TEXT NOT NULL DEFAULT '{}',
    guest_json     TEXT NOT NULL DEFAULT '{}',
    calls_count    INTEGER NOT NULL DEFAULT 0,
    first_call_at  TEXT NOT NULL,
    last_call_at   TEXT NOT NULL,
    last_call_day  TEXT NOT NULL,
    expires_at     TEXT NOT NULL,
    PRIMARY KEY (caller_hash, property_id)
  );
  CREATE INDEX IF NOT EXISTS guest_memory_expires ON guest_memory (expires_at);
  CREATE TABLE IF NOT EXISTS call_links (
    session_id    TEXT PRIMARY KEY,
    caller_hash   TEXT NOT NULL,
    property_id   TEXT NOT NULL,
    persona       TEXT,
    scratch_json  TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS call_links_expires ON call_links (expires_at);
  CREATE INDEX IF NOT EXISTS call_links_caller ON call_links (caller_hash);
`;

/** Columns added after the first schema, with their definitions, for a file created before them. */
const ADDED_COLUMNS = Object.freeze([['guest_memory', 'guest_json', "TEXT NOT NULL DEFAULT '{}'"]]);
/** Longest first name kept, in characters. */
export const NAME_MAX = 24;
/** Places and tastes kept from the last call for the next call's one callback. */
export const LAST_KEEP = 3;
/** Longest last_call_hook, in characters. */
export const HOOK_MAX = 110;

/** The caller number, or null when withheld, unfilled ({{system__caller_id}}), or malformed. */
export function callerFrom(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return CALLER.test(t) ? t : null;
}

/** A conversation id usable as a link key, or null. */
export function sessionFrom(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && !/^\{\{.*\}\}$/.test(t) && SESSION_ID.test(t) ? t : null;
}

/**
 * The memory key: HMAC(secret, 'memory.v1:' + number). Its own secret and a domain prefix,
 * so it never equals the session log's caller_hash.
 * @param {string} callerId @param {string} secret
 */
export function memoryKey(callerId, secret) {
  if (!secret) throw new Error('memoryKey needs a secret');
  return createHmac('sha256', secret).update(`memory.v1:${callerId}`, 'utf8').digest('hex');
}

/**
 * A guest's words, safe to read back into a prompt on a later call: letters, digits, spaces,
 * apostrophes, ampersands and periods only, WORDS_MAX characters, and nothing shaped like an
 * email, phone, or room number. Empty string when nothing is left.
 * @param {unknown} s
 */
export function cleanWords(s) {
  if (typeof s !== 'string') return '';
  if (EMAIL.test(s) || PHONE.test(s) || ROOM.test(s)) return '';
  return s.normalize('NFKC').replace(/[^\p{L}\p{N} '&.]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, WORDS_MAX).trim();
}

/**
 * When a memory row expires: TTL_DEFAULT_DAYS after the last call, or the stated stay plus one
 * day (shorter is allowed), never more than TTL_CEILING_DAYS after the last call and never more
 * than ABSOLUTE_LIFE_DAYS after the first.
 * @param {Date} lastCall @param {Date} firstCall @param {number|null|undefined} nights
 * @param {number} [ttlDays]
 */
export function expiresAt(lastCall, firstCall, nights, ttlDays = TTL_DEFAULT_DAYS) {
  const n = Number.isFinite(nights) && nights > 0 ? Math.min(STAY_MAX_NIGHTS, Math.max(1, Math.round(nights))) : null;
  const days = Math.min(TTL_CEILING_DAYS, n === null ? ttlDays : n + 1);
  const t = Math.min(lastCall.getTime() + days * DAY_MS, firstCall.getTime() + ABSOLUTE_LIFE_DAYS * DAY_MS);
  return new Date(t);
}

/**
 * A first name the guest said, safe to speak back on a later call: letters, apostrophes and
 * spaces only, at most two words and NAME_MAX characters. Empty string when nothing is left, so
 * a stray phrase, a number, or anything shaped like an instruction never becomes a name.
 * @param {unknown} s
 */
export function cleanName(s) {
  if (typeof s !== 'string') return '';
  const t = s.normalize('NFKC').replace(/[^\p{L}' ]/gu, ' ').replace(/\s+/g, ' ').trim();
  const words = t.split(' ').filter(Boolean);
  if (!words.length || words.length > 2 || t.length > NAME_MAX) return '';
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Longest remembered place, in characters. */
export const PLACE_MAX = 48;
/**
 * The town a guest was in, as the geocoder named it ("Macon, Georgia"): letters, digits, spaces
 * and a few marks only, so nothing shaped like an instruction or a street address is kept.
 * Empty string when nothing is left.
 * @param {unknown} s
 */
export function cleanPlace(s) {
  if (typeof s !== 'string') return '';
  const t = s.normalize('NFKC').replace(/[^\p{L}\p{N}',.\- ]/gu, ' ').replace(/\s+/g, ' ').trim();
  return t.length && t.length <= PLACE_MAX && /\p{L}/u.test(t) ? t : '';
}

const andList = (items) => (items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`);

/** What each kind of pick is, and what a guest does with it, for the callback line. */
const KIND_PHRASE = Object.freeze({
  movie: 'a film to watch', tv_show: 'a show to watch', book: 'a book to read', place: 'a place to go',
  artist: 'an artist to listen to', podcast: 'a podcast to listen to', event: 'an event to catch',
});
/** Kinds of pick kept with a remembered name; anything else is dropped rather than guessed. */
export const PICK_KINDS = Object.freeze(Object.keys(KIND_PHRASE));
const kindOf = (k) => (typeof k === 'string' && Object.hasOwn(KIND_PHRASE, k) ? k : null);

/**
 * ONE thing from the last call for the concierge to ask about, written as a fact about that
 * call, never as a line to read out: the first thing texted, else the first thing suggested,
 * else the first thing the guest talked about. A pick carries its kind and what a guest does
 * with it ("a film to watch", "a place to go"), so the callback can use the right verb: three
 * films are never asked about as if they were places. 'none' when the last call left nothing.
 * @param {{ texted?: string[], offered?: string[], tastes?: string[], kind?: string|null }} [last]
 */
export function lastCallHook(last = {}) {
  const fit = (lead, name, kind) => {
    const words = cleanWords(name);
    if (!words) return '';
    const phrase = kind ? KIND_PHRASE[kind] : null;
    for (const line of [phrase ? `${lead} ${words}, ${phrase}` : '', `${lead} ${words}`]) {
      if (line && line.length <= HOOK_MAX) return line;
    }
    return '';
  };
  const kind = kindOf(last?.kind);
  return fit('you texted them', last?.texted?.[0], kind) || fit('you suggested', last?.offered?.[0], last?.texted?.[0] ? null : kind)
    || fit('they talked about', last?.tastes?.[0], null) || 'none';
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty'];
/** Numbers as words for spoken lines (0..39 is all this file needs). */
export function numberWords(n) {
  if (!Number.isInteger(n) || n < 0 || n >= 40) return String(n);
  if (n < 20) return ONES[n];
  return n % 10 ? `${TENS[Math.floor(n / 10)]} ${ONES[n % 10]}` : TENS[n / 10];
}

/** "two of you, three nights, kids along", or 'none'. */
export function stayLine(party = {}) {
  const parts = [];
  if (Number.isInteger(party.party_size)) parts.push(party.party_size === 1 ? 'just you' : `${numberWords(party.party_size)} of you`);
  if (Number.isInteger(party.nights)) parts.push(party.nights === 1 ? 'one night' : `${numberWords(party.nights)} nights`);
  if (party.kids === true) parts.push('kids along');
  return parts.length ? parts.join(', ') : 'none';
}

/** Remembered tastes in the guest's words, guest's before companion's, at most MEMORY_LINE_MAX characters. */
export function memoryLine(tastes = []) {
  const words = [];
  for (const who of ['guest', 'companion']) {
    for (const t of tastes) if (t.who === who && t.words && !words.includes(t.words)) words.push(t.words);
  }
  let line = '';
  for (const w of words) {
    const next = line ? `${line}, ${w}` : w;
    if (next.length > MEMORY_LINE_MAX) break;
    line = next;
  }
  return line || 'none';
}

const parse = (s, fallback) => {
  try { const v = JSON.parse(s); return v ?? fallback; } catch { return fallback; }
};
const pushRecent = (list = [], id) => [...list.filter((x) => x !== id), id].slice(-VARIETY_KEEP);
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const isTag = (id) => String(id).startsWith('urn:tag:');

/** Keep tastes within MAX_TASTES (MAX_COMPANION of them companion's), least recently named dropped first. */
function capTastes(tastes) {
  const byRecent = [...tastes].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const out = [];
  let companion = 0;
  for (const t of byRecent) {
    if (out.length >= MAX_TASTES) break;
    if (t.who === 'companion') { if (companion >= MAX_COMPANION) continue; companion += 1; }
    out.push(t);
  }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** Drop oldest entries until the JSON columns fit ROW_JSON_MAX. Mutates and returns the row parts. */
function fitRow(parts) {
  const size = () => JSON.stringify(parts.tastes).length + JSON.stringify(parts.texted).length
    + JSON.stringify(parts.party).length + JSON.stringify(parts.variety).length;
  while (size() > ROW_JSON_MAX && (parts.tastes.length || parts.texted.length)) {
    const oldestTaste = parts.tastes[0]?.at ?? '￿';
    const oldestText = parts.texted[0]?.at ?? '￿';
    if (parts.tastes.length && (oldestTaste <= oldestText || !parts.texted.length)) parts.tastes.shift();
    else parts.texted.shift();
  }
  return parts;
}

/** The guest column, with only known fields and their caps. */
function guestPart(g = {}) {
  const out = {};
  const name = cleanName(g.name);
  if (name) out.name = name;
  if (Number.isInteger(g.person_calls) && g.person_calls > 0) out.person_calls = g.person_calls;
  if (g.recording_noted === true) out.recording_noted = true;
  if (Array.isArray(g.offered_ids)) {
    const ids = g.offered_ids.filter((x) => typeof x === 'string' && x.length <= 80).slice(-MAX_OFFERED_IDS);
    if (ids.length) out.offered_ids = ids;
  }
  const place = cleanPlace(g.place);
  if (place) out.place = place;
  if (g.last && typeof g.last === 'object') {
    const keep = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string').map((x) => x.slice(0, 120)).slice(0, LAST_KEEP) : []);
    out.last = { texted: keep(g.last.texted), offered: keep(g.last.offered), tastes: keep(g.last.tastes) };
    const kind = kindOf(g.last.kind);
    if (kind) out.last.kind = kind;
  }
  return out;
}

export class GuestMemory {
  /**
   * @param {{ path: string, secret: string, now?: () => Date, ttlDays?: number, logger?: (o: object) => void }} opts
   */
  constructor({ path, secret, now = () => new Date(), ttlDays = TTL_DEFAULT_DAYS, logger = () => {} }) {
    if (!secret) throw new Error('GuestMemory needs its own secret');
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.secret = secret;
    this.now = now;
    this.ttlDays = ttlDays;
    this.logger = logger;
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(MEMORY_SCHEMA);
    for (const [table, column, def] of ADDED_COLUMNS) {
      const has = this.db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
      if (!has) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
    }
  }

  /** @param {string|null} callerId */
  keyFor(callerId) {
    const c = callerFrom(callerId);
    return c ? memoryKey(c, this.secret) : null;
  }

  // ---- rows ----------------------------------------------------------------

  /** A live (unexpired) memory row, parsed, or null. */
  read(hash, propertyId) {
    if (!hash || !propertyId) return null;
    const r = this.db.prepare('SELECT * FROM guest_memory WHERE caller_hash = ? AND property_id = ? AND expires_at > ?')
      .get(hash, propertyId, this.now().toISOString());
    if (!r) return null;
    return { ...r, tastes: parse(r.tastes_json, []), texted: parse(r.texted_json, []), party: parse(r.party_json, {}), variety: parse(r.variety_json, {}),
      guest: parse(r.guest_json, {}) };
  }

  /** @param {any} row the parsed row with tastes, texted, party, variety, guest */
  writeRow(row) {
    const parts = fitRow({ tastes: capTastes(row.tastes ?? []), texted: (row.texted ?? []).slice(-MAX_TEXTED), party: row.party ?? {}, variety: row.variety ?? {} });
    const guest = row.guest ?? {};
    const expires = expiresAt(new Date(row.last_call_at), new Date(row.first_call_at), parts.party.nights, this.ttlDays);
    this.db.prepare(`
      INSERT INTO guest_memory (caller_hash, property_id, tastes_json, texted_json, party_json, variety_json, guest_json, calls_count, first_call_at, last_call_at, last_call_day, expires_at)
      VALUES (@caller_hash, @property_id, @tastes_json, @texted_json, @party_json, @variety_json, @guest_json, @calls_count, @first_call_at, @last_call_at, @last_call_day, @expires_at)
      ON CONFLICT(caller_hash, property_id) DO UPDATE SET tastes_json = excluded.tastes_json, texted_json = excluded.texted_json,
        party_json = excluded.party_json, variety_json = excluded.variety_json, guest_json = excluded.guest_json, calls_count = excluded.calls_count,
        first_call_at = excluded.first_call_at, last_call_at = excluded.last_call_at, last_call_day = excluded.last_call_day,
        expires_at = excluded.expires_at
    `).run({
      caller_hash: row.caller_hash, property_id: row.property_id,
      tastes_json: JSON.stringify(parts.tastes), texted_json: JSON.stringify(parts.texted),
      party_json: JSON.stringify(parts.party), variety_json: JSON.stringify(parts.variety), guest_json: JSON.stringify(guestPart(guest)),
      calls_count: row.calls_count ?? 0, first_call_at: row.first_call_at, last_call_at: row.last_call_at,
      last_call_day: row.last_call_day, expires_at: expires.toISOString(),
    });
  }

  /**
   * The initiation webhook's write: link this conversation to the caller and record the call
   * (variety ids heard, count, last-call time) without any guest data, so a second call varies
   * even if the first hung up before log_session. An expired row is replaced, never revived.
   * @param {{ hash: string, sessionId: string|null, propertyId: string, persona?: string, timezone?: string,
   *           variety: { opener: string, pair: string } }} a
   */
  startCall({ hash, sessionId, propertyId, persona = null, timezone, variety }) {
    const now = this.now();
    const iso = now.toISOString();
    const tx = this.db.transaction(() => {
      const live = this.read(hash, propertyId);
      if (!live) this.db.prepare('DELETE FROM guest_memory WHERE caller_hash = ? AND property_id = ?').run(hash, propertyId);
      const row = live ?? { caller_hash: hash, property_id: propertyId, tastes: [], texted: [], party: {}, variety: {}, guest: {}, calls_count: 0, first_call_at: iso };
      const v = row.variety ?? {};
      const g = row.guest ?? {};
      this.writeRow({
        ...row,
        variety: { opener: pushRecent(v.opener, variety.opener), pair: pushRecent(v.pair, variety.pair) },
        // Counted as the same person until the call says otherwise (remember_guest, same_guest false).
        guest: { ...g, person_calls: (g.person_calls ?? 0) + 1 },
        calls_count: (row.calls_count ?? 0) + 1,
        last_call_at: iso,
        last_call_day: localParts(now, timezone).day,
      });
      if (sessionId) {
        this.db.prepare(`INSERT INTO call_links (session_id, caller_hash, property_id, persona, scratch_json, created_at, expires_at)
          VALUES (?, ?, ?, ?, '{}', ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET caller_hash = excluded.caller_hash, property_id = excluded.property_id,
            persona = excluded.persona, scratch_json = '{}', created_at = excluded.created_at, expires_at = excluded.expires_at`)
          .run(sessionId, hash, propertyId, persona, iso, new Date(now.getTime() + LINK_TTL_MIN * 60_000).toISOString());
      }
    });
    tx();
    this.enforceCaps();
  }

  // ---- links ---------------------------------------------------------------

  /** The live link for a conversation, with its scratch parsed, or null. */
  link(sessionId) {
    const sid = sessionFrom(sessionId);
    if (!sid) return null;
    const r = this.db.prepare('SELECT * FROM call_links WHERE session_id = ? AND expires_at > ?').get(sid, this.now().toISOString());
    return r ? { ...r, scratch: parse(r.scratch_json, {}) } : null;
  }

  /** Apply fn to a live, unforgotten link's scratch. No link, no write. */
  updateScratch(sessionId, fn) {
    const l = this.link(sessionId);
    if (!l || l.scratch.forgotten) return false;
    const next = fn({ ...l.scratch });
    this.db.prepare('UPDATE call_links SET scratch_json = ? WHERE session_id = ?').run(JSON.stringify(next), l.session_id);
    return true;
  }

  /** resolve_taste: keep only what resolved, in the guest's filtered words. */
  noteResolved(sessionId, items) {
    const at = this.now().toISOString();
    const add = (items ?? []).filter((r) => r && typeof r.id === 'string' && r.id)
      .map((r) => ({ id: r.id, words: cleanWords(r.mention ?? r.name), who: r.who === 'companion' ? 'companion' : 'guest', at }))
      .filter((r) => r.words);
    if (!add.length) return false;
    return this.updateScratch(sessionId, (s) => {
      const resolved = (s.resolved ?? []).filter((r) => !add.some((x) => x.id === r.id && x.who === r.who));
      return { ...s, resolved: [...resolved, ...add].slice(-(MAX_TASTES * 2)) };
    });
  }

  /** recommend_nearby / cross_domain: what this call was offered, by name, so a texted pick maps back to an id. */
  noteOffered(sessionId, items, party, defaultKind = null) {
    const add = (items ?? []).filter((p) => p && typeof p.entity_id === 'string' && typeof p.name === 'string')
      .map((p) => ({ id: p.entity_id, name: p.name.slice(0, 120), ...(kindOf(p.type ?? defaultKind) ? { kind: kindOf(p.type ?? defaultKind) } : {}) }));
    if (!add.length && !party) return false;
    return this.updateScratch(sessionId, (s) => {
      const offered = [...(s.offered ?? []).filter((o) => !add.some((x) => x.id === o.id)), ...add].slice(-40);
      const next = { ...s, offered };
      // The top of the latest answer, in rank order: what the guest most likely heard.
      if (add.length) { next.last_offered = add.slice(0, LAST_KEEP).map((o) => o.name); next.last_offered_kind = add[0].kind ?? null; }
      if (party) {
        const p = { ...(s.party ?? {}) };
        if (Number.isInteger(party.party_size)) p.party_size = party.party_size;
        if (party.kids === true) p.kids = true;
        next.party = p;
      }
      return next;
    });
  }

  /** compose_itinerary: which offered places went into the text, and a digest of the body to match a send against. */
  noteComposed(sessionId, pickNames, body) {
    if (typeof body !== 'string') return false;
    // Only picks whose name made it into the body: compose can drop a whole pick to fit 320.
    const inBody = (n) => typeof n === 'string' && n !== '' && (body.includes(n) || body.includes(toGsm(n)));
    return this.updateScratch(sessionId, (s) => {
      const offered = s.offered ?? [];
      const ids = [...new Set((pickNames ?? []).filter(inBody).map((n) => offered.find((o) => o.name === n)?.id).filter(Boolean))];
      const digest = sha256(body);
      // Every composition of this call (the last few), so the one actually sent is the one matched.
      const compositions = [...(s.compositions ?? []).filter((c) => c.digest !== digest), { digest, ids }].slice(-COMPOSITIONS_KEEP);
      return { ...s, composed: ids, body_digest: digest, compositions };
    });
  }

  /**
   * The server's own send_sms answered sent true: record, at send time, the ids of the places in
   * the itinerary that was sent. This is the only way a place becomes "texted"; the model-filled
   * sms_sent flag on log_session is never trusted for it. The link is the recipient's memory key
   * plus the body digest of what compose_itinerary built, narrowed to the call's own session id
   * when send_sms carried one.
   * @param {string} to @param {string} body @param {string} [sessionId]
   */
  noteTexted(to, body, sessionId) {
    const hash = this.keyFor(to);
    if (!hash || typeof body !== 'string') return false;
    const digest = sha256(body);
    const sid = sessionFrom(sessionId);
    const links = this.db.prepare('SELECT session_id, scratch_json FROM call_links WHERE caller_hash = ? AND expires_at > ?')
      .all(hash, this.now().toISOString());
    let marked = false;
    for (const l of links) {
      if (sid && l.session_id !== sid) continue;
      const s = parse(l.scratch_json, {});
      if (s.forgotten) continue;
      const sent = (s.compositions ?? []).find((c) => c.digest === digest)
        ?? (s.body_digest === digest ? { ids: s.composed ?? [] } : null);
      if (!sent) continue;
      const textedIds = [...new Set([...(s.texted_ids ?? []), ...sent.ids])];
      this.db.prepare('UPDATE call_links SET scratch_json = ? WHERE session_id = ?').run(JSON.stringify({ ...s, texted_ids: textedIds }), l.session_id);
      marked = true;
    }
    return marked;
  }

  /**
   * The town this call looked in, as the geocoder named it. Only a place a tool actually
   * searched is kept, never a word the model chose: the tools answer with the geocoder's label.
   */
  notePlace(sessionId, label) {
    const place = cleanPlace(label);
    if (!place) return false;
    return this.updateScratch(sessionId, (s) => ({ ...s, place }));
  }

  /**
   * Whether the person on this call already heard that every call is recorded. False when there
   * is no live link or no row: the safe answer is to say the note.
   */
  recordingNoted(sessionId) {
    const l = this.link(sessionId);
    if (!l || l.scratch.forgotten) return false;
    return this.read(l.caller_hash, l.property_id)?.guest?.recording_noted === true;
  }

  /**
   * remember_guest: who is on the phone. A first name is kept in the guest's filtered words. A
   * guest who says they are the person remembered on this phone confirms it; a guest who says
   * they are someone else makes this call fresh: nothing remembered reaches the tools for the
   * rest of the call, and the commit replaces the old person's row with this call alone.
   * @param {string} sessionId @param {{ firstName?: unknown, sameGuest?: unknown }} who
   * @returns {boolean} whether a live link took the note
   */
  noteGuest(sessionId, { firstName, sameGuest } = {}) {
    const name = cleanName(firstName);
    return this.updateScratch(sessionId, (s) => {
      const next = { ...s };
      if (name) next.name = name;
      if (sameGuest === true && !s.fresh) next.confirmed = true;
      if (sameGuest === false) { next.fresh = true; delete next.confirmed; }
      return next;
    });
  }

  /**
   * Fold a call's scratch into the caller's row. log_session calls this; the sweep calls it for
   * a call that ended without log_session. Skipped when the guest said forget me.
   * @param {string} sessionId @param {{ nights?: number|null }} [opts]
   */
  commit(sessionId, { nights = null } = {}) {
    const l = this.link(sessionId) ?? this.expiredLink(sessionId);
    if (!l || l.scratch.forgotten || l.scratch.committed) return false;
    const tx = this.db.transaction(() => {
      this.commitLink(l, { nights });
      this.db.prepare('UPDATE call_links SET scratch_json = ? WHERE session_id = ?').run(JSON.stringify({ ...l.scratch, committed: true }), l.session_id);
    });
    tx();
    return true;
  }

  /**
   * Fold what the call has so far into the caller's row, without closing the call. The tools call
   * this as things happen (a name, a town, an offer, a text) so a call that ends badly, or never
   * reaches log_session, still leaves the name and the place for the next call. Folding is
   * idempotent: it rebuilds from the call's scratch each time, so doing it again, or doing it
   * and then commit(), writes the same row and nothing doubles. Skipped when the guest said forget me.
   * @param {string} sessionId
   */
  checkpoint(sessionId) {
    const l = this.link(sessionId);
    if (!l || l.scratch.forgotten) return false;
    this.commitLink(l);
    return true;
  }

  expiredLink(sessionId) {
    const sid = sessionFrom(sessionId);
    if (!sid) return null;
    const r = this.db.prepare('SELECT * FROM call_links WHERE session_id = ?').get(sid);
    return r ? { ...r, scratch: parse(r.scratch_json, {}) } : null;
  }

  /** @param {any} l a link with parsed scratch */
  commitLink(l, { nights = null } = {}) {
    const row = this.read(l.caller_hash, l.property_id);
    if (!row) return; // the row expired or was forgotten since the call started: nothing to build on
    const s = l.scratch;
    const at = this.now().toISOString();
    // Someone else on a remembered phone: this call starts the row over, as that person's first.
    const base = s.fresh ? { ...row, tastes: [], texted: [], party: {}, guest: { person_calls: 1 } } : row;
    const tastes = [...base.tastes];
    for (const r of s.resolved ?? []) {
      const i = tastes.findIndex((t) => t.id === r.id && t.who === r.who);
      if (i >= 0) tastes.splice(i, 1);
      tastes.push({ ...r, at });
    }
    // Only what the server itself sent (noteTexted, at send time) counts as texted.
    let texted = [...base.texted];
    for (const id of s.texted_ids ?? []) {
      texted = texted.filter((t) => t.id !== id);
      texted.push({ id, at });
    }
    const party = { ...base.party, ...(s.party ?? {}) };
    if (Number.isFinite(nights) && nights > 0) party.nights = Math.min(STAY_MAX_NIGHTS, Math.max(1, Math.round(nights)));
    const guest = { ...base.guest };
    if (s.name) guest.name = s.name;
    else if (s.fresh) delete guest.name;
    // The guest confirmed who they are, so they heard this call's reminder that every call is recorded.
    if (s.confirmed) guest.recording_noted = true;
    // Everything this call offered stays out of the next calls' picks (a title said on three calls is a rut).
    const priorOffered = s.fresh ? [] : (Array.isArray(guest.offered_ids) ? guest.offered_ids : []);
    const offeredIds = [...priorOffered.filter((id) => !(s.offered ?? []).some((o) => o.id === id)), ...(s.offered ?? []).map((o) => o.id)];
    if (offeredIds.length) guest.offered_ids = offeredIds.slice(-MAX_OFFERED_IDS);
    // The town the guest was in: the last one this call searched, else the one remembered.
    if (s.place) guest.place = s.place;
    else if (s.fresh) delete guest.place;
    const byId = (id) => (s.offered ?? []).find((o) => o.id === id);
    const last = {
      texted: (s.texted_ids ?? []).map((id) => byId(id)?.name).filter(Boolean).slice(0, LAST_KEEP),
      offered: (s.last_offered ?? []).slice(0, LAST_KEEP),
      tastes: (s.resolved ?? []).filter((r) => r.who === 'guest').map((r) => r.words).slice(-LAST_KEEP),
    };
    // The kind of the one item the callback will name: the first thing texted, else the first suggested.
    const kind = last.texted.length ? (s.texted_ids ?? []).map((id) => byId(id)).find(Boolean)?.kind : s.last_offered_kind;
    if (kindOf(kind)) last.kind = kind;
    // A call that left nothing (a hang-up) keeps the callback from the call before it.
    if (last.texted.length || last.offered.length || last.tastes.length || s.fresh) guest.last = last;
    this.writeRow({ ...base, tastes, texted, party, guest });
  }

  // ---- read path for the tools ---------------------------------------------

  /**
   * What recommend_nearby folds in for this call: texted ids to exclude and remembered taste
   * ids to carry as signals. Null when the call has no live link (no webhook, withheld number,
   * forgotten), which leaves the tool exactly as it was.
   * @returns {{ texted: string[], offered: string[], guest: { entityIds: string[], tagIds: string[] }, companion: { entityIds: string[], tagIds: string[] } } | null}
   */
  recallFor(sessionId) {
    const l = this.link(sessionId);
    // A different person on a remembered phone gets nothing remembered, not even the exclusions.
    if (!l || l.scratch.forgotten || l.scratch.fresh) return null;
    const row = this.read(l.caller_hash, l.property_id);
    const split = (who) => {
      const ids = [...new Set((row?.tastes ?? []).filter((t) => t.who === who).map((t) => t.id))];
      return { entityIds: ids.filter((id) => !isTag(id)), tagIds: ids.filter(isTag) };
    };
    return { texted: [...new Set((row?.texted ?? []).map((t) => t.id))].slice(-MAX_TEXTED),
      // Earlier calls only: the row is also written as this call goes, and this call's own offers are its own business.
      offered: (row?.guest?.offered_ids ?? []).filter((id) => !(l.scratch.offered ?? []).some((o) => o.id === id)).slice(-MAX_OFFERED_IDS), guest: split('guest'), companion: split('companion') };
  }

  // ---- forget me -----------------------------------------------------------

  /**
   * Delete every memory row for this caller (every inn), and clear and mark forgotten every live
   * link for them so neither log_session nor the sweep writes anything back. Returns how many
   * rows went, for tests only: the tool answers the same either way.
   * @param {{ callerId?: string|null, sessionId?: string|null }} who
   */
  forget({ callerId = null, sessionId = null } = {}) {
    const hash = this.keyFor(callerId) ?? this.expiredLink(sessionId)?.caller_hash ?? null;
    if (!hash) return { rows: 0, links: 0 };
    let rows = 0;
    let links = 0;
    this.db.transaction(() => {
      rows = this.db.prepare('DELETE FROM guest_memory WHERE caller_hash = ?').run(hash).changes;
      links = this.db.prepare(`UPDATE call_links SET scratch_json = '{"forgotten":true}' WHERE caller_hash = ?`).run(hash).changes;
    })();
    return { rows, links };
  }

  /** For tests and the mock battery: rows plus unforgotten links held for a caller. */
  countFor(callerId) {
    const hash = this.keyFor(callerId);
    if (!hash) return 0;
    const rows = this.db.prepare('SELECT COUNT(*) AS n FROM guest_memory WHERE caller_hash = ?').get(hash).n;
    const links = this.db.prepare('SELECT scratch_json FROM call_links WHERE caller_hash = ?').all(hash)
      .filter((l) => !parse(l.scratch_json, {}).forgotten).length;
    return rows + links;
  }

  // ---- retention -------------------------------------------------------------

  /** Global row and link caps: least recent first. */
  enforceCaps() {
    this.db.prepare(`DELETE FROM guest_memory WHERE rowid IN (SELECT rowid FROM guest_memory ORDER BY last_call_at ASC
      LIMIT max(0, (SELECT COUNT(*) FROM guest_memory) - ${MAX_ROWS}))`).run();
    this.db.prepare(`DELETE FROM call_links WHERE rowid IN (SELECT rowid FROM call_links ORDER BY created_at ASC
      LIMIT max(0, (SELECT COUNT(*) FROM call_links) - ${MAX_LINKS}))`).run();
  }

  /**
   * Startup and every 15 minutes: commit each expired link that was neither committed nor
   * forgotten (a hang-up still counts), delete it, delete expired rows, enforce the caps.
   * @returns {{ committed: number, links: number, rows: number }}
   */
  sweep() {
    const now = this.now().toISOString();
    let committed = 0;
    const expired = this.db.prepare('SELECT * FROM call_links WHERE expires_at <= ?').all(now);
    for (const r of expired) {
      const l = { ...r, scratch: parse(r.scratch_json, {}) };
      if (!l.scratch.forgotten && !l.scratch.committed) {
        try { this.commitLink(l); committed += 1; } catch (err) { this.logger({ svc: 'memory', error: 'sweep_commit_failed', detail: String(err?.message ?? err) }); }
      }
    }
    const links = this.db.prepare('DELETE FROM call_links WHERE expires_at <= ?').run(now).changes;
    const rows = this.db.prepare('DELETE FROM guest_memory WHERE expires_at <= ?').run(now).changes;
    this.enforceCaps();
    return { committed, links, rows };
  }

  close() {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Tool-side glue, called by server/app.js after a tool answers. Best effort: memory never
// fails or changes a tool call.
// ---------------------------------------------------------------------------

/**
 * Record what a tool call means for this conversation's memory.
 * @param {GuestMemory|null|undefined} memory @param {string} tool @param {any} body @param {any} result
 */
export function observeTool(memory, tool, body, result) {
  if (!memory || !result) return;
  const sid = body?.session_id;
  // The geocoder's name for the town a place tool searched (lib/locality.js), never the model's words.
  if (typeof result.locality === 'string') memory.notePlace(sid, result.locality);
  switch (tool) {
    case 'resolve_taste':
      memory.noteResolved(sid, [...(result.resolved ?? []), ...(result.companion_resolved ?? []).map((r) => ({ ...r, who: 'companion' }))]);
      break;
    case 'recommend_nearby': {
      const a = result.applied ?? {};
      memory.noteOffered(sid, result.places, { party_size: Number.isInteger(a.party_size) ? a.party_size : undefined, kids: a.kids === true }, 'place');
      break;
    }
    case 'cross_domain':
      memory.noteOffered(sid, result.results);
      break;
    case 'compose_itinerary':
      memory.noteComposed(sid, (Array.isArray(body?.picks) ? body.picks : []).map((p) => p?.name), result.body);
      break;
    case 'send_sms':
      // A test-mode send (texting mocked) is the plan the guest was given by voice, so it is
      // remembered as texted too; it is never reported to the agent as sent (tools/send-sms.js).
      if (result.sent === true || result.test_mode === true) memory.noteTexted(body?.to, body?.body, body?.session_id);
      break;
    default:
  }
  // Fold the call so far into the row as it goes, so a call that never reaches log_session still
  // leaves the guest's name, town, and offered or texted places behind.
  if (CHECKPOINT_TOOLS.has(tool) || typeof result.locality === 'string') memory.checkpoint(sid);
}

/** Tools after which the call's memory is saved at once. */
const CHECKPOINT_TOOLS = new Set(['remember_guest', 'recommend_nearby', 'cross_domain', 'send_sms']);

/** Param keys that carry ids a tool added from memory. */
const SIGNAL_KEYS = ['signal.interests.entities', 'signal.interests.tags'];

/**
 * Strip memory-derived ids from a trace before it is returned or stored, so the dashboard's call
 * trace and the guest taste fingerprint never see a remembered id. The real request still
 * carried them, and still passed the PII guard. Mutates and returns the trace.
 * @param {Array<{ params?: Record<string,string> }>} trace
 * @param {{ ids?: string[], exclude?: boolean } | null | undefined} redact
 */
export function redactTrace(trace, redact) {
  if (!redact || !Array.isArray(trace)) return trace;
  const ids = new Set(redact.ids ?? []);
  for (const e of trace) {
    if (!e?.params) continue;
    if (redact.exclude) delete e.params['filter.exclude.entities'];
    for (const k of SIGNAL_KEYS) {
      if (typeof e.params[k] !== 'string' || !ids.size) continue;
      const kept = e.params[k].split(',').filter((id) => !ids.has(id));
      if (kept.length) e.params[k] = kept.join(',');
      else delete e.params[k];
    }
  }
  return trace;
}
