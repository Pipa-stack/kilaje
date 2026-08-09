import { useEffect, useState } from 'react';

import { parseNumericInput } from '../../domain/mutations';

interface NumberFieldProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  /** Reference value from last week, shown under the field when present. */
  reference?: number | null;
}

/**
 * A large, thumb-friendly numeric input.
 *
 * It keeps its own draft string so intermediate states while typing ("82.",
 * "") do not destroy the stored value, and commits only what parses cleanly.
 * `inputMode="decimal"` brings up the numeric keypad without the styling and
 * scroll-wheel problems of `type="number"`.
 */
export function NumberField({
  label,
  value,
  onChange,
  placeholder = '—',
  min = 0,
  max = 100_000,
  reference = null,
}: NumberFieldProps) {
  const [draft, setDraft] = useState(() => toDraft(value));

  /** Set while the box holds something real that is outside the allowed range. */
  const [rejected, setRejected] = useState(false);

  // Re-sync when the value changes from outside (import, reset, add set).
  useEffect(() => {
    setDraft((current) => (parseNumericInput(current, { min, max }) === value ? current : toDraft(value)));
  }, [max, min, value]);

  return (
    <div className="flex flex-1 flex-col gap-1">
      <input
        type="text"
        inputMode="decimal"
        enterKeyHint="next"
        autoComplete="off"
        aria-label={label}
        aria-invalid={rejected || undefined}
        value={draft}
        placeholder={placeholder}
        className={`field ${value !== null ? 'field-filled' : ''} ${rejected ? 'field-rejected' : ''}`}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const parsed = parseNumericInput(next, { min, max });
          if (parsed !== undefined) onChange(parsed);
          // A number that is out of range parses to undefined and is dropped.
          // Without saying so, the value simply reappears on blur and the user
          // has no idea why what they typed did not stick.
          setRejected(parsed === undefined && next.trim() !== '');
        }}
        onBlur={() => {
          setDraft(toDraft(value));
          setRejected(false);
        }}
      />
      {rejected ? (
        <span role="status" className="text-center text-xs text-effort-300">
          Entre {min} y {max}
        </span>
      ) : reference !== null ? (
        <span className="text-center text-xs text-iron-600" aria-hidden="true">
          {reference}
        </span>
      ) : null}
    </div>
  );
}

function toDraft(value: number | null): string {
  return value === null ? '' : String(value);
}
