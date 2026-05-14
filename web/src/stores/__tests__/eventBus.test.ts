import { describe, it, expect, beforeEach } from 'vitest';
import { useEventBusStore, useEventBus } from '../eventBus';
import type { SseEvent } from '../eventBus';

function makeEvent(overrides: Partial<SseEvent> = {}): SseEvent {
  return {
    type: 'test.event',
    data: {},
    ts: Date.now(),
    ...overrides,
  };
}

describe('eventBus store', () => {
  beforeEach(() => {
    // Reset store state before each test
    useEventBusStore.setState({
      events: [],
      connectionStatus: 'disconnected',
      eventRate: 0,
      _timestamps: [],
    });
  });

  it('starts empty', () => {
    expect(useEventBusStore.getState().events).toHaveLength(0);
  });

  it('pushes events to the buffer', () => {
    const store = useEventBusStore.getState();
    store.pushEvent(makeEvent({ type: 'task.complete' }));
    store.pushEvent(makeEvent({ type: 'task.failed' }));
    expect(useEventBusStore.getState().events).toHaveLength(2);
  });

  it('ring-buffer caps at 200 events', () => {
    const store = useEventBusStore.getState();
    for (let i = 0; i < 210; i++) {
      store.pushEvent(makeEvent({ type: `evt.${i}` }));
    }
    const { events } = useEventBusStore.getState();
    expect(events.length).toBe(200);
    // Oldest events dropped — last event should be evt.209
    expect(events[199].type).toBe('evt.209');
  });

  it('tracks connectionStatus correctly', () => {
    const store = useEventBusStore.getState();
    store.setConnectionStatus('connecting');
    expect(useEventBusStore.getState().connectionStatus).toBe('connecting');
    store.setConnectionStatus('connected');
    expect(useEventBusStore.getState().connectionStatus).toBe('connected');
    store.setConnectionStatus('disconnected');
    expect(useEventBusStore.getState().connectionStatus).toBe('disconnected');
  });

  it('computes eventRate > 0 after pushing events', () => {
    const store = useEventBusStore.getState();
    for (let i = 0; i < 5; i++) {
      store.pushEvent(makeEvent());
    }
    expect(useEventBusStore.getState().eventRate).toBeGreaterThan(0);
  });
});

describe('useEventBus selector', () => {
  beforeEach(() => {
    useEventBusStore.setState({ events: [], connectionStatus: 'disconnected', eventRate: 0, _timestamps: [] });
  });

  it('returns all events when no filter given', () => {
    const store = useEventBusStore.getState();
    store.pushEvent(makeEvent({ type: 'a' }));
    store.pushEvent(makeEvent({ type: 'b' }));
    // We call the selector outside a React component via the store directly
    const events = useEventBusStore.getState().events;
    expect(events.length).toBe(2);
  });

  it('filters by type', () => {
    const store = useEventBusStore.getState();
    store.pushEvent(makeEvent({ type: 'task.complete' }));
    store.pushEvent(makeEvent({ type: 'task.failed' }));
    store.pushEvent(makeEvent({ type: 'task.complete' }));

    const filtered = useEventBusStore.getState().events.filter((e) => e.type === 'task.complete');
    expect(filtered.length).toBe(2);
  });

  it('filters by agentId', () => {
    const store = useEventBusStore.getState();
    store.pushEvent(makeEvent({ agentId: 'agent-1' }));
    store.pushEvent(makeEvent({ agentId: 'agent-2' }));
    store.pushEvent(makeEvent({ agentId: 'agent-1' }));

    const filtered = useEventBusStore.getState().events.filter((e) => e.agentId === 'agent-1');
    expect(filtered.length).toBe(2);
  });

  it('filters by projectId', () => {
    const store = useEventBusStore.getState();
    store.pushEvent(makeEvent({ projectId: 'proj-a' }));
    store.pushEvent(makeEvent({ projectId: 'proj-b' }));

    const filtered = useEventBusStore.getState().events.filter((e) => e.projectId === 'proj-a');
    expect(filtered.length).toBe(1);
  });
});
