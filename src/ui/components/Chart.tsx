import { useId, useState } from 'react';

/**
 * The drawing primitives the progress screens are built from.
 *
 * Inline SVG, no charting library: the page is served under
 * `default-src 'self'`, so a CDN build could not load even if it were worth
 * 40 kB — and none of this is more than a path and some text.
 *
 * One rule runs through all of them: **the data is one colour**. Volume,
 * weight, sessions — every mark is the same signal yellow, because these are
 * single-series charts and a second hue would encode a distinction that does
 * not exist. Green and amber appear only as status, and never alone: they
 * always sit next to a sign or an arrow, so the reading survives on a screen
 * where red and green are the same colour.
 */

/** One point on a chart. `label` is what the axis shows. */
export interface ChartPoint {
  label: string;
  value: number;
  /** Extra line under the label in the read-out, e.g. "100 kg × 5". */
  detail?: string;
}

const AXIS = '#454d48'; // iron-600
const GRID = '#222724'; // iron-800
const INK = '#7d8781'; // iron-400
const DATA = '#f2c200'; // signal-500
const SURFACE = '#141716'; // iron-900, for the ring that separates marks

/* ------------------------------------------------------------------ */
/* Line chart                                                          */
/* ------------------------------------------------------------------ */

interface TrendChartProps {
  points: ChartPoint[];
  /** Turns a value into what the read-out shows, e.g. `1200` → `"1.200 kg"`. */
  format: (value: number) => string;
  /** Describes the whole chart for somebody who cannot see it. */
  label: string;
  height?: number;
  /**
   * Where the y-axis starts.
   *
   * `zero` for anything additive — volume, sets, sessions — where the height
   * of the area is the quantity and cutting the axis inflates a 3% week into
   * a cliff.
   *
   * `fit` for a working weight, where zero is not a meaningful floor: nobody's
   * bench starts at 0 kg, so a zero-based line squashes 82.5 → 90 into a flat
   * smear and hides the only thing the chart exists to show. It draws no area
   * fill, because a filled area over a cut axis is the shape that lies.
   */
  baseline?: 'zero' | 'fit';
}

/**
 * Value over time: the shape of a training block in one glance.
 *
 * Replaces a column of horizontal bars. Bars answer "which is biggest"; the
 * question here is "is it going up", and only a line has that shape.
 *
 * Tapping a point pins its value. There is no hover on a phone, and a chart
 * you cannot interrogate is decoration — so the last point is selected on
 * arrival, and the read-out above the plot always says what you are looking
 * at. That read-out is also why no point carries a permanent label: a number
 * on every dot is unreadable at this width.
 */
