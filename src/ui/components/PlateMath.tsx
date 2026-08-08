import { calculatePlates, formatPerSide, type Plate } from '../../domain/plates';

interface PlateMathProps {
  /** Total weight on the bar, in kilos. */
  weightKg: number | null;
}

const PLATE_STYLE: Record<Plate['colour'], { fill: string; height: string }> = {
  red: { fill: 'bg-plate-red', height: 'h-7' },
  blue: { fill: 'bg-plate-blue', height: 'h-[26px]' },
  yellow: { fill: 'bg-plate-yellow', height: 'h-6' },
  green: { fill: 'bg-plate-green', height: 'h-[22px]' },
  white: { fill: 'bg-plate-white', height: 'h-5' },
  'small-red': { fill: 'bg-plate-red', height: 'h-4' },
  chrome: { fill: 'bg-plate-chrome', height: 'h-3' },
};

/**
 * What to put on each side of the bar.
 *
 * This is the one piece of arithmetic every lifter does between sets and
 * regularly gets wrong when tired. The app already knows the weight, so it
 * does the sum and draws the answer in the plate colours lifters already
 * read: taller and redder means heavier.
 *
 * Renders nothing when the weight is below a bar, because a cable stack or a
 * dumbbell has no plates to work out and a guess would be worse than silence.
 */
export function PlateMath({ weightKg }: PlateMathProps) {
  if (weightKg === null) return null;

  const load = calculatePlates(weightKg);
  if (!load || load.perSide.length === 0) return null;

  const summary = `${formatPerSide(load)} kg por lado, más barra de ${load.barKg} kg`;

  return (
    <div className="flex items-center gap-2 px-1 pt-1.5">
      <span className="sr-only">{summary}</span>

      {/* The bar sleeve, so the plates read as loaded onto something. */}
      <span aria-hidden="true" className="h-[3px] w-2.5 shrink-0 rounded-full bg-iron-600" />

      <span aria-hidden="true" className="flex items-center gap-[3px]">
        {load.perSide.map((plate, index) => (
          <span
            key={index}
            className={`w-[5px] shrink-0 rounded-[1px] ${PLATE_STYLE[plate.colour].fill} ${
              PLATE_STYLE[plate.colour].height
            }`}
          />
        ))}
      </span>

      <span aria-hidden="true" className="figure text-xs text-iron-400">
        {formatPerSide(load)}
        {load.remainderKg > 0 ? (
          <span className="text-effort-300"> +{load.remainderKg} sin cuadrar</span>
        ) : null}
      </span>
    </div>
  );
}
