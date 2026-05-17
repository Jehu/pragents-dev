import React, { useEffect, useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useEtagFetch } from '../../hooks/useEtagFetch.js';
import { useSectionSave } from '../../hooks/useSectionSave.js';
import { SettingsSection } from '../../components/SettingsSection.js';
import { PoolForm, type PoolFormValues } from '../../components/PoolForm.js';
import { ChatForm, type ChatFormValues } from '../../components/ChatForm.js';
import {
  InterfacesForm,
  type InterfacesFormValues,
} from '../../components/InterfacesForm.js';
import { CostsForm, type CostsMap } from '../../components/CostsForm.js';
import {
  SkillApprovalForm,
  type SkillApprovalFormValues,
} from '../../components/SkillApprovalForm.js';
import { CompanyForm, type CompanyFormValues } from '../../components/CompanyForm.js';
import {
  CompanyAgentForm,
  buildCompanyAgentPayload,
  type CompanyAgentType,
  type CompanyAgentFormValues,
} from '../../components/CompanyAgentForm.js';
import { ConflictDialog } from '../../components/ConflictDialog.js';

export const Route = createFileRoute('/settings/')({
  component: SettingsPage,
});

interface SettingsSnapshot {
  costs: CostsMap;
  pool: PoolFormValues | null;
  chat: ChatFormValues | null;
  interfaces: InterfacesFormValues | null;
  company: {
    name: string;
    autoApproveSkills?: boolean;
    similarityThreshold?: number;
    skillApproval: SkillApprovalFormValues | null;
    agents: Partial<Record<CompanyAgentType, RawCompanyAgent>>;
  };
}

interface RawCompanyAgent {
  type?: CompanyAgentType;
  model?: string;
  personality?: string;
  capabilities?: string[];
  memory?: {
    company?: 'read' | 'read/write';
    project?: 'read' | 'read/write';
    projects?: { all?: 'read' };
  };
  tokenBudget?: number;
  keepWarm?: boolean;
}

function toCompanyAgentInitial(
  raw: RawCompanyAgent | undefined,
): CompanyAgentFormValues {
  return {
    model: raw?.model ?? '',
    personality: raw?.personality ?? '',
    capabilities: raw?.capabilities ?? [],
    memory: {
      company: raw?.memory?.company ?? 'read/write',
      project: raw?.memory?.project ?? 'none',
      projectsAll: raw?.memory?.projects?.all ?? 'none',
    },
    tokenBudget: raw?.tokenBudget,
    keepWarm: raw?.keepWarm ?? false,
  };
}

/**
 * A "substantive" payload has at least one user-meaningful field set —
 * anything beyond the auto-included `type` + `keepWarm: false` defaults.
 * Used to block silent creation of an empty company-agent slot when the
 * form mounts with no underlying agent block.
 */
function isSubstantiveAgentPayload(p: Record<string, unknown>): boolean {
  // Skip auto-included keys (`type`, default `keepWarm: false`, and the
  // memory default `{company: 'read/write'}` that the form pre-fills for
  // new slots). The operator must have set at least one of model,
  // personality, capabilities, tokenBudget, or explicitly opted into
  // keepWarm for us to consider the agent worth materializing.
  for (const key of Object.keys(p)) {
    if (key === 'type') continue;
    if (key === 'memory') continue;
    if (key === 'keepWarm' && p[key] === false) continue;
    return true;
  }
  return false;
}

const SETTINGS_URL = '/api/v1/settings';

