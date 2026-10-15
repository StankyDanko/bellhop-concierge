// Shared test fixture: a fresh copy of the demo config.
import { readFileSync } from 'node:fs';

export const demo = () => JSON.parse(readFileSync(new URL('../../config/examples/demo-inn.json', import.meta.url), 'utf8'));
