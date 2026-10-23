// Where stay_info finds a property's stay sheet: the property's own config.
//
// The dashboard database holds every config the builder saved (server/api/db.js, `properties`),
// so an edit to the sheet is answered on the next call, with no new agent to publish. Without a
// database (a tools-only server, the tests) the example configs in config/examples/ stand in,
// keyed by their property.id. Nothing here reaches the network.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const EXAMPLES_DIR = fileURLToPath(new URL('../../config/examples/', import.meta.url));

/**
 * @param {{ db?: import('better-sqlite3').Database | null, dir?: string }} [opts]
 * @returns {(propertyId: string) => any | null}  the property's config, or null
 */
export function stayLookup({ db = null, dir = EXAMPLES_DIR } = {}) {
  /** @type {Map<string, any> | null} */
  let examples = null;
  const fromExamples = (id) => {
    if (!examples) {
      examples = new Map();
      let files = [];
      try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { /* no examples */ }
      for (const f of files) {
        try {
          const c = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
          if (typeof c?.property?.id === 'string') examples.set(c.property.id, c);
        } catch { /* a broken example answers nothing */ }
      }
    }
    return examples.get(id) ?? null;
  };
  return (id) => {
    if (db) {
      try {
        const row = db.prepare('SELECT config_json FROM properties WHERE id = ?').get(id);
        if (row) return JSON.parse(row.config_json);
      } catch { /* fall back to the examples */ }
    }
    return fromExamples(id);
  };
}
