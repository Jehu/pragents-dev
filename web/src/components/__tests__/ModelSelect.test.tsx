import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

const SAMPLE = {
  available: [
    {
      reference: 'anthropic/claude-sonnet-4-5',
      provider: 'anthropic',
      id: 'claude-sonnet-4-5',
      name: 'Claude Sonnet 4.5',
      contextWindow: 200000,
      maxTokens: 8192,
      reasoning: true,
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      hasAuth: true,
    },
  ],
  all: [
    {
      reference: 'anthropic/claude-sonnet-4-5',
      provider: 'anthropic',
      id: 'claude-sonnet-4-5',
      name: 'Claude Sonnet 4.5',
      contextWindow: 200000,
      maxTokens: 8192,
      reasoning: true,
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      hasAuth: true,
    },
    {
      reference: 'openai/gpt-5',
      provider: 'openai',
      id: 'gpt-5',
      name: 'GPT-5',
      contextWindow: 400000,
      maxTokens: 16000,
      reasoning: false,
      cost: { input: 5, output: 20, cacheRead: 0.5, cacheWrite: 5 },
      hasAuth: false,
    },
  ],
  error: null,
};

// Inline mock returning a successful query — keeps the test focused on
// ModelSelect's rendering rather than wiring up a real QueryClient + fetch.
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: SAMPLE, isLoading: false, isError: false }),
}));

import { ModelSelect } from '../ModelSelect.js';

afterEach(() => {
  cleanup();
});

describe('ModelSelect', () => {
  it('renders a select with the saved value preselected', () => {
    const onChange = vi.fn();
    render(<ModelSelect value="anthropic/claude-sonnet-4-5" onChange={onChange} />);
    const select = screen.getByLabelText('Model') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(select.value).toBe('anthropic/claude-sonnet-4-5');
  });

  it('marks unauthed models as disabled options', () => {
    render(<ModelSelect value="anthropic/claude-sonnet-4-5" onChange={vi.fn()} />);
    const opt = screen
      .getAllByRole('option')
      .find((o) => (o as HTMLOptionElement).value === 'openai/gpt-5') as HTMLOptionElement;
    expect(opt).toBeDefined();
    expect(opt.disabled).toBe(true);
  });

  it('switches to text input when "Custom…" is picked', () => {
    const onChange = vi.fn();
    render(<ModelSelect value="anthropic/claude-sonnet-4-5" onChange={onChange} />);
    const select = screen.getByLabelText('Model') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '__custom__' } });
    const after = screen.getByLabelText('Model');
    expect(after.tagName).toBe('INPUT');
  });

  it('starts in custom mode when the value is not in the registry', () => {
    render(<ModelSelect value="never-heard-of/this-one" onChange={vi.fn()} />);
    const el = screen.getByLabelText('Model');
    expect(el.tagName).toBe('INPUT');
    expect((el as HTMLInputElement).value).toBe('never-heard-of/this-one');
  });
});
