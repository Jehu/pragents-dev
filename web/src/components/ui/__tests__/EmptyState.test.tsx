import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { EmptyState } from '../EmptyState';

afterEach(cleanup);

describe('EmptyState', () => {
  it('renders title and description', () => {
    const { getByText } = render(
      <EmptyState icon="📭" title="Nothing here" description="No items to display." />,
    );
    expect(getByText('Nothing here')).toBeTruthy();
    expect(getByText('No items to display.')).toBeTruthy();
  });

  it('renders icon content', () => {
    const { getByText } = render(
      <EmptyState icon={<span>🔍</span>} title="Empty" description="No results." />,
    );
    expect(getByText('🔍')).toBeTruthy();
  });

  it('applies extra className', () => {
    const { container } = render(
      <EmptyState icon="x" title="T" description="D" className="custom-class" />,
    );
    expect((container.firstChild as HTMLElement).className).toContain('custom-class');
  });
});
