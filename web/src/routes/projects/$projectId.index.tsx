import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Modal } from '../../components/Modal.js';
import {
  AgentForm,
  AGENT_TYPES,
  buildAgentPayload,
  type AgentFormValues,
  type ProjectAgentType,
} from '../../components/AgentForm.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';
import {
  useProjectDetail,
  type RawAgent,
} from './$projectId.js';

export const Route = createFileRoute('/projects/$projectId/')({
  component: ProjectAgentsTab,
});

// Exported so external callers (e.g. test fixtures) and the agent form can
// round-trip an on-disk agent JSON through the form values shape.
export function toAgentFormValues(
  raw: RawAgent | undefined,
  type: ProjectAgentType,
): AgentFormValues {
  return {
    type: raw?.type ?? type,
    role: raw?.role,
    model: raw?.model ?? '',
    personality: raw?.personality ?? '',
    capabilities: raw?.capabilities ?? [],
    memory: {
      company: raw?.memory?.company ?? 'none',
      project: raw?.memory?.project ?? 'none',
      projectsAll: raw?.memory?.projects?.all ?? 'none',
    },
    tokenBudget: raw?.tokenBudget,
    keepWarm: raw?.keepWarm ?? false,
  };
}

interface AgentEditState {
  type: ProjectAgentType;
  isNew: boolean;
}

export function ProjectAgentsTab() {
  const { data, etag, readUrl, refresh } = useProjectDetail();

  const [agentEdit, setAgentEdit] = useState<AgentEditState | null>(null);
  const [agentDelete, setAgentDelete] = useState<ProjectAgentType | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflictState, setConflictState] = useState<{
    localContent: string;
    remoteContent: string;
  } | null>(null);

  const configuredTypes: ProjectAgentType[] = AGENT_TYPES.filter(
    (t) => !!data.agents?.[t],
  );

  async function fetchRemoteForDiff(): Promise<string> {
    try {
      const remote = await fetch(readUrl);
      if (!remote.ok) return '(failed to load current server state)';
      const remoteJson = await remote.json();
      return JSON.stringify(remoteJson, null, 2);
    } catch {
      return '(failed to load current server state)';
    }
  }

  async function saveAgent(values: AgentFormValues, isNew: boolean) {
    setBusy(true);
    setMutationError(null);
    try {
      const payload = buildAgentPayload(values);
      let res: Response;
      if (isNew) {
        res = await fetch(`${readUrl}/agents`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(etag ? { 'If-Match': etag } : {}),
          },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(
          `${readUrl}/agents/${encodeURIComponent(values.type)}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...(etag ? { 'If-Match': etag } : {}),
            },
            body: JSON.stringify(payload),
          },
        );
      }
      if (res.status === 412) {
        const remoteContent = await fetchRemoteForDiff();
        setConflictState({
          localContent: JSON.stringify(payload, null, 2),
          remoteContent,
        });
        return;
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      setAgentEdit(null);
      await refresh();
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteAgent(type: ProjectAgentType) {
    setBusy(true);
    setMutationError(null);
    try {
      const res = await fetch(
        `${readUrl}/agents/${encodeURIComponent(type)}`,
        {
          method: 'DELETE',
          headers: etag ? { 'If-Match': etag } : {},
        },
      );
      if (res.status === 412) {
        const remoteContent = await fetchRemoteForDiff();
        setConflictState({
          localContent: `(delete agent "${type}")`,
          remoteContent,
        });
        return;
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      setAgentDelete(null);
      await refresh();
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {mutationError && (
        <div
          role="alert"
          className="mb-4 bg-red-950/50 border border-red-900 rounded-lg p-3 text-xs text-red-300"
        >
          {mutationError}
        </div>
      )}

      <div className="space-y-3" data-testid="agents-tab">
        {AGENT_TYPES.map((type) => {
          const agent = data.agents?.[type];
          const configured = !!agent;
          return (
            <div
              key={type}
              className="bg-zinc-900 border border-zinc-800 rounded-lg p-4"
              data-testid={`agent-slot-${type}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-zinc-100 font-mono">
                    {type}
                  </div>
                  {configured ? (
                    <div className="text-[11px] text-zinc-500 mt-0.5">
                      {agent?.model || '(no model)'} ·{' '}
                      {(agent?.capabilities?.length ?? 0)} capabilities
                      {agent?.keepWarm ? ' · keep-warm' : ''}
                    </div>
                  ) : (
                    <div className="text-[11px] text-zinc-500 mt-0.5">
                      Not configured
                    </div>
                  )}
                </div>
                <div className="flex gap-1.5">
                  {configured ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setAgentEdit({ type, isNew: false })}
                        className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setAgentDelete(type)}
                        className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-red-900 text-zinc-300 hover:text-red-200"
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAgentEdit({ type, isNew: true })}
                      className="text-[11px] px-2 py-1 rounded bg-indigo-700 hover:bg-indigo-600 text-zinc-100 font-medium"
                    >
                      Add
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {agentEdit && (
        <Modal
          open={!!agentEdit}
          onClose={() => setAgentEdit(null)}
          ariaLabel={`${agentEdit.isNew ? 'Add' : 'Edit'} agent`}
        >
          <div className="px-5 py-3 border-b border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-100">
              {agentEdit.isNew ? 'Add agent' : `Edit ${agentEdit.type} agent`}
            </h3>
          </div>
          <AgentForm
            initialValues={
              agentEdit.isNew
                ? { type: agentEdit.type }
                : toAgentFormValues(data.agents?.[agentEdit.type], agentEdit.type)
            }
            editMode={!agentEdit.isNew}
            defaultType={agentEdit.type}
            takenTypes={agentEdit.isNew ? configuredTypes : []}
            onCancel={() => setAgentEdit(null)}
            onSubmit={(v) => saveAgent(v, agentEdit.isNew)}
            busy={busy}
            submitLabel={agentEdit.isNew ? 'Add agent' : 'Save'}
          />
        </Modal>
      )}

      {agentDelete && (
        <Modal
          open={!!agentDelete}
          onClose={() => setAgentDelete(null)}
          ariaLabel={`Remove ${agentDelete} agent`}
        >
          <div className="px-5 py-4 border-b border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-100">Remove agent</h3>
          </div>
          <div className="p-5 text-sm text-zinc-300">
            Remove the <span className="font-mono">{agentDelete}</span> agent
            from this project?
          </div>
          <div className="border-t border-zinc-800 px-5 py-3 flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setAgentDelete(null)}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => deleteAgent(agentDelete)}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white font-medium disabled:opacity-40"
            >
              {busy ? 'Removing…' : 'Remove agent'}
            </button>
          </div>
        </Modal>
      )}

      {conflictState && (
        <ConflictDialog
          open
          localContent={conflictState.localContent}
          remoteContent={conflictState.remoteContent}
          onDiscard={async () => {
            setConflictState(null);
            setAgentEdit(null);
            setAgentDelete(null);
            await refresh();
          }}
          onReload={async () => {
            setConflictState(null);
            setAgentEdit(null);
            setAgentDelete(null);
            await refresh();
          }}
          onClose={() => setConflictState(null)}
        />
      )}
    </>
  );
}
