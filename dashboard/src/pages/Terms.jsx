// `/terms`: the terms for the demo line and this site. Short on purpose: a hackathon entry,
// offered as is, with the text-message terms a carrier review looks for.
import { Link } from '../router.jsx';
import { EFFECTIVE, SITE } from './Privacy.jsx';
import '../legal.css';

export const BRIDGE = 'Bellhop Concierge is a product of SouthernSky, a service of E Brands, LLC.';

export default function Terms({ repo }) {
  return (
    <article className="container legal" aria-labelledby="legal-title">
      <header className="legal-head">
        <p className="legal-eyebrow">Bellhop Concierge</p>
        <h1 id="legal-title">Terms</h1>
        <p className="legal-meta">Effective {EFFECTIVE}</p>
      </header>

      <p className="legal-lead">{BRIDGE} This site and its phone line are a demo of a hackathon entry.</p>

      <section className="legal-sec" aria-labelledby="t-demo">
        <h2 id="t-demo">What this is</h2>
        <ul>
          <li>A working demo. The inn on the demo line, The Juniper House, is fictional.</li>
          <li>The demo number is a test line, capped at twenty calls a day.</li>
          <li>It is offered as is, with no warranty of any kind. It may be slow, down, or changed without notice.</li>
        </ul>
      </section>

      <section className="legal-sec" aria-labelledby="t-picks">
        <h2 id="t-picks">About the picks</h2>
        <p>
          Picks come from third-party data: Qloo's taste graph and Ticketmaster's event listings.
          Places change their hours, and events sell out or move. The concierge never makes up an
          hour, but it can't promise one either. Check with the place before you go.
        </p>
      </section>

      <section className="legal-sec" aria-labelledby="t-sms">
        <h2 id="t-sms">Text messages</h2>
        <ul>
          <li>Program: Bellhop Concierge. The text is the plan you asked for on the call.</li>
          <li>The concierge offers the text. It goes out only if you say yes, and only to the number you are calling from.</li>
          <li>Frequency: one text per call, and at most three to one number in an hour.</li>
          <li>Reply STOP to any text to stop them. Message and data rates may apply.</li>
        </ul>
        <p>How your number is handled is on the <Link to="/privacy">privacy page</Link>.</p>
      </section>

      <section className="legal-sec" aria-labelledby="t-code">
        <h2 id="t-code">The code</h2>
        <p>
          The source is licensed under the GNU Affero General Public License, version 3.
          {repo ? <> Read it, run it, or fork it: <a href={repo} rel="noopener">the source on GitHub</a>.</> : <> The source link is in the footer.</>}
        </p>
      </section>

      <section className="legal-sec" aria-labelledby="t-contact">
        <h2 id="t-contact">Questions</h2>
        <p>Reach SouthernSky at <a href={SITE} rel="noopener">southernsky.cloud</a>.</p>
      </section>
    </article>
  );
}
