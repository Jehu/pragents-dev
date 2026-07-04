import { describe, it, expect, beforeEach } from 'vitest';
import { useScopeStore } from '../scope';

describe('scope store', () => {
  beforeEach(() => {
    localStorage.clear();
    useScopeStore.setState({ selectedProject: null, selectedAgent: null });
  });

  it('setProject sets the project and resets the agent', () => {
    useScopeStore.getState().setAgent('dev@x');
    useScopeStore.getState().setProject('proj-1');
    expect(useScopeStore.getState().selectedProject).toBe('proj-1');
    expect(useScopeStore.getState().selectedAgent).toBeNull();
  });

  it('persists selectedProject to localStorage', () => {
    useScopeStore.getState().setProject('proj-1');
    const raw = localStorage.getItem('pragents-scope');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.state.selectedProject).toBe('proj-1');
  });

  it('does not persist selectedAgent', () => {
    useScopeStore.getState().setProject('proj-1');
    useScopeStore.getState().setAgent('dev@x');
    const parsed = JSON.parse(localStorage.getItem('pragents-scope')!);
    expect(parsed.state.selectedAgent).toBeUndefined();
  });

  it('setProject(null) clears the scope in localStorage too', () => {
    useScopeStore.getState().setProject('proj-1');
    useScopeStore.getState().setProject(null);
    const parsed = JSON.parse(localStorage.getItem('pragents-scope')!);
    expect(parsed.state.selectedProject).toBeNull();
  });
});
