import { useEffect, useState } from 'react';

import * as api from '../../api/client';
import type { Announcement } from '../../api/client';
import { dismissNotice, loadDismissedNotices } from '../../storage/storage';
import { Icon } from './Icon';

/**
 * Los avisos del gimnasio, arriba del todo, para todos.
 *
 * Cada persona los cierra en su móvil cuando los ha leído; un aviso nuevo
 * vuelve a salir. Sin conexión no se enseña nada: no hay aviso que decir.
 */
export function AnnouncementsBanner() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<number[]>(loadDismissedNotices);

  useEffect(() => {
    let cancelled = false;
    api.fetchAnnouncements().then(
      (found) => {
        if (!cancelled) setAnnouncements(found);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = announcements.filter((announcement) => !dismissed.includes(announcement.id));
  if (visible.length === 0) return null;

  return (
    <section aria-label="Avisos del gimnasio" className="space-y-2">
      {visible.map((announcement) => (
        <p
          key={announcement.id}
          className="flex items-start gap-3 rounded-xl border border-signal-500/50 bg-signal-500/10 px-4 py-3 text-sm text-iron-100"
        >
          <span className="flex-1 whitespace-pre-line">
            <span className="eyebrow mb-0.5 block text-signal-300">Aviso del gimnasio</span>
            {announcement.message}
          </span>
          <button
            type="button"
            onClick={() => {
              dismissNotice(announcement.id);
              setDismissed((current) => [...current, announcement.id]);
            }}
            aria-label="Cerrar aviso"
            className="-mr-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-iron-400 hover:bg-iron-850 hover:text-iron-100"
          >
            <Icon name="close" size={16} />
          </button>
        </p>
      ))}
    </section>
  );
}
