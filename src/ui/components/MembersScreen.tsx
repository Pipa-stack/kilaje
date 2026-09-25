import { useCallback, useEffect, useMemo, useState } from 'react';

import * as api from '../../api/client';
import type { MemberSummary, ProgramSummary } from '../../api/client';
import { shortDate } from '../format';
import { addDays, gymToday, longDate } from '../classDates';
import { Dropzone } from './Dropzone';
import { Icon } from './Icon';

interface MembersScreenProps {
  /** Quién está mirando: su propio rol no se puede cambiar desde aquí. */
  currentUserId: number | null;
  /** Sin él, la lista no ofrece «Volver» (va dentro de Gestión). */
  onBack?: () => void;
  offline: boolean;
}

/** "hoy", "ayer", "hace 5 días" o la fecha. */
function sinceLabel(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 14) return `hace ${days} días`;
  return `el ${shortDate(iso)}`;
}

/** Quita tildes y mayúsculas para buscar "maria" y encontrar "María". */
function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * Los socios del gimnasio, para quien administra.
 *
 * Como en Trainerize o Virtuagym en su forma más simple: una lista que se
 * busca, y en cada socio lo que se hace con él — subirle el planning con la
 * plantilla de siempre, bajarse su progreso en esa misma plantilla, y darle o
 * quitarle el rol de administrador.
 */
