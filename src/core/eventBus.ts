import type { IEventBus } from '@toolbox/sdk';

type Handler = (payload: unknown) => void;

class EventBus implements IEventBus {
  private listeners = new Map<string, Set<Handler>>();

  emit<T = unknown>(eventName: string, payload: T): void {
    const bucket = this.listeners.get(eventName);
    if (!bucket) {
      return;
    }

    for (const handler of bucket) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[EventBus] Handler for "${eventName}" failed`, error);
      }
    }
  }

  on<T = unknown>(eventName: string, handler: (payload: T) => void): void {
    const bucket = this.listeners.get(eventName) ?? new Set<Handler>();
    bucket.add(handler as Handler);
    this.listeners.set(eventName, bucket);
  }

  off<T = unknown>(eventName: string, handler: (payload: T) => void): void {
    const bucket = this.listeners.get(eventName);
    if (!bucket) {
      return;
    }

    bucket.delete(handler as Handler);
    if (bucket.size === 0) {
      this.listeners.delete(eventName);
    }
  }
}

export const sharedEventBus: IEventBus = new EventBus();
