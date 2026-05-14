import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { StatusPill } from './components/ui/StatusPill.js';
import { ApprovalCard } from './components/ui/ApprovalCard.js';
import { EmptyState } from './components/ui/EmptyState.js';

afterEach(cleanup);

async function runAxe(container: HTMLElement) {
  const results = await axe.run(container);
  return results.violations;
}

describe('a11y: StatusPill', () => {
  it('has no axe violations for idle status', async () => {
    const { container } = render(<StatusPill status="idle" />);
    const violations = await runAxe(container);
    expect(violations).toHaveLength(0);
  });

  it('has no axe violations for running status', async () => {
    const { container } = render(<StatusPill status="running" />);
    const violations = await runAxe(container);
    expect(violations).toHaveLength(0);
  });

  it('has no axe violations for failed status', async () => {
    const { container } = render(<StatusPill status="failed" />);
    const violations = await runAxe(container);
    expect(violations).toHaveLength(0);
  });

  it('has aria-label attribute', () => {
    const { container } = render(<StatusPill status="busy" />);
    const span = container.querySelector('[aria-label]');
    expect(span).not.toBeNull();
    expect(span?.getAttribute('aria-label')).toBe('busy');
  });
});

describe('a11y: ApprovalCard', () => {
  const makeProps = () => ({
    title: 'Approve deployment',
    body: <span>Deploy to production?</span>,
    onApprove: () => {},
    onReject: () => {},
  });

  it('has no axe violations for plan variant', async () => {
    const { container } = render(<ApprovalCard variant="plan" {...makeProps()} />);
    const violations = await runAxe(container);
    expect(violations).toHaveLength(0);
  });

  it('has no axe violations for gate variant', async () => {
    const { container } = render(<ApprovalCard variant="gate" {...makeProps()} />);
    const violations = await runAxe(container);
    expect(violations).toHaveLength(0);
  });

  it('sets aria-busy when isLoading is true', () => {
    const { container } = render(
      <ApprovalCard variant="plan" {...makeProps()} isLoading={true} />,
    );
    const card = container.firstElementChild;
    expect(card?.getAttribute('aria-busy')).toBe('true');
  });

  it('sets aria-busy false when isLoading is false', () => {
    const { container } = render(
      <ApprovalCard variant="plan" {...makeProps()} isLoading={false} />,
    );
    const card = container.firstElementChild;
    expect(card?.getAttribute('aria-busy')).toBe('false');
  });
});

describe('a11y: EmptyState', () => {
  it('has no axe violations', async () => {
    const { container } = render(
      <EmptyState
        icon="📭"
        title="Nothing here"
        description="There are no items to display."
      />,
    );
    const violations = await runAxe(container);
    expect(violations).toHaveLength(0);
  });
});
