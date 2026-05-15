import React, { useMemo } from 'react';

/**
 * State-aware diff preview shown before every config-ui save (R1 + R20).
 *
 * The component is presentational only: callers manage state transitions
 * (typically via `useYamlSave`) and pass `state`, `before`, `after`, plus
 * confirm/cancel handlers.
 *
 * State semantics:
 * - `loading` — current-content read is in flight; spinner + disabled confirm.
 * - `empty` — diff is empty (no behavioural change). Save disabled with hint.
 * - `diff` — standard side-by-side line diff with confirm enabled.
 * - `conflict` — external write detected since open; caller should render
 *   `ConflictDialog` instead, but this state is shown briefly if the
 *   conflict happens while the preview is open.
 * - `read-failure` — the comparison read failed (network, FS error); confirm
 *   disabled, retry surfaced via `onRetry`.
 * - `preservation-warning` — diff is shown, but at least one source element
 *   (comment, anchor) cannot be preserved; confirm remains enabled so the
 *   operator can knowingly proceed.
 */
export type DiffPreviewState =
  | 'loading'
  | 'empty'
  | 'diff'
  | 'conflict'
  | 'read-failure'
  | 'preservation-warning';

export interface DiffPreviewProps {
  state: DiffPreviewState;
  before: string;
  after: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Only consulted in `read-failure` state. */
  onRetry?: () => void;
  /** Optional message surfaced in `read-failure` and `preservation-warning`. */
  message?: string;
}

interface DiffLine {
  kind: 'context' | 'add' | 'remove';
  text: string;
}

/**
 * Tiny line-based diff. Not LCS-optimal; produces a "remove all old lines that
 * differ, then add all new lines" view, which is sufficient for YAML config
 * previews where the operator only needs to see what changed structurally.
 */
function computeDiffLines(before: string, after: string): DiffLine[] {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const lines: DiffLine[] = [];

  const max = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < max; i++) {
    const b = beforeLines[i];
    const a = afterLines[i];
    if (b === a) {
      if (b !== undefined) lines.push({ kind: 'context', text: b });
    } else {
      if (b !== undefined) lines.push({ kind: 'remove', text: b });
      if (a !== undefined) lines.push({ kind: 'add', text: a });
    }
  }
  return lines;
}

export function DiffPreview({
  state,
  before,
  after,
  onConfirm,
  onCancel,
  onRetry,
  message,
}: DiffPreviewProps) {
  const diff = useMemo(() => computeDiffLines(before, after), [before, after]);
  const isEmpty = state === 'empty' || (state === 'diff' && before === after);
  const confirmDisabled =
    state === 'loading' || state === 'empty' || state === 'read-failure' || state === 'conflict';

  return (
    <div className="flex flex-col h-full" data-testid="diff-preview" data-state={state}>
      {state === 'loading' && (
        <div className="flex-1 flex items-center justify-center py-12 text-zinc-400" role="status">
          <span className="text-sm">Loading current file…</span>
        </div>
      )}

      {state === 'read-failure' && (
        <div className="flex-1 px-4 py-6 text-sm text-red-400" role="alert">
          <p className="mb-2 font-medium">Konnte aktuellen Dateistand nicht lesen.</p>
          {message && <p className="text-zinc-400">{message}</p>}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            >
              Erneut versuchen
            </button>
          )}
        </div>
      )}

      {state === 'conflict' && (
        <div className="flex-1 px-4 py-6 text-sm text-amber-400" role="alert">
          Externe Änderung erkannt — siehe Konflikt-Dialog.
        </div>
      )}

      {(state === 'diff' || state === 'preservation-warning' || state === 'empty') && (
        <>
          {state === 'preservation-warning' && (
            <div
              className="px-4 py-2 bg-amber-950/40 border-b border-amber-900 text-xs text-amber-300"
              role="alert"
            >
              {message ??
                'Mindestens ein YAML-Element kann nicht 1:1 erhalten werden — der Save schreibt trotzdem.'}
            </div>
          )}
          <pre className="flex-1 overflow-auto bg-zinc-950 text-xs font-mono p-3 m-0 leading-relaxed">
            {isEmpty ? (
              <span className="text-zinc-500">Keine Änderungen.</span>
            ) : (
              diff.map((line, idx) => (
                <div
                  key={idx}
                  className={
                    line.kind === 'add'
                      ? 'text-emerald-300 bg-emerald-950/30'
                      : line.kind === 'remove'
                        ? 'text-red-300 bg-red-950/30'
                        : 'text-zinc-400'
                  }
                >
                  <span className="select-none mr-2 opacity-50">
                    {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}
                  </span>
                  {line.text || ' '}
                </div>
              ))
            )}
          </pre>
        </>
      )}

      <div className="border-t border-zinc-800 px-4 py-3 flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirmDisabled}
          className="btn-approve text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40"
        >
          Speichern
        </button>
      </div>
    </div>
  );
}
