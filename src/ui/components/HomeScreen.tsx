import { daySessionStatus, findNextDay, weekSummary } from '../../domain/calculations';
import type { Week } from '../../domain/types';
import { Icon } from './Icon';
import { HomeClasses } from './HomeClasses';

interface HomeScreenProps {
  week: Week;
  weekCount: number;
  onOpenDay: (dayNumber: number) => void;
  /** Abre la pestaña de clases, en ese día si se da. */
  onOpenClasses: (date?: string) => void;
}

/**
 * Inicio: lo siguiente que tienes que hacer, y nada más.
 *
 * Dos cosas: tu próxima clase y seguir con tu entrenamiento. Las cifras de la
 * semana viven en Progreso y cada sesión en su pestaña; aquí solo sobrarían.
 */
export function HomeScreen({ week, weekCount, onOpenDay, onOpenClasses }: HomeScreenProps) {
  const summary = weekSummary(week);
  const nextDay = findNextDay(week);

  return (
    <div className="space-y-6">
      <HomeClasses onOpenClasses={onOpenClasses} />

      <section aria-labelledby="week-summary-title" className="space-y-3">
        <div className="px-1">
          {/* La semana ya la nombra el selector de arriba: aquí solo para el
              lector de pantalla, que no ve el selector como título. */}
          <h2 id="week-summary-title" className="sr-only">
            Semana {week.number}
            {weekCount > 1 ? ` de ${weekCount}` : ''}
          </h2>
          <span className="text-sm text-iron-400">
            {summary.completedDays} de {summary.totalDays} sesiones completadas
          </span>
        </div>

        {nextDay ? (
          <button
            type="button"
            onClick={() => onOpenDay(nextDay.number)}
            className="flex w-full items-center gap-4 rounded-2xl bg-signal-500 px-4 py-4 text-left text-ink transition-colors hover:bg-signal-400"
          >
            <span className="flex-1">
              <span className="eyebrow block text-ink/70">
                {daySessionStatus(nextDay) === 'in-progress' ? 'Continuar' : 'Empezar'}
              </span>
              <span className="block font-condensed text-2xl font-bold uppercase leading-none tracking-tight">
                Día {nextDay.number}
                {nextDay.type ? ` · ${nextDay.type}` : ''}
              </span>
            </span>
            <Icon name="chevronRight" size={24} className="shrink-0" />
          </button>
        ) : (
          <p
            role="status"
            className="rounded-2xl border border-done-500/40 bg-done-500/10 px-4 py-4 text-center text-sm font-semibold text-done-300"
          >
            Semana completada. Buen trabajo.
          </p>
        )}
      </section>
    </div>
  );
}
