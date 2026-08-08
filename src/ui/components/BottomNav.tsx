import { Icon, type IconName } from './Icon';

export type Tab = 'home' | 'day' | 'progress' | 'settings';

interface BottomNavProps {
  current: Tab;
  onChange: (tab: Tab) => void;
  /** Shown on the training tab so the day is identifiable at a glance. */
  dayLabel: string;
}

const ICONS: Record<Tab, IconName> = {
  home: 'home',
  day: 'dumbbell',
  progress: 'chart',
  settings: 'sliders',
};

/**
 * Bottom tab bar, thumb-reachable on a phone and out of the way on desktop.
 *
 * It sits above the safe-area inset so the labels are not swallowed by the
 * home indicator on iOS.
 */
export function BottomNav({ current, onChange, dayLabel }: BottomNavProps) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'home', label: 'Inicio' },
    { id: 'day', label: dayLabel },
    { id: 'progress', label: 'Progreso' },
    { id: 'settings', label: 'Ajustes' },
  ];

  return (
    <nav
      aria-label="Secciones"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-ink-800 bg-ink-950/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex w-full max-w-2xl">
        {tabs.map((tab) => {
          const active = tab.id === current;
          return (
            <li key={tab.id} className="flex-1">
              <button
                type="button"
                onClick={() => onChange(tab.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-14 w-full flex-col items-center justify-center gap-1 px-1 transition-colors ${
                  active ? 'text-accent-300' : 'text-ink-400 hover:text-ink-200'
                }`}
              >
                <Icon name={ICONS[tab.id]} size={22} />
                <span className="max-w-full truncate text-[11px] font-semibold">{tab.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
