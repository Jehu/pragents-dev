import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Modal } from '../Modal.js';

describe('Modal', () => {
  it('does not render when closed', () => {
    render(
      <Modal open={false} onClose={() => {}}>
        <p>hidden</p>
      </Modal>,
    );
    expect(screen.queryByText('hidden')).toBeNull();
    cleanup();
  });

  it('renders with role=dialog and aria-modal=true when open', () => {
    render(
      <Modal open onClose={() => {}} ariaLabel="Test">
        <button>action</button>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Test');
    cleanup();
  });

  it('uses aria-labelledby when provided instead of aria-label', () => {
    render(
      <Modal open onClose={() => {}} ariaLabelledBy="heading-id">
        <h2 id="heading-id">Heading</h2>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-labelledby')).toBe('heading-id');
    expect(dialog.getAttribute('aria-label')).toBeNull();
    cleanup();
  });

  it('Esc closes when mustConfirm is false', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <button>x</button>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('Esc is suppressed when mustConfirm is true', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} mustConfirm>
        <button>x</button>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    cleanup();
  });

  it('backdrop click closes when mustConfirm is false', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <button>x</button>
      </Modal>,
    );
    fireEvent.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('backdrop click is suppressed when mustConfirm is true', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} mustConfirm>
        <button>x</button>
      </Modal>,
    );
    fireEvent.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
    cleanup();
  });

  it('focuses the first focusable element on open', async () => {
    render(
      <Modal open onClose={() => {}}>
        <button>first</button>
        <button>second</button>
      </Modal>,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(document.activeElement?.textContent).toBe('first');
    cleanup();
  });
});
