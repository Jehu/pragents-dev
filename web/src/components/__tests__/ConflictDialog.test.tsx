import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ConflictDialog } from '../ConflictDialog.js';

describe('ConflictDialog', () => {
  const baseProps = {
    open: true,
    localContent: 'local',
    remoteContent: 'remote',
    onDiscard: () => {},
    onReload: () => {},
    onClose: () => {},
  };

  it('renders the conflict heading and three primary actions', () => {
    render(<ConflictDialog {...baseProps} />);
    expect(screen.getByText('Externe Änderung erkannt')).toBeTruthy();
    expect(screen.getByText('Verwerfen')).toBeTruthy();
    expect(screen.getByText('Neu laden')).toBeTruthy();
    expect(screen.getByText('Side-by-Side ansehen')).toBeTruthy();
    cleanup();
  });

  it('does not close on Esc (mustConfirm=true) — operator must pick a path', () => {
    const onClose = vi.fn();
    render(<ConflictDialog {...baseProps} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    cleanup();
  });

  it('toggles side-by-side view when the toggle button is clicked', () => {
    render(<ConflictDialog {...baseProps} />);
    expect(screen.queryByText('Deine ungespeicherten Änderungen')).toBeNull();
    fireEvent.click(screen.getByText('Side-by-Side ansehen'));
    expect(screen.getByText('Deine ungespeicherten Änderungen')).toBeTruthy();
    expect(screen.getByText('Aktueller Stand (auf Disk)')).toBeTruthy();
    cleanup();
  });

  it('discard handler fires when Verwerfen is clicked', () => {
    const onDiscard = vi.fn();
    render(<ConflictDialog {...baseProps} onDiscard={onDiscard} />);
    fireEvent.click(screen.getByText('Verwerfen'));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('reload handler fires when Neu laden is clicked', () => {
    const onReload = vi.fn();
    render(<ConflictDialog {...baseProps} onReload={onReload} />);
    fireEvent.click(screen.getByText('Neu laden'));
    expect(onReload).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
