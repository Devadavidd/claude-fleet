import '@testing-library/jest-dom/vitest';

// jsdom lacks the browser APIs the app leans on. Mocks are intentionally tiny:
// each exposes just enough surface for component tests, plus `_emit` on
// EventSource so SSE-driven suites can push events by name.

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners = new Map<string, Set<(e: MessageEvent) => void>>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }

  addEventListener(name: string, fn: (e: MessageEvent) => void) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(fn);
  }

  removeEventListener(name: string, fn: (e: MessageEvent) => void) {
    this.listeners.get(name)?.delete(fn);
  }

  close() { this.closed = true; }

  /** Test helper: dispatch a named SSE event with a JSON payload. */
  _emit(name: string, data: unknown) {
    for (const fn of this.listeners.get(name) ?? []) {
      fn(new MessageEvent(name, { data: JSON.stringify(data) }));
    }
  }
}

class MockNotification {
  static permission = 'granted';
  static requestPermission = async () => 'granted';
  onclick: (() => void) | null = null;
  constructor(public title: string, public options?: NotificationOptions) {}
}

class MockAudioContext {
  state = 'running';
  destination = {};
  currentTime = 0;
  resume = async () => {};
  createOscillator() {
    return { connect: () => {}, start: () => {}, stop: () => {}, frequency: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, type: 'sine' };
  }
  createGain() {
    return { connect: () => {}, gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, linearRampToValueAtTime: () => {} } };
  }
}

Object.assign(globalThis, {
  EventSource: MockEventSource,
  Notification: MockNotification,
  AudioContext: MockAudioContext,
});

export { MockEventSource };
