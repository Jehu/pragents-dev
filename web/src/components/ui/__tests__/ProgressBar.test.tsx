import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ProgressBar } from '../ProgressBar';

afterEach(cleanup);

describe('ProgressBar', () => {
  function getFill(container: HTMLElement): HTMLElement {
    // ProgressBar renders: wrapper div > fill div
    const wrapper = container.firstChild as HTMLElement;
    return wrapper.firstChild as HTMLElement;
  }

  it('renders with correct width percentage', () => {
    const { container } = render(<ProgressBar value={60} />);
    const fill = getFill(container);
    expect(fill.style.width).toBe('60%');
  });

  it('clamps value below 0 to 0%', () => {
    const { container } = render(<ProgressBar value={-10} />);
    expect(getFill(container).style.width).toBe('0%');
  });

  it('clamps value above 100 to 100%', () => {
    const { container } = render(<ProgressBar value={120} />);
    expect(getFill(container).style.width).toBe('100%');
  });

  it('applies custom color as backgroundColor style', () => {
    const { container } = render(<ProgressBar value={50} color="rgb(255,0,0)" />);
    const fill = getFill(container);
    // jsdom normalizes 'rgb(255,0,0)' to 'rgb(255, 0, 0)'
    expect(fill.style.backgroundColor).toMatch(/rgb\(255,?\s*0,?\s*0\)/);
  });
});