export function TrendChart({
  points,
  format,
  label,
  height = 150,
  baseline = 'zero',
}: TrendChartProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const titleId = useId();

  if (points.length === 0) return null;

  const width = 320;
  const pad = { top: 10, right: 12, bottom: 22, left: 8 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;

  const values = points.map((point) => point.value);
  const highest = Math.max(...values, 1);
  const lowest = Math.min(...values);

  // A tenth of the range as breathing room, so the top and bottom points do
  // not sit exactly on the frame.
  const margin = (highest - lowest) * 0.1 || Math.max(highest * 0.05, 1);
  const top = baseline === 'fit' ? highest + margin : highest;
  const floor = baseline === 'fit' ? Math.max(0, lowest - margin) : 0;
  const range = top - floor || 1;

  const scaleY = (value: number) =>
    pad.top + plotHeight - ((value - floor) / range) * plotHeight;
  const scaleX = (index: number) =>
    pad.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);

  const line = points.map((point, index) => `${scaleX(index)},${scaleY(point.value)}`).join(' ');
  const area = `${pad.left},${pad.top + plotHeight} ${line} ${pad.left + plotWidth},${
    pad.top + plotHeight
  }`;

  const active = selected ?? points.length - 1;
  const current = points[active];

  // Every second label once the block gets long, so they never collide.
  const labelStep = points.length > 8 ? Math.ceil(points.length / 6) : 1;

  return (
    <figure className="m-0">
      {current ? (
        <figcaption className="mb-1 flex items-baseline gap-2">
          <span className="figure text-2xl font-bold text-chalk">{format(current.value)}</span>
          <span className="text-xs text-iron-400">
            {current.label}
            {current.detail ? ` · ${current.detail}` : ''}
          </span>
        </figcaption>
      ) : null}

      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-labelledby={titleId}
        className="overflow-visible"
      >
        <title id={titleId}>{label}</title>

        {/* Three recessive gridlines: enough to read a level, quiet enough
            not to compete with the data. */}
        {[0, 0.5, 1].map((fraction) => (
          <line
            key={fraction}
            x1={pad.left}
            x2={pad.left + plotWidth}
            y1={pad.top + plotHeight * fraction}
            y2={pad.top + plotHeight * fraction}
            stroke={fraction === 1 ? AXIS : GRID}
            strokeWidth="1"
          />
        ))}

        {baseline === 'zero' ? <polygon points={area} fill={DATA} fillOpacity="0.12" /> : null}
        <polyline
          points={line}
          fill="none"
          stroke={DATA}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {points.map((point, index) => (
          <g key={point.label}>
            <circle
              cx={scaleX(index)}
              cy={scaleY(point.value)}
              r={index === active ? 5 : 3}
              fill={DATA}
              stroke={SURFACE}
              strokeWidth="2"
            />
            {/* The hit target, far bigger than the dot: a fingertip is 44px
                and the mark is 6. Invisible, but it is what you actually tap. */}
            <rect
              x={scaleX(index) - plotWidth / (points.length * 2) - 6}
              y={pad.top}
              width={plotWidth / points.length + 12}
              height={plotHeight}
              fill="transparent"
              className="cursor-pointer"
              onClick={() => setSelected(index)}
            >
              <title>{`${point.label}: ${format(point.value)}`}</title>
            </rect>
          </g>
        ))}

        {points.map((point, index) =>
          index % labelStep === 0 || index === points.length - 1 ? (
            <text
              key={`${point.label}-label`}
              x={scaleX(index)}
              y={height - 6}
              textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
              fontSize="10"
              fill={index === active ? DATA : INK}
            >
              {point.label}
            </text>
          ) : null,
        )}
      </svg>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Sparkline                                                           */
/* ------------------------------------------------------------------ */

/**
 * A trend small enough to sit in a list row.
 *
 * No axes and no labels on purpose: it is not there to be measured, it is
 * there so that scrolling a list of twenty exercises shows you which three
 * are climbing without reading a single number. The figures are in the row
 * beside it.
 */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;

  const width = 64;
  const height = 22;
  const max = Math.max(...values);
  const min = Math.min(...values);
  // A flat lift is a real answer, so it is drawn flat down the middle rather
  // than divided by a zero range.
  const span = max - min || 1;

  const point = (value: number, index: number) => {
    const x = (index / (values.length - 1)) * (width - 4) + 2;
    const y = height - 3 - ((value - min) / span) * (height - 6);
    return `${x},${y}`;
  };

  const last = values.at(-1) ?? 0;
  const [lastX, lastY] = point(last, values.length - 1).split(',');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label}>
      <polyline
        points={values.map(point).join(' ')}
        fill="none"
        stroke={DATA}
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.85"
      />
      {/* Where it ended up is the part that matters, so it gets the dot. */}
      <circle cx={lastX} cy={lastY} r="2.75" fill={DATA} stroke={SURFACE} strokeWidth="1.5" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Bars                                                                */
/* ------------------------------------------------------------------ */

interface BarsProps {
  points: (ChartPoint & { done?: boolean })[];
  format: (value: number) => string;
  label: string;
  height?: number;
  /** Names the two colours. Omit when nothing is marked as done. */
  legend?: { done: string; pending: string };
}

/**
 * One bar per session: how the week was distributed.
 *
 * Vertical, not horizontal. A week has a handful of days and reads left to
 * right like the calendar it is; horizontal bars turned it into a leaderboard,
 * which is not a question anybody asks about their own week.
 */
export function Bars({ points, format, label, height = 130, legend }: BarsProps) {
  const titleId = useId();
  if (points.length === 0) return null;

  const max = Math.max(...points.map((point) => point.value), 1);
  const showLegend = legend !== undefined && points.some((point) => point.done);

  return (
    <figure className="m-0">
      <div
        role="img"
        aria-labelledby={titleId}
        className="flex items-end gap-1.5"
        style={{ height }}
      >
        <span id={titleId} className="sr-only">
          {label}
        </span>
        {points.map((point) => {
          const ratio = point.value / max;
          return (
            <div key={point.label} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1">
              <span className="figure truncate text-center text-[10px] tabular-nums text-iron-400">
                {point.value > 0 ? format(point.value) : ''}
              </span>
              {/* One background class, chosen here: two utilities in the same
                  attribute do not resolve by their order in the string, they
                  resolve by their order in the stylesheet — so an untrained
                  day could come out signal yellow. */}
              <span
                title={`${point.label}: ${format(point.value)}`}
                className={`w-full rounded-t ${
                  point.value === 0 ? 'bg-iron-800' : point.done ? 'bg-done-500' : 'bg-signal-500'
                }`}
                // A trained day never shrinks to nothing: a 2px stub says "some",
                // an empty column says "none", and they must not look alike.
                style={{ height: `${Math.max(ratio * 100, point.value > 0 ? 3 : 1)}%` }}
              />
              <span className="truncate text-center text-[10px] text-iron-600">{point.label}</span>
            </div>
          );
        })}
      </div>

      {/* Two colours in a chart are two meanings, and an unlabelled meaning is
          a guess. It also carries the reading where green and amber look the
          same, which no amount of colour choice can fix on its own. */}
      {showLegend ? (
        <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-iron-600">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-sm bg-done-500" />
            {legend.done}
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-sm bg-signal-500" />
            {legend.pending}
          </span>
        </figcaption>
      ) : null}
    </figure>
  );
}

/**
 * A change, stated so it survives without colour.
 *
 * The arrow and the sign carry the direction; the green and the amber only
 * reinforce it. On a deuteranopic screen those two hues are the same colour,
 * and a chart that encodes "better" as green alone says nothing there.
 */
export function Delta({ value, unit = '%' }: { value: number | null; unit?: string }) {
  if (value === null) return <span className="text-xs text-iron-600">—</span>;

  const up = value >= 0;
  return (
    <span
      className={`figure inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums ${
        value === 0 ? 'text-iron-400' : up ? 'text-done-300' : 'text-amber-300'
      }`}
    >
      <span aria-hidden="true">{value === 0 ? '=' : up ? '▲' : '▼'}</span>
      {up && value !== 0 ? '+' : ''}
      {value}
      {unit}
    </span>
  );
}
