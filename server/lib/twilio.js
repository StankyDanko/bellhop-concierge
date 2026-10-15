// The ONE Twilio client: sends a text through the Messages REST API.
//
// It reports success only when Twilio answers 2xx with a message sid. Anything else is an
// UpstreamError, so the agent can never tell a guest "sent" on a failed send (the false
// "Sent" lesson). Credentials come from the environment and never reach a log line: the
// log records the message sid and Twilio's status, never the number or the body.
//
// SMS_MOCK=1 returns a fake sid without a network call. Validation still runs in mock mode.

import { randomBytes } from 'node:crypto';
import { UpstreamError } from './errors.js';

const API = 'https://api.twilio.com/2010-04-01';

/**
 * @typedef {object} SmsConfig
 * @property {boolean} mock
 * @property {string} accountSid
 * @property {string} apiKeySid      revocable API key pair (preferred)
 * @property {string} apiKeySecret
 * @property {string} authToken      account auth token (used only when no key pair is set)
 * @property {string} from           sending number, E.164
 * @property {number} timeoutMs
 */

/**
 * @typedef {{ mode: 'mock'|'live'|'disabled', send: (to: string, body: string) => Promise<{ sid: string, status: string, via: string }> }} SmsSender
 */

/**
 * @param {{ config: SmsConfig, logger: import('./log.js').Logger, fetchImpl?: typeof fetch }} p
 * @returns {SmsSender}
 */
export function createSmsSender({ config, logger, fetchImpl = fetch }) {
  if (config.mock) {
    return {
      mode: 'mock',
      async send() {
        const sid = `SMmock${randomBytes(13).toString('hex')}`;
        logger({ svc: 'sms', via: 'mock', sid, status: 'queued' });
        return { sid, status: 'queued', via: 'mock' };
      },
    };
  }
  const user = config.apiKeySid && config.apiKeySecret ? config.apiKeySid : config.accountSid;
  const pass = config.apiKeySid && config.apiKeySecret ? config.apiKeySecret : config.authToken;
  if (!config.accountSid || !user || !pass || !config.from) {
    return {
      mode: 'disabled',
      async send() {
        logger({ svc: 'sms', via: 'live', error: 'not_configured' });
        throw new UpstreamError('SMS sending is not configured', { service: 'twilio', code: 'not_configured' });
      },
    };
  }
  const auth = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  const url = `${API}/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`;
  return {
    mode: 'live',
    async send(to, body) {
      const started = Date.now();
      let res;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ To: to, From: config.from, Body: body }).toString(),
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch (err) {
        const code = err?.name === 'TimeoutError' ? 'timeout' : 'network';
        logger({ svc: 'sms', via: 'live', error: code, ms: Date.now() - started });
        throw new UpstreamError(`Twilio ${code}`, { service: 'twilio', code, retryable: false });
      }
      let json = null;
      try { json = await res.json(); } catch { /* not JSON */ }
      if (!res.ok || typeof json?.sid !== 'string') {
        logger({ svc: 'sms', via: 'live', error: 'send_failed', http: res.status, twilio_code: json?.code ?? null, ms: Date.now() - started });
        throw new UpstreamError(`Twilio refused the send (HTTP ${res.status})`, { service: 'twilio', code: 'send_failed', status: res.status });
      }
      logger({ svc: 'sms', via: 'live', sid: json.sid, status: json.status, http: res.status, ms: Date.now() - started });
      return { sid: json.sid, status: String(json.status ?? 'queued'), via: 'live' };
    },
  };
}
