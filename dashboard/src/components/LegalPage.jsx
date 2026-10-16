// Renders one page from legal-content.js. The static copies in dist/ are built from the same
// module by dashboard/scripts/build-legal.mjs, so the two cannot say different things.
import { EFFECTIVE, segments } from '../legal-content.js';
import { Link } from '../router.jsx';
import '../legal.css';

function Inline({ value }) {
  return segments(value).map((s, i) => {
    if (typeof s === 'string') return s;
    if (s.to) return <Link key={i} to={s.to}>{s.text}</Link>;
    return <a key={i} href={s.href} rel="noopener">{s.text}</a>;
  });
}

function Block({ block }) {
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
        const id = `${page.title.toLowerCase()}-${sec.id}`;
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
