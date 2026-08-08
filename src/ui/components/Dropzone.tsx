import { useCallback, useId, useRef, useState, type DragEvent } from 'react';

interface DropzoneProps {
  onFile: (file: File) => void;
  disabled?: boolean;
  label: string;
  hint?: string;
}

/**
 * File picker that also accepts a drag-and-drop.
 *
 * The drop target is a real `<label>` wrapping a real `<input type="file">`,
 * so keyboard and screen-reader users get the native control for free instead
 * of a div pretending to be a button.
 */
export function Dropzone({ onFile, disabled = false, label, hint }: DropzoneProps) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (disabled) return;

      const file = event.dataTransfer?.files?.[0];
      if (file) onFile(file);
    },
    [disabled, onFile],
  );

  // dragenter/dragleave fire for every child element, so they are counted.
  const handleDragEnter = useCallback((event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  }, []);

  return (
    <label
      htmlFor={inputId}
      onDrop={handleDrop}
      onDragOver={(event) => event.preventDefault()}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      className={[
        'flex min-h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl',
        'border-2 border-dashed px-6 py-10 text-center transition-colors',
        dragging
          ? 'border-accent-400 bg-accent-500/10'
          : 'border-ink-700 bg-ink-900 hover:border-ink-600 hover:bg-ink-850',
        disabled ? 'cursor-progress opacity-60' : '',
      ].join(' ')}
    >
      <span aria-hidden="true" className="text-3xl">
        📄
      </span>
      <span className="text-base font-semibold text-ink-50">{label}</span>
      {hint ? <span className="max-w-xs text-sm text-ink-400">{hint}</span> : null}
      <input
        id={inputId}
        type="file"
        accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          // Allow re-selecting the same file after a failed import.
          event.target.value = '';
        }}
      />
    </label>
  );
}
