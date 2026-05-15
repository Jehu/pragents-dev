import React, { useEffect, useState } from 'react';
import { ChatConfig } from '@pragents/schema/config';

export interface ChatFormValues {
  classifierModel?: string;
  classifierThreshold: number;
}

export interface ChatFormProps {
  initial: Partial<ChatFormValues> | null;
  busy?: boolean;
  onChange: (values: ChatFormValues, valid: boolean) => void;
}

export function ChatForm({ initial, busy, onChange }: ChatFormProps) {
  const [model, setModel] = useState<string>(initial?.classifierModel ?? '');
  const [threshold, setThreshold] = useState<number>(
    initial?.classifierThreshold ?? 0.7,
  );

  useEffect(() => {
    setModel(initial?.classifierModel ?? '');
    setThreshold(initial?.classifierThreshold ?? 0.7);
  }, [initial?.classifierModel, initial?.classifierThreshold]);

  useEffect(() => {
    const candidate: ChatFormValues = {
      classifierThreshold: threshold,
    };
    if (model.trim()) candidate.classifierModel = model.trim();
    const parsed = ChatConfig.safeParse(candidate);
    onChange(candidate, parsed.success);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, threshold]);

  const thresholdError =
    !Number.isFinite(threshold) || threshold < 0 || threshold > 1
      ? 'Threshold must be between 0 and 1'
      : null;

  return (
    <div className="space-y-4 max-w-xl">
      <label className="block">
        <span className="block text-xs font-medium text-zinc-300 mb-1">
          Classifier model (optional)
        </span>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={busy}
          aria-label="Classifier model"
          placeholder="e.g. anthropic/claude-haiku-3-5-20241022"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
        />
        <span className="block text-[11px] text-zinc-500 mt-1">
          Overrides the fast model used by the IntentClassifier. Empty falls back to the first agent's model.
        </span>
      </label>

      <label className="block">
        <span className="block text-xs font-medium text-zinc-300 mb-1">
          Classifier confidence threshold ({threshold.toFixed(2)})
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={Number.isFinite(threshold) ? threshold : 0.7}
          onChange={(e) => setThreshold(Number(e.target.value))}
          disabled={busy}
          aria-label="Classifier threshold"
          aria-invalid={!!thresholdError}
          className="w-full"
        />
        {thresholdError ? (
          <span role="alert" className="block text-[11px] text-red-400 mt-1">
            {thresholdError}
          </span>
        ) : (
          <span className="block text-[11px] text-zinc-500 mt-1">
            Below this score, the chat router falls back to the full agent path.
          </span>
        )}
      </label>
    </div>
  );
}
