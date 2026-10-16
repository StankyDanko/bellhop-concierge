// The tear-off room card for the innkeeper brief. Black on white by construction: hairline
// borders, no fills, so it photocopies and prints on a monochrome laser without losing anything.
import { Icon } from '../icons.jsx';
import { formatPhone } from './ui.jsx';

/** A number, or a blank write-in line when the property has no published number yet. */
function CardNumber({ number }) {
  if (number) return <p className="rc-number tnum">{formatPhone(number)}</p>;
  return <p className="rc-number rc-blank" aria-label="Write the concierge number here"><span /></p>;
}

/**
 * @param {{ name: string, number: string|null, variant?: 'large'|'tent', label: string }} props
 *   large = 3:2 (a 4x6 card, scaled), tent = 5:3 (a 3x5 nightstand card, scaled)
 */
export function RoomCard({ name, number, variant = 'large', label }) {
  return (
    <figure className={`rc rc-${variant}`} aria-label={label}>
      <div className="rc-card">
        <p className="rc-inn"><Icon name="bell" />{name}</p>
        <p className="rc-hook">Need a plan tonight?</p>
        <p className="rc-call">Call the front desk concierge</p>
        <CardNumber number={number} />
        <p className="rc-line">Tell it two things you love. It texts you three places nearby.</p>
        {variant === 'large' && <p className="rc-fine">An automated line. Calls are recorded.</p>}
      </div>
    </figure>
  );
}
