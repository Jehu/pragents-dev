import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DiffPreview } from '../DiffPreview.js';

describe('DiffPreview', () => {
  const baseProps = {
    before: 'a\nb',
    after: 'a\nc',
    onConfirm: () => {},
    onCancel: () => {},
  } as const;

  it('shows the loading state with a status role', () => {
    render(<DiffPreview {...baseProps} state="loading" />);
    expect(screen.getByRole('status')).toBeTruthy();
    cleanup();
  });

  it('shows the empty hint and disables Save', () => {
    render(<DiffPreview {...baseProps} state="empty" before="x" after="x" />);
    expect(screen.getByText(/Keine Änderungen/)).toBeTruthy();
    expect(screen.getByText('Speichern').closest('button')?.disabled).toBe(true);
    cleanup();
  });

  it('renders +/- markers in diff state', () => {
    render(<DiffPreview {...baseProps} state="diff" />);
    const removed = Array.from(document.querySelectorAll('div')).find((el) =>
      el.textContent?.startsWith('-'),
    );
    const added = Array.from(document.querySelectorAll('div')).find((el) =>
      el.textContent?.startsWith('+'),
    );
    expect(removed).toBeTruthy();
    expect(added).toBeTruthy();
    cleanup();
  });

  it('renders preservation-warning banner and keeps Save enabled', () => {
    render(
      <DiffPreview
        {...baseProps}
        state="preservation-warning"
        message="Kommentar wird umsortiert"
      />,
    );
    expect(screen.getByText(/Kommentar wird umsortiert/)).toBeTruthy();
    expect(screen.getByText('Speichern').closest('button')?.disabled).toBe(false);
    cleanup();
  });

  it('renders read-failure with retry button and disables Save', () => {
    const onRetry = vi.fn();
    render(
      <DiffPreview {...baseProps} state="read-failure" message="net error" onRetry={onRetry} />,
    );
    expect(screen.getByText(/Konnte aktuellen Dateistand/)).toBeTruthy();
    expect(screen.getByText('Speichern').closest('button')?.disabled).toBe(true);
    fireEvent.click(screen.getByText('Erneut versuchen'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('renders conflict notice and disables Save', () => {
    render(<DiffPreview {...baseProps} state="conflict" />);
    expect(screen.getByText(/Externe Änderung erkannt/)).toBeTruthy();
    expect(screen.getByText('Speichern').closest('button')?.disabled).toBe(true);
    cleanup();
  });

  it('confirm and cancel handlers fire when buttons are clicked', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<DiffPreview {...baseProps} state="diff" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Speichern'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Abbrechen'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
