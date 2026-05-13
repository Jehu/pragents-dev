import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Sparkline } from '../Sparkline';

afterEach(cleanup);

describe('Sparkline', () => {
  it('renders correct number of block chars', () => {
    const { container } = render(<Sparkline data={[1, 2, 3, 4, 5]} />);
    const text = container.textContent ?? '';
    expect(text.length).toBe(5);
  });

  it('renders empty string for empty data', () => {
    const { container } = render(<Sparkline data={[]} />);
    expect(container.textContent).toBe('');
  });

  it('renders all-same values without throwing', () => {
    const { container } = render(<Sparkline data={[5, 5, 5]} />);
    expect(container.textContent?.length).toBe(3);
  });

  it('applies custom color as style property', () => {
    const { container } = render(<Sparkline data={[1, 2]} color="rgb(255, 0, 0)" />);
    const el = container.firstChild as HTMLElement;
    // jsdom normalizes color values
    expect(el.style.color).toMatch(/rgb\(255,?\s*0,?\s*0\)/);
  });
});
