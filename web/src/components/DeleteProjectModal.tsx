import React, { useState } from 'react';
import { Modal } from './Modal.js';

/**
 * Confirmation modal for deleting a project (R6 / AE8).
 *
 * On confirm we issue a DELETE; if the server responds 409 with an
 * `activeAgents` array we switch into a `blocked` state and surface the
 * list, keeping the confirm button disabled so the operator must stop
 * the sessions first.
 */
export interface DeleteProjectModalProps {
  open: boolean;
  projectId: string;
  projectName: string;
  /** Snapshot of the currently configured agent types — purely informational. */
  configuredAgents: string[];
  /** Caller supplies the actual DELETE — usually wrapped by useYamlSave. */
  onDelete: () => Promise<DeleteResult>;
  onClose: () => void;
  /**
   * Awaited after a successful DELETE — typically a React-Query cache
   * invalidation + a navigate. Awaiting matters because callers chain
   * async work that should complete before the modal unmounts (else a
   * stale list flashes between close and route change).
   */
  onSuccess?: () => void | Promise<void>;
}

export interface DeleteResult {
  ok: boolean;
  status: number;
  activeAgents?: string[];
  error?: string;
}

type State = 'idle' | 'deleting' | 'blocked' | 'error';

export function DeleteProjectModal({
  open,
  projectId,
  projectName,
  configuredAgents,
  onDelete,
  onClose,
  onSuccess,
}: DeleteProjectModalProps) {
  const [state, setState] = useState<State>('idle');
  const [activeAgents, setActiveAgents] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleConfirm() {
    setState('deleting');
    setErrorMsg(null);
    try {
      const res = await onDelete();
      if (res.ok) {
        // Await the caller's success hook so cache invalidation +
        // navigation finishes before the modal unmounts — without the
        // await, the underlying list briefly re-renders with the just-
        // deleted project still present before the new route takes over.
        await onSuccess?.();
        setState('idle');
        return;
      }
      if (res.status === 409 && res.activeAgents && res.activeAgents.length > 0) {
        setActiveAgents(res.activeAgents);
        setState('blocked');
        return;
      }
      setErrorMsg(res.error ?? `HTTP ${res.status}`);
      setState('error');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }

  function reset() {
    setState('idle');
    setActiveAgents([]);
    setErrorMsg(null);
    onClose();
  }

  const blocked = state === 'blocked';
  const busy = state === 'deleting';

  return (
    <Modal
      open={open}
      onClose={reset}
      ariaLabel={`Delete project ${projectName}`}
      containerClassName="w-[500px] max-w-[90vw] bg-zinc-900 rounded-xl shadow-2xl border border-zinc-700 overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-100">Delete project</h3>
        <p className="text-xs text-zinc-500 mt-1 font-mono">{projectId}</p>
      </div>

      <div className="p-5 space-y-3">
        <p className="text-sm text-zinc-300">
          Delete <span className="font-mono">{projectId}</span> ({projectName})?
          This rewrites <span className="font-mono">pragents.yaml</span>.
        </p>

        {configuredAgents.length > 0 && (
          <div className="text-xs text-zinc-400">
            <div className="mb-1">Configured agents that will be removed:</div>
            <ul className="list-disc pl-5 space-y-0.5" data-testid="configured-agents">
              {configuredAgents.map((a) => (
                <li key={a} className="font-mono text-zinc-300">
                  {a}
                </li>
              ))}
            </ul>
          </div>
        )}

        {blocked && (
          <div
            role="alert"
            data-testid="active-session-block"
            className="bg-red-950/50 border border-red-900 rounded-lg p-3 text-xs text-red-300"
          >
            <div className="font-semibold mb-1">
              Cannot delete: {activeAgents.length} active session
              {activeAgents.length === 1 ? '' : 's'}
            </div>
            <ul className="list-disc pl-5 space-y-0.5">
              {activeAgents.map((a) => (
                <li key={a} className="font-mono">
                  {a}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-red-400/80">
              Stop the sessions on the Agents page, then try again.
            </p>
          </div>
        )}

        {state === 'error' && errorMsg && (
          <div
            role="alert"
            className="bg-red-950/50 border border-red-900 rounded-lg p-3 text-xs text-red-300"
          >
            {errorMsg}
          </div>
        )}
      </div>

      <div className="border-t border-zinc-800 px-5 py-3 flex gap-2 justify-end">
        <button
          type="button"
          onClick={reset}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40"
        >
          Cancel
        </button>
        {(blocked || state === 'error') && (
          <button
            type="button"
            onClick={() => {
              setState('idle');
              setActiveAgents([]);
              setErrorMsg(null);
            }}
            data-testid="retry-delete"
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
          >
            Try again
          </button>
        )}
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy || blocked || state === 'error'}
          aria-disabled={busy || blocked || state === 'error'}
          className="text-xs px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white font-medium disabled:opacity-40"
        >
          {busy ? 'Deleting…' : 'Confirm delete'}
        </button>
      </div>
    </Modal>
  );
}
