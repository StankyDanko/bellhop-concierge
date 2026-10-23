// V4, "What your callers love": an area card, not a street map (DESIGN-BRIEF section 2).
// The inn at the center, range rings at true scale for the selected radius, and the heatmap
// cells as rounded squares in four binned taste steps a legend can name. No tiles, no
// external requests. Beside it, the fingerprint chips and the sample size.
import { Link } from '../router.jsx';
import { SampleBadge } from './ui.jsx';

const MI_PER_DEG_LAT = 69.0;
const SIZE = 100; // half the viewBox
const PLOT = 86;  // radius of the outer ring, in viewBox units
const RINGS = [1, 2, 5];
const DIRS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

/** Offset of a point from the inn, in miles (east, north). */
function offset(inn, p) {
  const east = (p.lng - inn.lng) * MI_PER_DEG_LAT * Math.cos((inn.lat * Math.PI) / 180);
  const north = (p.lat - inn.lat) * MI_PER_DEG_LAT;
  return { east, north };
}
const miles = (o) => Math.hypot(o.east, o.north);
const direction = (o) => DIRS[Math.round(((Math.atan2(o.east, o.north) * 180) / Math.PI + 360) % 360 / 45) % 8];
/** Affinity 0..1 to bin 1..4. */
const binOf = (a) => Math.min(4, Math.max(1, Math.floor((Number(a) || 0) * 4) + 1));

function AreaMap({ inn, radius, cells, gated }) {
  const scale = PLOT / radius;
  const rings = [...new Set([...RINGS.filter((r) => r < radius), radius])];
  const label = gated
    ? 'The inn and its range rings. No areas are shaded until five calls have named a taste.'
    : `The inn at the center with ${cells.length} shaded areas around it, darker where the tastes run stronger. The list below has the same information.`;
  return (
    <svg className="area-map" viewBox={`${-SIZE} ${-SIZE} ${2 * SIZE} ${2 * SIZE}`} role="img" aria-label={label}>
      {rings.map((r) => (
        <g key={r}>
          <circle className="area-ring" cx="0" cy="0" r={r * scale} />
          <text className="area-ring-label" x={r * scale * 0.71 + 2} y={-r * scale * 0.71 - 2}>{r} mi</text>
        </g>
      ))}
      <line className="area-tick" x1="0" y1={-PLOT - 2} x2="0" y2={-PLOT - 8} />
      <text className="area-ring-label" x="0" y={-PLOT - 10} textAnchor="middle">N</text>
      {!gated && cells.map((c) => {
        const o = offset(inn, c);
        const d = Math.min(miles(o), radius);
        const k = miles(o) > 0 ? d / miles(o) : 0;
        return (
          <rect key={c.geohash ?? `${c.lat},${c.lng}`} className={`area-cell heat-${binOf(c.affinity)}`}
            x={o.east * k * scale - 7} y={-o.north * k * scale - 7} width="14" height="14" rx="3" />
        );
      })}
      <circle className="area-inn-ring" cx="0" cy="0" r="6" />
      <circle className="area-inn" cx="0" cy="0" r="2.5" />
      <line className="area-scale" x1={-SIZE + 8} y1={SIZE - 8} x2={-SIZE + 8 + scale} y2={SIZE - 8} />
      <text className="area-ring-label" x={-SIZE + 8} y={SIZE - 12}>1 mi</text>
    </svg>
  );
}

/**
 * @param {{ insights: any, fingerprint: any, compact?: boolean }} props
 *   insights: GET /api/properties/:id/insights (area, heatmap, sample)
 *   fingerprint: GET /api/properties/:id/fingerprint (basis, sessions, entities, tags, gate)
 */
export function AreaCard({ insights, fingerprint, compact = false, place = 'the inn' }) {
  if (!insights?.area) return null;
  const inn = { lat: insights.area.lat, lng: insights.area.lng };
  const radius = Number(insights.area.radius_miles) || 2;
  const fp = fingerprint ?? {};
  const sample = fp.basis === 'sample' || insights.sample;
  const gated = fp.basis === 'none' || insights.heatmap?.status === 'gated';
  const cells = (insights.heatmap?.cells ?? []).filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng));
  const hottest = [...cells].sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0)).slice(0, 3);
  const tastes = [...(fp.entities ?? []), ...(fp.tags ?? [])].sort((a, b) => b.sessions - a.sessions).slice(0, compact ? 6 : 10);
  const min = fp.gate?.min ?? 5;
  const count = fp.gate?.count ?? 0;

  return (
    <div className="area-card card" data-sample={sample ? 'yes' : 'no'}>
      <div className="area-card-head">
        <p className="micro">Around {place}, {radius} mi</p>
        {sample && <SampleBadge>Sample data</SampleBadge>}
      </div>
      <div className="area-grid">
        <div className="area-plot">
          <AreaMap inn={inn} radius={radius} cells={cells} gated={gated} />
          <p className="area-legend" aria-hidden="true">
            <span>Weaker</span>
            {[1, 2, 3, 4].map((b) => <span key={b} className={`area-sw heat-${b}`} />)}
            <span>Stronger</span>
            <span className="area-sw-inn" />
            <span>The inn</span>
          </p>
        </div>
        <div className="area-side">
          {gated ? (
            <>
              <div className="gate-bricks" aria-hidden="true">
                {Array.from({ length: min }, (_, i) => <span key={i} className={i < count ? 'on' : ''} />)}
              </div>
              <p className="area-size"><span className="num">{count}</span> of <span className="num">{min}</span> calls so far. This stays dark until {min} calls have named a taste.</p>
            </>
          ) : (
            <>
              <p className="area-size">From <span className="num">{fp.sessions ?? insights.sample_size}</span> calls that named a taste.</p>
              {sample && <p className="dim area-note">Fictional callers, to show how it looks.</p>}
              <ul className="area-tastes" aria-label="What these callers named, with how many calls named it">
                {tastes.map((t) => (
                  <li key={t.id ?? t.name} className="chip chip-taste"><span>{t.name}</span><span className="num">{t.sessions}</span></li>
                ))}
              </ul>
              {hottest.length > 0 && (
                <>
                  <p className="micro">Hottest {hottest.length} areas</p>
                  <ol className="area-hot">
                    {hottest.map((c) => {
                      const o = offset(inn, c);
                      return <li key={c.geohash ?? `${c.lat},${c.lng}`}><span className="num">{miles(o).toFixed(1)}</span> mi {direction(o)} of {place}</li>;
                    })}
                  </ol>
                </>
              )}
            </>
          )}
        </div>
      </div>
      <p className="micro area-caption">Distances to scale. Streets are not drawn.</p>
      {compact && <Link to="/property/demo" className="btn btn-text area-link">Open the innkeeper dashboard</Link>}
    </div>
  );
}
