// The picks this server has handed out, by pick_token, so the model can pass a pick back by its
// token alone. A tool-call argument the model writes costs output tokens and one that is cut off
// ends the call, so compose_itinerary takes a token and the server fills in the rest from what
// the tool itself returned. Memory only, bounded, and a token that is not here changes nothing:
// the pick is read from the fields the model sent, as before.

const MAX_PICKS = 600;
const KEPT = ['name', 'blurb', 'url', 'when_label', 'favors'];

export class PickBook {
  constructor(max = MAX_PICKS) {
    this.max = max;
    /** @type {Map<string, Record<string, string>>} */
    this.byToken = new Map();
  }

  /** Remember each signed item a tool returned. @param {any[]} items */
  note(items) {
    for (const it of Array.isArray(items) ? items : []) {
      const token = it?.pick_token;
      if (typeof token !== 'string' || !token || typeof it.name !== 'string') continue;
      const rec = {};
      for (const k of KEPT) if (typeof it[k] === 'string' && it[k] !== '') rec[k] = it[k];
      this.byToken.delete(token);
      this.byToken.set(token, rec);
      if (this.byToken.size > this.max) this.byToken.delete(this.byToken.keys().next().value);
    }
  }

  /** @param {unknown} token */
  get(token) {
    return typeof token === 'string' ? this.byToken.get(token) ?? null : null;
  }

  /**
   * Fill a pick that carries a known token from the tool's own record. Fields the model sent are kept as
   * sent (compose_itinerary still checks each claim against the token); the rest come from the tool.
   * @param {any} pick
   */
  fill(pick) {
    const rec = this.get(pick?.pick_token);
    return rec ? { ...rec, ...pick } : pick;
  }

  /** Every tool result that carries signed picks. @param {any} result */
  observe(result) {
    this.note(result?.places);
    this.note(result?.results);
    this.note(result?.events);
    this.note(result?.by_taste?.events);
  }
}
