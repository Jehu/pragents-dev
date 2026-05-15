import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { AgentForm, buildAgentPayload } from '../AgentForm.js';

afterEach(() => {
  cleanup();
});

describe('AgentForm', () => {
  it('renders the type select enabled in create mode', () => {
    render(<AgentForm onSubmit={() => {}} />);
    const select = screen.getByLabelText('Agent type') as HTMLSelectElement;
    expect(select.disabled).toBe(false);
  });

  it('disables the type select in edit mode', () => {
    render(
      <AgentForm
        editMode
        initialValues={{ type: 'seo' }}
        onSubmit={() => {}}
      />,
    );
    const select = screen.getByLabelText('Agent type') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });

  it('adds capabilities via Enter', () => {
    render(<AgentForm onSubmit={() => {}} />);
    const input = screen.getByLabelText('Add capability') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'astro' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('astro')).toBeTruthy();
  });

  it('removes capabilities via the × button', () => {
    render(<AgentForm onSubmit={() => {}} />);
    const input = screen.getByLabelText('Add capability') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'astro-build' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const tagList = screen.getByTestId('capability-tags');
    expect(tagList.textContent).toContain('astro-build');
    const removeBtn = screen.getByRole('button', { name: /remove astro-build/i });
    fireEvent.click(removeBtn);
    const tagListAfter = screen.getByTestId('capability-tags');
    expect(tagListAfter.textContent).not.toContain('astro-build');
  });

  it('blocks submit when tokenBudget is negative', () => {
    render(<AgentForm onSubmit={() => {}} />);
    const tb = screen.getByLabelText('Token budget') as HTMLInputElement;
    fireEvent.change(tb, { target: { value: '-1' } });
    const submit = screen.getByRole('button', { name: /save/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/positive/i)).toBeTruthy();
  });

  it('submits with all values populated', () => {
    const onSubmit = vi.fn();
    render(<AgentForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'anthropic/claude-sonnet-4-5' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const arg = onSubmit.mock.calls[0][0];
    expect(arg.model).toBe('anthropic/claude-sonnet-4-5');
    expect(arg.type).toBeDefined();
  });

  it('keepWarm checkbox flips and flows into onSubmit', () => {
    const onSubmit = vi.fn();
    render(<AgentForm onSubmit={onSubmit} />);
    const keepWarm = screen.getByLabelText('Keep warm') as HTMLInputElement;
    expect(keepWarm.checked).toBe(false);
    fireEvent.click(keepWarm);
    expect(keepWarm.checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSubmit.mock.calls[0][0].keepWarm).toBe(true);
  });

  it('memory radios update form state', () => {
    const onSubmit = vi.fn();
    render(<AgentForm onSubmit={onSubmit} />);
    // Click "read/write" inside the "Project" memory row.
    const projectRow = screen.getByText('Project').parentElement!;
    const projectRW = projectRow.querySelector(
      'input[type="radio"][value="read/write"]',
    ) as HTMLInputElement;
    fireEvent.click(projectRW);
    expect(projectRW.checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSubmit.mock.calls[0][0].memory.project).toBe('read/write');
  });

  it('valid tokenBudget submits and is preserved in payload', () => {
    const onSubmit = vi.fn();
    render(<AgentForm onSubmit={onSubmit} />);
    const tb = screen.getByLabelText('Token budget') as HTMLInputElement;
    fireEvent.change(tb, { target: { value: '200000' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSubmit.mock.calls[0][0].tokenBudget).toBe(200000);
  });

  it('blocks submit when tokenBudget exceeds the schema cap', () => {
    render(<AgentForm onSubmit={() => {}} />);
    const tb = screen.getByLabelText('Token budget') as HTMLInputElement;
    fireEvent.change(tb, { target: { value: String(1e308) } });
    const submit = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
});

describe('buildAgentPayload', () => {
  it('omits empty optional fields and emits memory map only when set', () => {
    const payload = buildAgentPayload({
      type: 'dev',
      model: '',
      personality: '',
      capabilities: [],
      memory: { company: 'none', project: 'none', projectsAll: 'none' },
      keepWarm: false,
    });
    expect(payload.model).toBeUndefined();
    expect(payload.personality).toBeUndefined();
    expect(payload.memory).toBeUndefined();
    expect(payload.capabilities).toBeUndefined();
    expect(payload.type).toBe('dev');
    expect(payload.keepWarm).toBe(false);
  });

  it('emits structured memory payload when access is set', () => {
    const payload = buildAgentPayload({
      type: 'seo',
      capabilities: ['a'],
      memory: { company: 'read', project: 'read/write', projectsAll: 'read' },
      keepWarm: true,
    });
    expect(payload.memory).toEqual({
      company: 'read',
      project: 'read/write',
      projects: { all: 'read' },
    });
    expect(payload.capabilities).toEqual(['a']);
  });
});
