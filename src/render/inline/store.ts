export interface InlineStateBus {
  get(id: string): number | string | undefined;
  set(id: string, value: number | string): void;
  subscribe(id: string, listener: (value: number | string) => void): () => void;
}

const buses = new WeakMap<Element, InlineStateBus>();

function createStandaloneBus(): InlineStateBus {
  const state = new Map<string, number | string>();
  const listeners = new Map<string, Set<(value: number | string) => void>>();

  return {
    get(id: string) {
      return state.get(id);
    },
    set(id: string, value: number | string) {
      state.set(id, value);
      const subs = listeners.get(id);
      if (subs) {
        for (const sub of subs) {
          sub(value);
        }
      }
    },
    subscribe(id: string, listener: (value: number | string) => void) {
      let subs = listeners.get(id);
      if (!subs) {
        subs = new Set();
        listeners.set(id, subs);
      }
      subs.add(listener);
      return () => {
        subs?.delete(listener);
      };
    },
  };
}

export function getOrCreateInlineBus(container?: Element | null): InlineStateBus {
  if (!container) return createStandaloneBus();

  let bus = buses.get(container);
  if (!bus) {
    bus = createStandaloneBus();
    buses.set(container, bus);
  }
  return bus;
}
