import React from 'react';
import { useReportSectionDirty } from './SettingsNav.js';

/**
 * Container for a single settings sub-form on `/settings`. Each section
 * has its own header, body, optional dirty indicator, and Save button —
 * sections save independently so an invalid edit in one form does not
 * block work in the others (R11).
 */
export interface SettingsSectionProps {
  title: string;
  description?: string;
  /** Show a small dot when there are unsaved changes. */
  dirty?: boolean;
  busy?: boolean;
  saveLabel?: string;
  saveDisabled?: boolean;
  onSave?: () => void;
  /** Optional inline error/status banner above the form body. */
  status?: { kind: 'error' | 'success'; message: string } | null;
  /** Optional secondary slot rendered next to the save button. */
  actions?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}

export function SettingsSection({
  title,
  description,
  dirty = false,
  busy = false,
  saveLabel = 'Save',
  saveDisabled = false,
  onSave,
  status,
  actions,
  children,
  testId,
}: SettingsSectionProps) {
  // Report dirty state to the settings nav (no-op outside its provider).
  // The testId doubles as the section's DOM id / anchor target.
  useReportSectionDirty(testId, dirty);

  return (
    <section
      id={testId}
      // scroll-mt keeps anchors clear of the sticky header band; overflow-hidden
      // was dropped because it breaks position:sticky for the header.
      className="bg-zinc-900 border border-zinc-800 rounded-lg mb-4 scroll-mt-4"
      aria-label={title}
      data-testid={testId}
    >
      <header className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 border-b border-zinc-800 bg-zinc-900 rounded-t-lg">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            {title}
            {dirty && (
              <span
                aria-label="Unsaved changes"
                className="w-1.5 h-1.5 rounded-full bg-amber-400"
              />
            )}
          </h2>
          {description && (
            <p className="text-[11px] text-zinc-500 mt-0.5">{description}</p>
          )}
        </div>
        {onSave && (
          <div className="flex gap-2">
            {actions}
            <button
              type="button"
              onClick={onSave}
              disabled={busy || saveDisabled}
              className="text-xs px-3 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-zinc-100 font-medium disabled:opacity-40"
            >
              {busy ? 'Saving…' : saveLabel}
            </button>
          </div>
        )}
      </header>

      {status && (
        <div
          role="alert"
          className={`px-5 py-2 text-xs ${
            status.kind === 'error'
              ? 'bg-red-950/40 text-red-300 border-b border-red-900'
              : 'bg-emerald-950/40 text-emerald-300 border-b border-emerald-900'
          }`}
        >
          {status.message}
        </div>
      )}

      <div className="p-5">{children}</div>
    </section>
  );
}
