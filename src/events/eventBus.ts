import type { IEventBus } from '@toolbox/sdk';

type Listener<T = unknown> = (payload: T) => void;

export class EventBus implements IEventBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  emit<T = unknown>(event: string, payload: T): void {
    const handlers = this.listeners.get(event);
    if (!handlers || handlers.size === 0) {
      return;
    }

    handlers.forEach((handler) => {
      try {
        (handler as Listener<T>)(payload);
      } catch (error) {
        console.error(`[EventBus] listener failed for event "${event}"`, error);
      }
    });
  }

  on<T = unknown>(event: string, callback: (payload: T) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    this.listeners.get(event)?.add(callback as Listener);
  }

  off<T = unknown>(event: string, callback: (payload: T) => void): void {
    const handlers = this.listeners.get(event);
    if (!handlers) {
      return;
    }

    handlers.delete(callback as Listener);
    if (handlers.size === 0) {
      this.listeners.delete(event);
    }
  }
}

export const globalEventBus = new EventBus();
