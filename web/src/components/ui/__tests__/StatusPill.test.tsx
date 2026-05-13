import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { StatusPill } from '../StatusPill';

afterEach(cleanup);

describe('StatusPill', () => {
  const statuses = [
    'idle', 'busy', 'running', 'complete', 'failed', 'needs_review', 'proposed', 'cold',
  ] as const;

  it('renders all status variants without error', () => {
    for (const status of statuses) {
      const { container, unmount } = render(<StatusPill status={status} />);
      expect(container.firstChild).toBeTruthy();
      unmount();
    }
  });

  it('renders needs_review label as "needs review"', () => {
    const { getByText } = render(<StatusPill status="needs_review" />);
    expect(getByText('needs review')).toBeTruthy();
  });

  it('renders complete with emerald color class', () => {
    const { container } = render(<StatusPill status="complete" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('emerald');
  });

  it('renders failed with red color class', () => {
    const { container } = render(<StatusPill status="failed" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('red');
  });

  it('applies extra className', () => {
    const { container } = render(<StatusPill status="idle" className="extra-class" />);
    expect((container.firstChild as HTMLElement).className).toContain('extra-class');
  });
});
