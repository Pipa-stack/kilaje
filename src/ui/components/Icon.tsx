/**
 * Icon set.
 *
 * Inline SVG rather than emoji: emoji render as a different picture on every
 * operating system, cannot inherit colour or stroke weight, and sit on their
 * own baseline, so a tab bar built from them never lines up. These are drawn
 * on one 24px grid with one stroke weight, and take their colour from the
 * text around them.
 */

export type IconName =
  | 'home'
  | 'dumbbell'
  | 'chart'
  | 'sliders'
  | 'chevronRight'
  | 'play'
  | 'upload'
  | 'check'
  | 'clock'
  | 'plus'
  | 'user'
  | 'close';

interface IconProps {
  name: IconName;
  /** Pixel size of the square box. */
  size?: number;
  className?: string;
}

const PATHS: Record<IconName, React.ReactNode> = {
  home: (
    <>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.75 9.5V19a1.5 1.5 0 0 0 1.5 1.5h9.5a1.5 1.5 0 0 0 1.5-1.5V9.5" />
    </>
  ),
  dumbbell: (
    <>
      <path d="M6.5 7.5v9M4 9.5v5M17.5 7.5v9M20 9.5v5" />
      <path d="M6.5 12h11" />
    </>
  ),
  chart: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="M7 20.5v-5M12 20.5v-10M17 20.5v-7" />
    </>
  ),
  sliders: (
    <>
      <path d="M3.5 7h8M15.5 7h5M3.5 12h11M18.5 12h2M3.5 17h4M11.5 17h9" />
      <circle cx="13.5" cy="7" r="2" />
      <circle cx="16.5" cy="12" r="2" />
      <circle cx="9.5" cy="17" r="2" />
    </>
  ),
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  play: <path d="M8.5 5.75v12.5l10-6.25z" />,
  upload: (
    <>
      <path d="M12 15.5V4M8 7.5 12 3.5l4 4" />
      <path d="M4.5 15.5v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-3.5" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  user: (
    <>
      <circle cx="12" cy="8" r="3.75" />
      <path d="M4.75 20c0-3.4 3.25-5.5 7.25-5.5s7.25 2.1 7.25 5.5" />
    </>
  ),
  close: <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />,
};

/** Filled icons need no stroke; the rest are drawn as outlines. */
const FILLED = new Set<IconName>(['play']);

export function Icon({ name, size = 24, className }: IconProps) {
  const filled = FILLED.has(name);

  return (
    <svg
      // Decorative by default: every icon in this app sits next to a text
      // label or inside a button that already has an accessible name.
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
