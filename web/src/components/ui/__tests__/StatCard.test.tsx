import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { StatCard } from '../StatCard';

afterEach(cleanup);

describe('StatCard', () => {
  it('renders label and value', () => {
    const { getByText } = render(<StatCard label="Tasks" value={42} />);
    expect(getByText('Tasks')).toBeTruthy();
    expect(getByText('42')).toBeTruthy();
  });

  it('renders subline when provided', () => {
    const { getByText } = render(<StatCard label="Cost" value="€28" subline="+5% vs last month" />);
    expect(getByText('+5% vs last month')).toBeTruthy();
  });

  it('does not render subline when omitted', () => {
    const { container } = render(<StatCard label="X" value="Y" />);
    // wrapper, label div, value div — no fourth child
    const innerDivs = container.querySelector('div')?.children;
    expect(innerDivs?.length).toBe(2);
  });

  it('applies mono class when mono=true', () => {
    const { container } = render(<StatCard label="X" value="123" mono />);
    const valueEl = container.querySelector('div.font-bold') as HTMLElement;
    expect(valueEl.className).toContain('font-mono');
  });
});
