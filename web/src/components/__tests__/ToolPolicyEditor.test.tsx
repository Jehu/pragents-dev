import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { ToolPolicyEditor, buildToolsPayload, KNOWN_TOOLS } from '../ToolPolicyEditor.js';

afterEach(cleanup);

describe('buildToolsPayload', () => {
  it('returns undefined for an empty policy (= all tools permitted)', () => {
    expect(buildToolsPayload({ allow: [], deny: [] })).toBeUndefined();
  });

  it('omits empty lists from the payload', () => {
    expect(buildToolsPayload({ allow: [], deny: ['approve_gate'] })).toEqual({ deny: ['approve_gate'] });
    expect(buildToolsPayload({ allow: ['query_tasks'], deny: [] })).toEqual({ allow: ['query_tasks'] });
  });

  it('keeps both lists when both are set', () => {
    expect(buildToolsPayload({ allow: ['query_tasks'], deny: ['approve_gate'] })).toEqual({
      allow: ['query_tasks'],
      deny: ['approve_gate'],
    });
  });
});

describe('ToolPolicyEditor', () => {
  it('renders existing tags and removes one on ×', () => {
    let value = { allow: ['query_tasks'], deny: ['approve_gate'] };
    const { getByText, getByLabelText } = render(
      <ToolPolicyEditor value={value} onChange={(next) => (value = next)} idPrefix="t" />,
    );
    expect(getByText('query_tasks')).toBeTruthy();
    expect(getByText('approve_gate')).toBeTruthy();
    fireEvent.click(getByLabelText('Remove approve_gate from deny list'));
    expect(value.deny).toEqual([]);
    expect(value.allow).toEqual(['query_tasks']);
  });

  it('adds a tag on Enter and dedupes', () => {
    let value: { allow: string[]; deny: string[] } = { allow: [], deny: [] };
    const { getByLabelText, rerender } = render(
      <ToolPolicyEditor value={value} onChange={(next) => (value = next)} idPrefix="t" />,
    );
    const denyInput = getByLabelText('Add tool to deny list');
    fireEvent.change(denyInput, { target: { value: 'reject_gate' } });
    fireEvent.keyDown(denyInput, { key: 'Enter' });
    expect(value.deny).toEqual(['reject_gate']);

    rerender(<ToolPolicyEditor value={value} onChange={(next) => (value = next)} idPrefix="t" />);
    const denyInput2 = getByLabelText('Add tool to deny list');
    fireEvent.change(denyInput2, { target: { value: 'reject_gate' } });
    fireEvent.keyDown(denyInput2, { key: 'Enter' });
    expect(value.deny).toEqual(['reject_gate']);
  });

  it('exposes the known M6 tools as datalist suggestions', () => {
    const { container } = render(
      <ToolPolicyEditor value={{ allow: [], deny: [] }} onChange={() => {}} idPrefix="t" />,
    );
    const options = [...container.querySelectorAll('datalist option')].map((o) => o.getAttribute('value'));
    expect(options).toHaveLength(KNOWN_TOOLS.length);
    expect(options).toContain('approve_gate');
  });
});
