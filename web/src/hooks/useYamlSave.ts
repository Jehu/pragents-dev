import { useCallback, useState } from 'react';
import type { DiffPreviewState } from '../components/DiffPreview.js';

/**
 * Orchestrate the diff-preview-then-save flow used by every form in the
 * config-ui slice. Wraps the network state into a single hook so per-form
 * code only deals with "show preview" / "confirm save" / "cancel" rather
 * than recreating the state machine.
 *
 * Lifecycle:
 *  idle → preview opens (loading) → read current → diff/empty/conflict/read-failure
 *  preview-confirm → put with If-Match → success | conflict | error
 */
export interface YamlSaveOptions<TBody> {
  /** URL that returns the current authoritative content (used for diff baseline + ETag). */
  readUrl: string;
  /** URL the save request hits. */
  writeUrl: string;
  /** HTTP method for the save (defaults to PUT). */
  method?: 'PUT' | 'POST' | 'DELETE';
  /** Body that gets sent on save (typically the form's normalized values). */
  body: TBody;
  /** Operator's last known ETag (from `useEtagFetch` on the read URL). */
  ifMatch: string | null;
  /** Operator's edited content (used as the "after" side of the diff). */
  proposed: string;
  /** Caller's success handler — invoked after the save returns 200/201. */
  onSuccess?: (newEtag: string | null) => void;
  /** Caller's conflict handler — invoked on 412 with the on-disk content. */
  onConflict?: (remoteContent: string, remoteEtag: string | null) => void;
}

export interface YamlSaveState {
  open: boolean;
  state: DiffPreviewState;
  current: string;
  message: string | null;
  openPreview: () => void;
  closePreview: () => void;
  confirm: () => Promise<void>;
}

export function useYamlSave<TBody>(opts: YamlSaveOptions<TBody>): YamlSaveState {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DiffPreviewState>('loading');
  const [current, setCurrent] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const openPreview = useCallback(() => {
    setOpen(true);
    setState('loading');
    setMessage(null);
    setCurrent('');
    fetch(opts.readUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        setCurrent(text);
        setState(text === opts.proposed ? 'empty' : 'diff');
      })
      .catch((err) => {
        setMessage(err instanceof Error ? err.message : String(err));
        setState('read-failure');
      });
  }, [opts.readUrl, opts.proposed]);

  const closePreview = useCallback(() => {
    setOpen(false);
  }, []);

  const confirm = useCallback(async () => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (opts.ifMatch) headers['If-Match'] = opts.ifMatch;
      const res = await fetch(opts.writeUrl, {
        method: opts.method ?? 'PUT',
        headers,
        body: JSON.stringify(opts.body),
      });
      if (res.status === 412) {
        const remoteEtag = res.headers.get('ETag');
        const remoteRead = await fetch(opts.readUrl);
        const remoteText = await remoteRead.text();
        setCurrent(remoteText);
        setState('conflict');
        opts.onConflict?.(remoteText, remoteEtag);
        return;
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      const newEtag = res.headers.get('ETag');
      setOpen(false);
      opts.onSuccess?.(newEtag);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
      setState('read-failure');
    }
  }, [opts]);

  return { open, state, current, message, openPreview, closePreview, confirm };
}
