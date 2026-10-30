// Three steps beside one pinned stage. On a wide screen the stage stays put and swaps its
// picture as each step reaches the middle of the screen; on a narrow one every step carries
// its own picture inline and nothing is pinned.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../icons.jsx';

function StageCall({ s }) {
  return (
    <div className="lx-vis lx-vis-call">
      <span className="lx-ring" aria-hidden="true"><Icon name="phone" /></span>
      <p className="lx-vis-label">{s.ringing}</p>
      <p className="lx-vis-number">{s.callee}</p>
    </div>
  );
}

function StageLearn({ s }) {
  return (
    <div className="lx-vis lx-vis-learn">
      <p className="lx-vis-label">{s.youSaid}</p>
      <ul className="lx-said">{s.tastes.map((x) => <li key={x}>{x}</li>)}</ul>
      <svg className="lx-graph" viewBox="0 0 240 120" aria-hidden="true" focusable="false">
        <path d="M60 4 C60 60 120 50 120 76" />
        <path d="M180 4 C180 60 120 50 120 76" />
        <circle cx="120" cy="82" r="9" />
        <path d="M120 92 L120 118" />
      </svg>
      <p className="lx-graph-label">{s.graph}</p>
      <div className="lx-pickcard">
        <p className="lx-pickcard-name">{s.pick}</p>
        <p className="lx-pickcard-why">{s.pickWhy}</p>
      </div>
    </div>
  );
}

function StageText({ s }) {
  return (
    <div className="lx-vis lx-vis-text">
      <div className="lx-bubble">{s.sms}</div>
      <p className="lx-vis-label"><Icon name="check" />{s.delivered}</p>
    </div>
  );
}

export function HowSteps({ copy }) {
  const [active, setActive] = useState(0);
  const refs = useRef([]);
  const visuals = [
    <StageCall key="call" s={copy.stage} />,
    <StageLearn key="learn" s={copy.stage} />,
    <StageText key="text" s={copy.stage} />,
  ];

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setActive(Number(e.target.dataset.i));
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="lx-how">
      <ol className="lx-how-steps">
        {copy.items.map((it, i) => (
          <li key={it.id} ref={(el) => { refs.current[i] = el; }} data-i={i} className="lx-how-step" data-active={active === i ? 'yes' : 'no'}>
            <p className="lx-kicker tnum">{it.kicker}</p>
            <h3 className="lx-how-title">{it.title}</h3>
            <p className="lx-how-body">{it.body}</p>
            <div className="lx-how-inline" aria-hidden="true">{visuals[i]}</div>
          </li>
        ))}
      </ol>
      <div className="lx-how-stage" aria-hidden="true">
        {visuals.map((v, i) => <div key={i} className="lx-how-panel" data-active={active === i ? 'yes' : 'no'}>{v}</div>)}
      </div>
    </div>
  );
}
