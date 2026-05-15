import React, { useState } from 'react';
import { Modal } from './Modal.js';
import { DiffPreview } from './DiffPreview.js';

/**
 * Three-way conflict dialog used when an external edit lands between
 * form-open and save (R12).
 *
 * Choices:
 * - Verwerfen: drop the UI's pending changes, close the form, show the
 *   on-disk version on next open.
 * - Neu laden: pull the latest on-disk content into the form, discarding
 *   any pending edits.
 * - Side-by-Side: open an inline two-pane view (current vs. operator's edit)
 *   so the operator can manually reconcile before re-saving.
 */
export interface ConflictDialogProps {
  open: boolean;
  /** Operator's working content (what they tried to save). */
  localContent: string;
  /** Current on-disk content (what the server has). */
  remoteContent: string;
  onDiscard: () => void;
  onReload: () => void;
  /** Optional: invoked when the operator picks side-by-side and finishes review. */
  onClose: () => void;
}

export function ConflictDialog({
  open,
  localContent,
  remoteContent,
  onDiscard,
  onReload,
  onClose,
}: ConflictDialogProps) {
  const [showSideBySide, setShowSideBySide] = useState(false);

  return (
    <Modal
      open={open}
      onClose={onClose}
      mustConfirm
      ariaLabel="Konflikt mit externer Änderung"
      containerClassName="w-[900px] max-w-[95vw] bg-zinc-900 rounded-xl shadow-2xl border border-amber-900 overflow-hidden flex flex-col"
    >
      <div className="px-4 py-3 border-b border-zinc-800 bg-amber-950/40">
        <h3 className="text-sm font-semibold text-amber-200">
          Externe Änderung erkannt
        </h3>
        <p className="text-xs text-amber-300/80 mt-1">
          Die Datei wurde verändert, seit du dieses Formular geöffnet hast.
        </p>
      </div>

      {!showSideBySide ? (
        <div className="px-4 py-6 text-sm text-zinc-300 space-y-3">
          <p>
            Du kannst die externe Version übernehmen (deine Änderungen gehen verloren),
            die externe Version neu laden (Formular wird gefüllt mit aktuellem Stand),
            oder beide Versionen Side-by-Side ansehen.
          </p>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-2 gap-px bg-zinc-800 min-h-[300px]">
          <div className="bg-zinc-900 flex flex-col">
            <div className="px-3 py-2 text-xs font-semibold text-zinc-400 border-b border-zinc-800">
              Aktueller Stand (auf Disk)
            </div>
            <pre className="flex-1 overflow-auto bg-zinc-950 text-xs font-mono p-3 m-0 leading-relaxed text-zinc-300">
              {remoteContent}
            </pre>
          </div>
          <div className="bg-zinc-900 flex flex-col">
            <div className="px-3 py-2 text-xs font-semibold text-zinc-400 border-b border-zinc-800">
              Deine ungespeicherten Änderungen
            </div>
            <pre className="flex-1 overflow-auto bg-zinc-950 text-xs font-mono p-3 m-0 leading-relaxed text-zinc-300">
              {localContent}
            </pre>
          </div>
        </div>
      )}

      <div className="border-t border-zinc-800 px-4 py-3 flex gap-2 justify-between">
        <button
          type="button"
          onClick={() => setShowSideBySide((s) => !s)}
          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
        >
          {showSideBySide ? 'Side-by-Side schließen' : 'Side-by-Side ansehen'}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDiscard}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-red-900 text-zinc-300 hover:text-red-200"
          >
            Verwerfen
          </button>
          <button
            type="button"
            onClick={onReload}
            className="text-xs px-3 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-zinc-100 font-medium"
          >
            Neu laden
          </button>
        </div>
      </div>
    </Modal>
  );
}