function SettingsPage() {
  const { data, etag, refetch, loading, error } = useEtagFetch<SettingsSnapshot>(
    SETTINGS_URL,
  );

  if (loading && !data) {
    return <div className="p-6 text-xs text-zinc-500">Loading settings…</div>;
  }
  if (error || !data) {
    return (
      <div className="p-6 text-xs text-red-400" role="alert">
        Failed to load settings: {error ? String(error.message) : 'unknown'}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto" data-testid="settings-page">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
          Settings
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          Each section saves independently. External edits to{' '}
          <span className="font-mono text-zinc-400">pragents.yaml</span> surface
          via a conflict dialog.
        </p>
      </header>

      <CompanySectionBlock data={data} etag={etag} onRefresh={refetch} />
      <CompanyAgentBlock
        agentType="office"
        data={data}
        etag={etag}
        onRefresh={refetch}
      />
      <CompanyAgentBlock
        agentType="pm"
        data={data}
        etag={etag}
        onRefresh={refetch}
      />
      <SkillApprovalSectionBlock data={data} etag={etag} onRefresh={refetch} />
      <PoolSectionBlock data={data} etag={etag} onRefresh={refetch} />
      <ChatSectionBlock data={data} etag={etag} onRefresh={refetch} />
      <InterfacesSectionBlock data={data} etag={etag} onRefresh={refetch} />
      <CostsSectionBlock data={data} etag={etag} onRefresh={refetch} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section blocks (one per domain). Each owns its own dirty/valid state and
// the per-section save mutation so an invalid edit in one form does not
// block work in the others.
// ---------------------------------------------------------------------------

interface SectionBlockProps {
  data: SettingsSnapshot;
  etag: string | null;
  onRefresh: () => void;
}

function CompanySectionBlock({ data, etag, onRefresh }: SectionBlockProps) {
  const [values, setValues] = useState<CompanyFormValues | null>(null);
  const [valid, setValid] = useState(true);
  const initial: CompanyFormValues = {
    name: data.company.name,
    autoApproveSkills: data.company.autoApproveSkills,
    similarityThreshold: data.company.similarityThreshold,
  };
  const dirty = values !== null && !shallowEqual(values, initial);

  const save = useSectionSave({
    url: `${SETTINGS_URL}/company`,
    conflictReadUrl: SETTINGS_URL,
    etag,
    onSuccess: () => {
      setValues(null);
      onRefresh();
    },
  });

  return (
    <>
      <SettingsSection
        title="Company"
        description="Top-level company metadata. Agents and skill-approval policy have their own sections below."
        busy={save.busy}
        dirty={dirty}
        saveDisabled={!dirty || !valid}
        onSave={() => values && save.save(values)}
        status={
          save.error
            ? { kind: 'error', message: save.error }
            : save.success
            ? { kind: 'success', message: save.success }
            : null
        }
        testId="section-company"
      >
        <CompanyForm
          initial={initial}
          busy={save.busy}
          onChange={(v, isValid) => {
            setValues(v);
            setValid(isValid);
          }}
        />
      </SettingsSection>
      {save.conflict && (
        <ConflictDialog
          open
          localContent={save.conflict.localContent}
          remoteContent={save.conflict.remoteContent}
          onDiscard={async () => {
            // Drop the operator's pending edits but keep showing the
            // hydrated baseline — no refetch, so the section UI stays
            // exactly where it was before the conflict surfaced.
            save.dismissConflict();
            setValues(null);
          }}
          onReload={async () => {
            // Pull the latest disk content into the section forms,
            // overwriting any pending edits with the new baseline.
            save.dismissConflict();
            setValues(null);
            onRefresh();
          }}
          onClose={() => save.dismissConflict()}
        />
      )}
    </>
  );
}

function CompanyAgentBlock({
  agentType,
  data,
  etag,
  onRefresh,
}: SectionBlockProps & {
  agentType: CompanyAgentType;
}) {
  const raw = data.company.agents[agentType];
  // Both `initial` (form hydration) and `initialPayload` (dirty-comparison
  // baseline) come from the same canonical `toCompanyAgentInitial` so the
  // form's first emit after hydration is byte-equal to the baseline — that
  // way Save stays disabled until the user actually changes something.
  const initial = useMemo(() => toCompanyAgentInitial(raw), [raw]);
  const initialPayload = useMemo(
    () => buildCompanyAgentPayload(initial, agentType),
    [initial, agentType],
  );
  const [payload, setPayload] = useState<Record<string, unknown>>(initialPayload);
  const [valid, setValid] = useState(true);
  // Re-baseline when the snapshot changes (refetch after successful save,
  // external edit applied via Reload, etc.).
  useEffect(() => {
    setPayload(initialPayload);
  }, [initialPayload]);

  const dirty = !shallowEqualPayload(payload, initialPayload);
  const slotExists = raw !== undefined;
  // Refuse Save when the operator's payload would silently mint an empty
  // agent slot (no model, personality, capabilities, etc.) — see review #2.
  const wouldCreateEmptySlot =
    !slotExists && !isSubstantiveAgentPayload(payload);

  const save = useSectionSave({
    url: `${SETTINGS_URL}/company/agents/${agentType}`,
    conflictReadUrl: SETTINGS_URL,
    etag,
    onSuccess: () => onRefresh(),
  });

  return (
    <>
      <SettingsSection
        title={`Company agent — ${agentType}`}
        description={
          agentType === 'office'
            ? 'The office agent handles cross-company chores (mail, calendar, summaries).'
            : 'The PM agent supervises project work, runs goal schedules, and gates approvals.'
        }
        busy={save.busy}
        dirty={dirty}
        saveDisabled={!dirty || !valid || wouldCreateEmptySlot}
        onSave={() => save.save(payload)}
        status={
          save.error
            ? { kind: 'error', message: save.error }
            : save.success
            ? { kind: 'success', message: save.success }
            : !slotExists
            ? {
                kind: 'success',
                message:
                  'No agent configured yet — fill in at least a model or personality to add one.',
              }
            : null
        }
        testId={`section-company-agent-${agentType}`}
      >
        <CompanyAgentForm
          agentType={agentType}
          initial={initial}
          busy={save.busy}
          onChange={(_v, isValid, p) => {
            setPayload(p);
            setValid(isValid);
          }}
        />
      </SettingsSection>
      {save.conflict && (
        <ConflictDialog
          open
          localContent={save.conflict.localContent}
          remoteContent={save.conflict.remoteContent}
          onDiscard={async () => {
            save.dismissConflict();
            setPayload(initialPayload);
          }}
          onReload={async () => {
            save.dismissConflict();
            onRefresh();
          }}
          onClose={() => save.dismissConflict()}
        />
      )}
    </>
  );
}

function SkillApprovalSectionBlock({ data, etag, onRefresh }: SectionBlockProps) {
  const initial = data.company.skillApproval ?? {
    confidenceThreshold: 0.9,
    blockedTools: ['bash', 'write', 'computer'],
  };
  const [values, setValues] = useState<SkillApprovalFormValues | null>(null);
  const [valid, setValid] = useState(true);
  const dirty = values !== null && !shallowEqual(values, initial);

  const save = useSectionSave({
    url: `${SETTINGS_URL}/skill-approval`,
    conflictReadUrl: SETTINGS_URL,
    etag,
    onSuccess: () => {
      setValues(null);
      onRefresh();
    },
  });

  return (
    <>
      <SettingsSection
        title="Skill approval"
        description="Guardrails for the auto-extraction pipeline."
        busy={save.busy}
        dirty={dirty}
        saveDisabled={!dirty || !valid}
        onSave={() => values && save.save(values)}
        status={
          save.error
            ? { kind: 'error', message: save.error }
            : save.success
            ? { kind: 'success', message: save.success }
            : null
        }
        testId="section-skill-approval"
      >
        <SkillApprovalForm
          initial={initial}
          busy={save.busy}
          onChange={(v, isValid) => {
            setValues(v);
            setValid(isValid);
          }}
        />
      </SettingsSection>
      {save.conflict && (
        <ConflictDialog
          open
          localContent={save.conflict.localContent}
          remoteContent={save.conflict.remoteContent}
          onDiscard={async () => {
            // Drop the operator's pending edits but keep showing the
            // hydrated baseline — no refetch, so the section UI stays
            // exactly where it was before the conflict surfaced.
            save.dismissConflict();
            setValues(null);
          }}
          onReload={async () => {
            // Pull the latest disk content into the section forms,
            // overwriting any pending edits with the new baseline.
            save.dismissConflict();
            setValues(null);
            onRefresh();
          }}
          onClose={() => save.dismissConflict()}
        />
      )}
    </>
  );
}

function PoolSectionBlock({ data, etag, onRefresh }: SectionBlockProps) {
  const initial: PoolFormValues = data.pool ?? { maxWarmSessions: 10 };
  const [values, setValues] = useState<PoolFormValues | null>(null);
  const [valid, setValid] = useState(true);
  const dirty = values !== null && values.maxWarmSessions !== initial.maxWarmSessions;

  const save = useSectionSave({
    url: `${SETTINGS_URL}/pool`,
    conflictReadUrl: SETTINGS_URL,
    etag,
    onSuccess: () => {
      setValues(null);
      onRefresh();
    },
  });

  return (
    <>
      <SettingsSection
        title="Session pool"
        description="Capacity cap for pre-spawned agent sessions at boot."
        busy={save.busy}
        dirty={dirty}
        saveDisabled={!dirty || !valid}
        onSave={() => values && save.save(values)}
        status={
          save.error
            ? { kind: 'error', message: save.error }
            : save.success
            ? { kind: 'success', message: save.success }
            : null
        }
        testId="section-pool"
      >
        <PoolForm
          initial={initial}
          busy={save.busy}
          onChange={(v, isValid) => {
            setValues(v);
            setValid(isValid);
          }}
        />
      </SettingsSection>
      {save.conflict && (
        <ConflictDialog
          open
          localContent={save.conflict.localContent}
          remoteContent={save.conflict.remoteContent}
          onDiscard={async () => {
            // Drop the operator's pending edits but keep showing the
            // hydrated baseline — no refetch, so the section UI stays
            // exactly where it was before the conflict surfaced.
            save.dismissConflict();
            setValues(null);
          }}
          onReload={async () => {
            // Pull the latest disk content into the section forms,
            // overwriting any pending edits with the new baseline.
            save.dismissConflict();
            setValues(null);
            onRefresh();
          }}
          onClose={() => save.dismissConflict()}
        />
      )}
    </>
  );
}

function ChatSectionBlock({ data, etag, onRefresh }: SectionBlockProps) {
  const initial: ChatFormValues = data.chat ?? { classifierThreshold: 0.7 };
  const [values, setValues] = useState<ChatFormValues | null>(null);
  const [valid, setValid] = useState(true);
  const dirty = values !== null && !shallowEqual(values, initial);

  const save = useSectionSave({
    url: `${SETTINGS_URL}/chat`,
    conflictReadUrl: SETTINGS_URL,
    etag,
    onSuccess: () => {
      setValues(null);
      onRefresh();
    },
  });

  return (
    <>
      <SettingsSection
        title="Chat router"
        description="IntentClassifier tuning for the chat endpoint."
        busy={save.busy}
        dirty={dirty}
        saveDisabled={!dirty || !valid}
        onSave={() => values && save.save(values)}
        status={
          save.error
            ? { kind: 'error', message: save.error }
            : save.success
            ? { kind: 'success', message: save.success }
            : null
        }
        testId="section-chat"
      >
        <ChatForm
          initial={initial}
          busy={save.busy}
          onChange={(v, isValid) => {
            setValues(v);
            setValid(isValid);
          }}
        />
      </SettingsSection>
      {save.conflict && (
        <ConflictDialog
          open
          localContent={save.conflict.localContent}
          remoteContent={save.conflict.remoteContent}
          onDiscard={async () => {
            // Drop the operator's pending edits but keep showing the
            // hydrated baseline — no refetch, so the section UI stays
            // exactly where it was before the conflict surfaced.
            save.dismissConflict();
            setValues(null);
          }}
          onReload={async () => {
            // Pull the latest disk content into the section forms,
            // overwriting any pending edits with the new baseline.
            save.dismissConflict();
            setValues(null);
            onRefresh();
          }}
          onClose={() => save.dismissConflict()}
        />
      )}
    </>
  );
}

function InterfacesSectionBlock({ data, etag, onRefresh }: SectionBlockProps) {
  const initial: InterfacesFormValues = data.interfaces ?? {
    web: { port: 3000, host: 'localhost' },
  };
  const [values, setValues] = useState<InterfacesFormValues | null>(null);
  const [valid, setValid] = useState(true);
  const dirty =
    values !== null &&
    (values.web.port !== initial.web.port || values.web.host !== initial.web.host);

  const save = useSectionSave({
    url: `${SETTINGS_URL}/interfaces`,
    conflictReadUrl: SETTINGS_URL,
    etag,
    onSuccess: () => {
      setValues(null);
      onRefresh();
    },
  });

  return (
    <>
      <SettingsSection
        title="Web interface"
        description="Port and host the server binds when started. Requires a restart to take effect."
        busy={save.busy}
        dirty={dirty}
        saveDisabled={!dirty || !valid}
        onSave={() => values && save.save(values)}
        status={
          save.error
            ? { kind: 'error', message: save.error }
            : save.success
            ? { kind: 'success', message: save.success }
            : null
        }
        testId="section-interfaces"
      >
        <InterfacesForm
          initial={initial}
          busy={save.busy}
          onChange={(v, isValid) => {
            setValues(v);
            setValid(isValid);
          }}
        />
      </SettingsSection>
      {save.conflict && (
        <ConflictDialog
          open
          localContent={save.conflict.localContent}
          remoteContent={save.conflict.remoteContent}
          onDiscard={async () => {
            // Drop the operator's pending edits but keep showing the
            // hydrated baseline — no refetch, so the section UI stays
            // exactly where it was before the conflict surfaced.
            save.dismissConflict();
            setValues(null);
          }}
          onReload={async () => {
            // Pull the latest disk content into the section forms,
            // overwriting any pending edits with the new baseline.
            save.dismissConflict();
            setValues(null);
            onRefresh();
          }}
          onClose={() => save.dismissConflict()}
        />
      )}
    </>
  );
}

function CostsSectionBlock({ data, etag, onRefresh }: SectionBlockProps) {
  const initial = data.costs ?? {};
  const [values, setValues] = useState<CostsMap | null>(null);
  const [valid, setValid] = useState(true);
  const dirty = values !== null && !mapsEqual(values, initial);

  const save = useSectionSave({
    url: `${SETTINGS_URL}/costs`,
    conflictReadUrl: SETTINGS_URL,
    etag,
    onSuccess: () => {
      setValues(null);
      onRefresh();
    },
  });

  return (
    <>
      <SettingsSection
        title="Model costs"
        description="Per-million-token in/out rates used by the cost tracker."
        busy={save.busy}
        dirty={dirty}
        saveDisabled={!dirty || !valid}
        onSave={() => values && save.save(values)}
        status={
          save.error
            ? { kind: 'error', message: save.error }
            : save.success
            ? { kind: 'success', message: save.success }
            : null
        }
        testId="section-costs"
      >
        <CostsForm
          initial={initial}
          busy={save.busy}
          onChange={(v, isValid) => {
            setValues(v);
            setValid(isValid);
          }}
        />
      </SettingsSection>
      {save.conflict && (
        <ConflictDialog
          open
          localContent={save.conflict.localContent}
          remoteContent={save.conflict.remoteContent}
          onDiscard={async () => {
            // Drop the operator's pending edits but keep showing the
            // hydrated baseline — no refetch, so the section UI stays
            // exactly where it was before the conflict surfaced.
            save.dismissConflict();
            setValues(null);
          }}
          onReload={async () => {
            // Pull the latest disk content into the section forms,
            // overwriting any pending edits with the new baseline.
            save.dismissConflict();
            setValues(null);
            onRefresh();
          }}
          onClose={() => save.dismissConflict()}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tiny equality helpers (shallow object + costs map). The forms compare
// against their hydrated initial snapshot to decide if Save should light up.
// ---------------------------------------------------------------------------

function shallowEqual(a: object, b: object): boolean {
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    const av = ao[k];
    const bv = bo[k];
    if (Array.isArray(av) && Array.isArray(bv)) {
      if (av.length !== bv.length) return false;
      for (let i = 0; i < av.length; i++) {
        if (av[i] !== bv[i]) return false;
      }
    } else if (av !== bv) {
      return false;
    }
  }
  return true;
}

/**
 * Deep-equal comparison for agent payloads (`{ type, model, memory: {...},
 * capabilities: [...] }`). Used by the company-agent block to baseline
 * dirty-detection against the hydrated initial — a strict reference check
 * would always flag dirty because the form rebuilds the payload object on
 * every render. JSON-stringify is good enough here: payload values are all
 * primitives, arrays of strings, or shallow object maps; key order is
 * stable because both sides come from the same `buildCompanyAgentPayload`.
 */
function shallowEqualPayload(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mapsEqual(a: CostsMap, b: CostsMap): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!(k in b)) return false;
    if (a[k].in !== b[k].in || a[k].out !== b[k].out) return false;
  }
  return true;
}

