import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { GoalForm, buildGoalPayload, validateGoalForm, type GoalFormValues } from '../GoalForm.js';

afterEach(cleanup);

const VALID: GoalFormValues = {
  id: 'weekly-article',
  description: 'One article per week',
  cadence: '0 8 * * 1',
  deadline: '',
  workflow: 'content-pipeline',
  acceptance: ['published'],
  human_gates: [{ step: 'after_draft', label: 'Review draft', timeout: '4h' }],
};

describe('buildGoalPayload', () => {
  it('emits required fields and omits empty optionals', () => {
    expect(buildGoalPayload({ ...VALID, acceptance: [], human_gates: [], deadline: '' })).toEqual({
      id: 'weekly-article',
      description: 'One article per week',
      cadence: '0 8 * * 1',
      workflow: 'content-pipeline',
    });
  });

  it('includes deadline, acceptance, and gates when set; drops empty gate timeouts', () => {
    const payload = buildGoalPayload({
      ...VALID,
      deadline: '0 16 * * 5',
      human_gates: [{ step: 's', label: 'l', timeout: '' }],
    });
    expect(payload.deadline).toBe('0 16 * * 5');
    expect(payload.acceptance).toEqual(['published']);
    expect(payload.human_gates).toEqual([{ step: 's', label: 'l' }]);
  });
});

describe('validateGoalForm', () => {
  it('accepts a valid goal', () => {
    expect(validateGoalForm(VALID)).toEqual({});
  });

  it('rejects bad ids, non-cron cadence, and incomplete gates', () => {
    expect(validateGoalForm({ ...VALID, id: '../evil' }).id).toBeTruthy();
    expect(validateGoalForm({ ...VALID, cadence: 'every monday' }).cadence).toBeTruthy();
    expect(validateGoalForm({ ...VALID, human_gates: [{ step: '', label: 'x' }] }).human_gates).toBeTruthy();
    expect(validateGoalForm({ ...VALID, workflow: ' ' }).workflow).toBeTruthy();
  });
});

describe('GoalForm', () => {
  it('blocks submit while required fields are empty', () => {
    const onSubmit = vi.fn();
    const { getByText } = render(<GoalForm onSubmit={onSubmit} />);
    fireEvent.click(getByText('Save'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the entered values', () => {
    const onSubmit = vi.fn();
    const { getByText, getByLabelText } = render(<GoalForm onSubmit={onSubmit} />);
    fireEvent.change(getByLabelText('Goal id'), { target: { value: 'my-goal' } });
    fireEvent.change(getByLabelText('Goal description'), { target: { value: 'desc' } });
    fireEvent.change(getByLabelText('Cadence'), { target: { value: '0 9 * * 1' } });
    fireEvent.change(getByLabelText('Goal workflow'), { target: { value: 'wf-x' } });
    fireEvent.click(getByText('Save'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'my-goal', cadence: '0 9 * * 1', workflow: 'wf-x' }),
    );
  });

  it('disables the id input in edit mode', () => {
    const { getByLabelText } = render(
      <GoalForm initialValues={VALID} editMode onSubmit={() => {}} />,
    );
    expect((getByLabelText('Goal id') as HTMLInputElement).disabled).toBe(true);
  });

  it('shows a live humanized cadence preview', () => {
    const { getByLabelText, getByText } = render(<GoalForm onSubmit={() => {}} />);
    fireEvent.change(getByLabelText('Cadence'), { target: { value: '0 8 * * 1' } });
    expect(getByText('every Monday at 08:00')).toBeTruthy();
  });

  it('warns about a workflow that is not in the registry', () => {
    const { getByLabelText, getByText } = render(
      <GoalForm knownWorkflows={['content-pipeline']} onSubmit={() => {}} />,
    );
    fireEvent.change(getByLabelText('Goal workflow'), { target: { value: 'missing-wf' } });
    expect(getByText(/No workflow named "missing-wf"/)).toBeTruthy();
  });

  it('adds and removes acceptance tags and gate rows', () => {
    const { getByLabelText, getByText, queryByText, queryByTestId } = render(
      <GoalForm onSubmit={() => {}} />,
    );
    const tagInput = getByLabelText('Add acceptance criterion');
    fireEvent.change(tagInput, { target: { value: 'published' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    expect(getByText('published')).toBeTruthy();
    fireEvent.click(getByLabelText('Remove published'));
    expect(queryByText('published')).toBeNull();

    fireEvent.click(getByText('+ Add gate'));
    expect(queryByTestId('gate-row-0')).toBeTruthy();
    fireEvent.click(getByLabelText('Remove gate 1'));
    expect(queryByTestId('gate-row-0')).toBeNull();
  });
});
