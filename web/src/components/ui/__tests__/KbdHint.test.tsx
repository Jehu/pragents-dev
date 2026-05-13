import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { KbdHint } from '../KbdHint';

afterEach(cleanup);

describe('KbdHint', () => {
  it('renders single key', () => {
    const { getByText } = render(<KbdHint keys={['⌘']} />);
    expect(getByText('⌘')).toBeTruthy();
  });

  it('renders multiple keys', () => {
    const { getAllByRole } = render(<KbdHint keys={['⌘', 'K']} />);
    // @testing-library doesn't know kbd role, use querySelectorAll
    const { container } = render(<KbdHint keys={['Ctrl', 'P']} />);
    const kbds = container.querySelectorAll('kbd');
    expect(kbds.length).toBe(2);
  });

  it('renders keys as <kbd> elements', () => {
    const { container } = render(<KbdHint keys={['Ctrl', 'P']} />);
    const kbds = container.querySelectorAll('kbd');
    expect(kbds.length).toBe(2);
  });

  it('renders no kbd for empty array', () => {
    const { container } = render(<KbdHint keys={[]} />);
    expect(container.querySelectorAll('kbd').length).toBe(0);
  });
});
