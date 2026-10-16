// `/privacy`: what a call sends, what the server keeps, and how the text works. Every line
// here matches the code: server/lib/pii-guard.js (what reaches Qloo), server/lib/ticketmaster.js
// (what reaches Ticketmaster), server/lib/sessions.js (what is stored), server/tools/send-sms.js
// (who gets a text, and how often), and SESSION_GATE in server/api/routes.js (the five-call floor).
import { Link } from '../router.jsx';
import '../legal.css';

export const EFFECTIVE = 'October 16, 2026';
export const SITE = 'https://southernsky.cloud';

export default function Privacy() {
  return (
    <article className="container legal" aria-labelledby="legal-title">
      <header className="legal-head">
        <p className="legal-eyebrow">Bellhop Concierge</p>
        <h1 id="legal-title">Privacy</h1>
        <p className="legal-meta">Effective {EFFECTIVE}</p>
      </header>

      <p className="legal-lead">
        We keep what the dashboard needs to count and rank tastes, and nothing that says who you
        are. Here is the whole of it.
      </p>

      <section className="legal-sec" aria-labelledby="p-call">
        <h2 id="p-call">When you call</h2>
        <ul>
          <li>The concierge says it is automated and that the call is recorded, in its first sentence.</li>
          <li>The call runs on ElevenLabs' voice platform, which records it. This server never stores a transcript or a recording.</li>
          <li>The demo inn, The Juniper House, is fictional. The calls to it are real.</li>
        </ul>
      </section>

      <section className="legal-sec" aria-labelledby="p-qloo">
        <h2 id="p-qloo">What a call sends to Qloo</h2>
        <p>
          Taste ids, tags, the inn's coordinates, a search radius, and filters such as a kind of
          place. The one free-text field is the taste you named, capped at 80 characters.
        </p>
        <p>
          Never your name, your phone number, or your room. Every outbound parameter is checked
          against an allowlist before it leaves the server, and a taste that contains an email
          address, a phone number, or a room number is refused. Ticketmaster gets a location, a
          date range, and a kind of event, nothing about you.
        </p>
      </section>

      <section className="legal-sec" aria-labelledby="p-kept">
        <h2 id="p-kept">What we keep</h2>
        <ul>
          <li>A keyed hash of the number that called, so repeat callers can be counted. Not the number itself.</li>
          <li>The tastes you named and the taste ids they resolved to.</li>
          <li>How many picks and events came back, and whether a text went out.</li>
          <li>A record of each request the call made to Qloo or Ticketmaster, so the dashboard can show where every pick came from. It never holds a number, a name, or a message.</li>
        </ul>
        <p>No names. No transcripts. No message bodies.</p>
      </section>

      <section className="legal-sec" aria-labelledby="p-sms">
        <h2 id="p-sms">The text message</h2>
        <ul>
          <li>The concierge offers to text you the plan. If you say yes, it sends one text, to the number you are calling from. It cannot text any other number.</li>
          <li>One text per call, and at most three texts to one number in an hour.</li>
          <li>Reply STOP to any text and the carrier stops them. Message and data rates may apply.</li>
          <li>Texts are sent through Twilio. Your number is used only to deliver the text you asked for.</li>
        </ul>
        <p className="legal-key">Mobile numbers and consent are never sold, shared, or transferred to third parties for marketing.</p>
      </section>

      <section className="legal-sec" aria-labelledby="p-dash">
        <h2 id="p-dash">The innkeeper dashboard</h2>
        <p>
          The innkeeper sees totals and rankings: which tastes came up, how many calls, how many
          texts. Never a caller's number or name. Until an inn has five calls, the guest panels stay
          dark, so one guest can't be picked out of a short list. Anything shown before then is a
          labeled sample.
        </p>
      </section>

      <section className="legal-sec" aria-labelledby="p-contact">
        <h2 id="p-contact">Questions</h2>
        <p>
          Reach SouthernSky at <a href={SITE} rel="noopener">southernsky.cloud</a>.
          The <Link to="/terms">terms</Link> cover the demo line and the code.
        </p>
      </section>
    </article>
  );
}
