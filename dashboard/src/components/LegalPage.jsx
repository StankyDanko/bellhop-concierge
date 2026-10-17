// Renders one page from legal-content.js. The static copies in dist/ are built from the same
// module by dashboard/scripts/build-legal.mjs, so the two cannot say different things.
import { EFFECTIVE, segments } from '../legal-content.js';
import { Icon } from '../icons.jsx';
import { Link } from '../router.jsx';
import '../legal.css';
import '../opt-in.css';

function Inline({ value }) {
  return segments(value).map((s, i) => {
    if (typeof s === 'string') return s;
    if (s.to) return <Link key={i} to={s.to}>{s.text}</Link>;
    return <a key={i} href={s.href} rel="noopener">{s.text}</a>;
  });
}

/** The printed room card, as the guest sees it on the nightstand. */
function Card({ card }) {
  return (
    <figure className="oc" aria-label={`Room card for ${card.inn}`}>
      <div className="oc-card">
        <p className="oc-inn"><Icon name="bell" />{card.inn}</p>
        <p className="oc-hook">{card.hook}</p>
        <p className="oc-call">{card.call} <span className="oc-number">{card.number}</span></p>
        <p className="oc-line">{card.line}</p>
        <p className="oc-fine">{card.fine}</p>
      </div>
    </figure>
  );
}

function Block({ block }) {
  if (block.card) return <Card card={block.card} />;
  if (block.quote) return <blockquote className="oc-quote"><p>{block.quote}</p></blockquote>;
  if (block.ul) return <ul>{block.ul.map((item, i) => <li key={i}><Inline value={item} /></li>)}</ul>;
  if (block.key) return <p className="legal-key">{block.key}</p>;
  return <p><Inline value={block.p} /></p>;
}

export default function LegalPage({ page }) {
  return (
    <article className="container legal" aria-labelledby="legal-title">
      <header className="legal-head">
        <p className="legal-eyebrow">Bellhop Concierge</p>
        <h1 id="legal-title">{page.title}</h1>
        <p className="legal-meta">Effective {EFFECTIVE}</p>
      </header>
      <p className="legal-lead"><Inline value={page.lead} /></p>
      {page.sections.map((sec) => {
        const id = `${page.slug ?? page.title.toLowerCase()}-${sec.id}`;
        return (
          <section key={sec.id} className="legal-sec" aria-labelledby={id}>
            <h2 id={id}>{sec.heading}</h2>
            {sec.blocks.map((b, i) => <Block key={i} block={b} />)}
          </section>
        );
      })}
    </article>
  );
}