export function MembersScreen({ currentUserId, onBack, offline }: MembersScreenProps) {
  const [members, setMembers] = useState<MemberSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setMembers(await api.fetchMembers());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se han podido cargar los socios.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = fold(query.trim());
    if (!members || needle === '') return members ?? [];
    return members.filter(
      (member) => fold(member.displayName).includes(needle) || fold(member.email).includes(needle),
    );
  }, [members, query]);

  const back = selected === null && !onBack ? null : (
    <button
      type="button"
      onClick={selected === null ? onBack : () => setSelected(null)}
      className="flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-iron-400 hover:bg-iron-850 hover:text-iron-100"
    >
      <Icon name="chevronRight" size={18} className="rotate-180" />
      {selected === null ? 'Volver' : 'Socios'}
    </button>
  );

  if (selected !== null) {
    return (
      <div className="space-y-4">
        {back}
        <MemberDetail
          userId={selected}
          currentUserId={currentUserId}
          offline={offline}
          onChanged={() => void load()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {back}
      <div className="flex items-baseline justify-between gap-3">
        {/* Dentro de la gestión el título ya está arriba: aquí sobraría. */}
        <h2 className={onBack ? 'text-xl font-bold text-chalk' : 'sr-only'}>Socios</h2>
        {members ? <span className="text-sm text-iron-400">{members.length} en total</span> : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-xl border border-effort-500/40 bg-effort-500/10 px-4 py-3 text-sm text-effort-300">
          {error}
        </p>
      ) : null}

      <label className="block">
        <span className="sr-only">Buscar socio</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar por nombre o correo"
          className="w-full rounded-xl border border-iron-700 bg-iron-900 px-4 py-3 text-chalk placeholder:text-iron-600 focus:border-signal-400 focus:outline-none"
        />
      </label>

      {members === null && !error ? (
        <p role="status" className="py-8 text-center text-iron-400">
          Cargando socios…
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border border-iron-800 bg-iron-900 px-4 py-6 text-center text-sm text-iron-400">
          {query ? 'Nadie coincide con esa búsqueda.' : 'Todavía no hay socios.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((member) => (
            <li key={member.id}>
              <button
                type="button"
                onClick={() => setSelected(member.id)}
                className="flex w-full items-center gap-3 rounded-2xl border border-iron-800 bg-iron-900 px-4 py-3 text-left hover:bg-iron-850"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="truncate font-semibold text-chalk">{member.displayName}</span>
                    <RoleChip member={member} />
                    <FeeChip member={member} />
                  </span>
                  <span className="block truncate text-xs text-iron-400">{member.email}</span>
                  <span className="mt-0.5 block truncate text-xs text-iron-400">
                    {member.currentProgram ?? 'Sin plan'}
                    {' · '}
                    {member.lastTrainedAt
                      ? `entrenó ${sinceLabel(member.lastTrainedAt)}`
                      : 'sin entrenar todavía'}
                  </span>
                </span>
                <Icon name="chevronRight" size={20} className="shrink-0 text-iron-600" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Cómo va su cuota: nada si no se lleva control. */
function FeeChip({ member }: { member: MemberSummary }) {
  if (!member.paidUntil) return null;
  const today = gymToday();
  if (member.paidUntil < today) {
    return (
      <span className="shrink-0 rounded-full bg-effort-500/15 px-2 py-0.5 text-xs font-semibold text-effort-300">
        Cuota vencida
      </span>
    );
  }
  if (member.paidUntil <= addDays(today, 7)) {
    return (
      <span className="shrink-0 rounded-full bg-signal-500/15 px-2 py-0.5 text-xs font-semibold text-signal-300">
        Vence el {shortDate(member.paidUntil)}
      </span>
    );
  }
  return null;
}

/** Un mes más a partir de hoy o de lo ya pagado, lo que sea más tarde. */
function plusOneMonth(paidUntil: string | null): string {
  const today = gymToday();
  const base = paidUntil && paidUntil > today ? paidUntil : today;
  const [year, month, day] = base.split('-').map(Number);
  const next = new Date(Date.UTC(year!, month!, day!, 12));
  // 31 de enero + 1 mes no es 3 de marzo: se queda en el último día del mes.
  if (next.getUTCDate() !== day) next.setUTCDate(0);
  return next.toISOString().slice(0, 10);
}

function RoleChip({ member }: { member: MemberSummary }) {
  if (member.role !== 'admin') return null;
  return (
    <span className="shrink-0 rounded-full bg-signal-500/15 px-2 py-0.5 text-xs font-semibold text-signal-300">
      {member.owner ? 'Propietario' : 'Administrador'}
    </span>
  );
}

interface MemberDetailProps {
  userId: number;
  currentUserId: number | null;
  offline: boolean;
  onChanged: () => void;
}

function MemberDetail({ userId, currentUserId, offline, onChanged }: MemberDetailProps) {
  const [member, setMember] = useState<MemberSummary | null>(null);
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const detail = await api.fetchMember(userId);
      setMember(detail.member);
      setPrograms(detail.programs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se ha podido cargar el socio.');
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (work: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await work();
      await load();
      onChanged();
      setNotice(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se ha podido completar la operación.');
    } finally {
      setBusy(false);
    }
  };

  if (!member) {
    return error ? (
      <p role="alert" className="text-sm text-effort-300">
        {error}
      </p>
    ) : (
      <p role="status" className="py-8 text-center text-iron-400">
        Cargando…
      </p>
    );
  }

  const isSelf = member.id === currentUserId;
  const canChangeRole = !member.owner && !isSelf;
  const disabled = busy || offline;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-iron-800 bg-iron-900 p-4">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="text-xl font-bold text-chalk">{member.displayName}</h2>
          <RoleChip member={member} />
          <FeeChip member={member} />
        </div>
        <p className="text-sm text-iron-400">{member.email}</p>
        <p className="mt-1 text-xs text-iron-400">
          Socio desde el {shortDate(member.memberSince)}
          {' · '}
          {member.lastTrainedAt ? `entrenó ${sinceLabel(member.lastTrainedAt)}` : 'sin entrenar todavía'}
        </p>
        <p className="mt-1 text-xs text-iron-400">
          Clases últimos 30 días: vino {member.attended30}
          {member.missed30 > 0 ? (
            <span className="font-semibold text-effort-300"> · faltó {member.missed30}</span>
          ) : null}
        </p>
      </section>

      <FeeSection
        member={member}
        disabled={disabled}
        onSave={(paidUntil) =>
          void act(async () => {
            await api.setMemberPaidUntil(member.id, paidUntil);
            return paidUntil
              ? `Cuota de ${member.displayName} pagada hasta el ${longDate(paidUntil)}.`
              : `Ya no se controla la cuota de ${member.displayName}.`;
          })
        }
      />

      <div role="status" aria-live="polite">
        {error ? (
          <p className="rounded-xl border border-effort-500/40 bg-effort-500/10 px-4 py-3 text-sm text-effort-300">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="rounded-xl border border-done-500/40 bg-done-500/10 px-4 py-3 text-sm font-semibold text-done-300">
            {notice}
          </p>
        ) : null}
      </div>

      <section aria-labelledby="assign-title" className="rounded-2xl border border-iron-800 bg-iron-900 p-4">
        <h3 id="assign-title" className="mb-1 font-semibold text-chalk">
          Subir su planning
        </h3>
        <p className="mb-3 text-sm text-iron-400">
          La misma plantilla de Excel de siempre. Pasa a ser el plan que se le abre al entrar y le
          llega un correo avisando. Sus planes anteriores y lo que anotó en ellos no se tocan.
        </p>
        <Dropzone
          label={busy ? 'Subiendo…' : `Elegir el Excel de ${member.displayName}`}
          hint=".xlsx, hasta 10 MB"
          disabled={disabled}
          onFile={(file) =>
            void act(async () => {
              const result = await api.uploadMemberProgram(member.id, file);
              return result.created
                ? `Plan «${result.name}» subido a ${member.displayName}.`
                : `${member.displayName} ya tenía ese mismo archivo: no se ha duplicado.`;
            })
          }
        />
      </section>

      <section aria-labelledby="programs-title">
        <h3 id="programs-title" className="eyebrow mb-2 block px-1">
          Sus planes
        </h3>
        {programs.length === 0 ? (
          <p className="rounded-2xl border border-iron-800 bg-iron-900 px-4 py-6 text-center text-sm text-iron-400">
            Todavía no tiene ningún plan.
          </p>
        ) : (
          <ul className="space-y-2">
            {programs.map((program, index) => (
              <li key={program.id} className="rounded-2xl border border-iron-800 bg-iron-900 p-4">
                <div className="flex items-baseline gap-2">
                  <h4 className="min-w-0 flex-1 truncate font-semibold text-chalk">{program.name}</h4>
                  {index === 0 ? (
                    <span className="shrink-0 rounded-full bg-signal-500/20 px-2 py-0.5 text-xs font-semibold text-signal-300">
                      El que abre
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-iron-400">
                  {program.weekCount} {program.weekCount === 1 ? 'semana' : 'semanas'} ·{' '}
                  {program.completedDays} de {program.dayCount} sesiones completadas ·{' '}
                  {shortDate(program.importedAt)}
                  {program.assignedBy ? ` · subido por ${program.assignedBy}` : ''}
                </p>
                <div className="mt-3 flex gap-2">
                  <a
                    href={api.memberProgramExportUrl(member.id, program.id)}
                    download
                    className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-iron-700 px-3 text-sm font-semibold text-iron-100 hover:bg-iron-800"
                  >
                    <Icon name="upload" size={16} className="rotate-180" />
                    Descargar su progreso
                  </a>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      const message =
                        `¿Borrar «${program.name}» de ${member.displayName}?\n\n` +
                        'Se eliminan también todas las series y sesiones que anotó en ese plan. ' +
                        'No se puede deshacer.';
                      if (confirm(message)) {
                        void act(async () => {
                          await api.deleteMemberProgram(member.id, program.id);
                          return 'Plan borrado.';
                        });
                      }
                    }}
                    className="min-h-11 rounded-xl px-3 text-sm font-semibold text-iron-400 hover:bg-effort-500/10 hover:text-effort-300 disabled:opacity-40"
                  >
                    Borrar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="role-title" className="rounded-2xl border border-iron-800 bg-iron-900 p-4">
        <h3 id="role-title" className="mb-1 font-semibold text-chalk">
          Rol
        </h3>
        <p className="mb-3 text-sm text-iron-400">
          {member.owner
            ? 'Es la cuenta propietaria del gimnasio: administra siempre y no se puede cambiar desde aquí.'
            : isSelf
              ? 'Tu propio rol no se cambia desde aquí, para que nadie se quede fuera por error.'
              : member.role === 'admin'
                ? 'Administra el gimnasio: ve a todos los socios, les sube planes y gestiona las clases.'
                : 'Socio: entrena, ve sus planes y reserva clases.'}
        </p>
        {canChangeRole ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const makeAdmin = member.role !== 'admin';
              const message = makeAdmin
                ? `¿Hacer administrador a ${member.displayName}? Podrá ver a todos los socios, subirles planes y gestionar las clases.`
                : `¿Quitar a ${member.displayName} el rol de administrador?`;
              if (!confirm(message)) return;
              void act(async () => {
                await api.setMemberRole(member.id, makeAdmin ? 'admin' : 'member');
                return makeAdmin
                  ? `${member.displayName} ya es administrador.`
                  : `${member.displayName} vuelve a ser socio.`;
              });
            }}
            className="flex min-h-11 items-center rounded-xl border border-iron-700 px-4 text-sm font-semibold text-iron-100 hover:bg-iron-850 disabled:opacity-40"
          >
            {member.role === 'admin' ? 'Quitar rol de administrador' : 'Hacer administrador'}
          </button>
        ) : null}
      </section>
    </div>
  );
}

function FeeSection({
  member,
  disabled,
  onSave,
}: {
  member: MemberSummary;
  disabled: boolean;
  onSave: (paidUntil: string | null) => void;
}) {
  const [date, setDate] = useState(member.paidUntil ?? '');
  const today = gymToday();
  const expired = member.paidUntil !== null && member.paidUntil < today;

  return (
    <section aria-labelledby="fee-title" className="rounded-2xl border border-iron-800 bg-iron-900 p-4">
      <h3 id="fee-title" className="mb-1 font-semibold text-chalk">
        Cuota
      </h3>
      <p className={`mb-3 text-sm ${expired ? 'font-semibold text-effort-300' : 'text-iron-400'}`}>
        {member.paidUntil
          ? `${expired ? 'Vencida: estaba pagada' : 'Pagada'} hasta el ${longDate(member.paidUntil)}.${
              expired ? ' No puede reservar clases hasta que la renueves.' : ''
            }`
          : 'Sin control de cuota: puede reservar siempre.'}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            const next = plusOneMonth(member.paidUntil);
            setDate(next);
            onSave(next);
          }}
          className="min-h-11 rounded-xl bg-signal-500 px-4 text-sm font-semibold text-iron-950 hover:bg-signal-400 disabled:opacity-40"
        >
          +1 mes
        </button>
        <label className="flex-1 space-y-1">
          <span className="eyebrow block">Pagada hasta</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="w-full rounded-lg border border-iron-700 bg-iron-850 px-3 py-2.5 text-chalk focus:border-signal-400 focus:outline-none"
          />
        </label>
        <button
          type="button"
          disabled={disabled || date === '' || date === member.paidUntil}
          onClick={() => onSave(date)}
          className="min-h-11 rounded-xl border border-iron-700 px-4 text-sm font-semibold text-iron-100 hover:bg-iron-850 disabled:opacity-40"
        >
          Guardar
        </button>
      </div>
      {member.paidUntil ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setDate('');
            onSave(null);
          }}
          className="mt-2 min-h-10 rounded-lg px-2 text-sm font-semibold text-iron-400 hover:bg-iron-850 disabled:opacity-40"
        >
          No controlar su cuota
        </button>
      ) : null}
    </section>
  );
}
