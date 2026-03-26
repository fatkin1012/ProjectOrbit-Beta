export type EnvelopeType = 'PERSIST' | 'SYNC' | 'EVENT';

export interface IDataEnvelope<T> {
  pluginId: string;
  version: string;
  timestamp: number;
  type: EnvelopeType;
  payload: T;
}

export interface IStorageProxy {
  get<T = unknown>(key: string): Promise<T | undefined>;
  save<T = unknown>(key: string, payload: T, version: string): Promise<void>;
}

export interface IEventBus {
  emit<T = unknown>(event: string, payload: T): void;
  on<T = unknown>(event: string, callback: (payload: T) => void): void;
  off<T = unknown>(event: string, callback: (payload: T) => void): void;
}

export interface IAppContext {
  storage: IStorageProxy;
  eventBus: IEventBus;
  theme: 'light' | 'dark';
  initialConfig: Record<string, unknown>;
}

export interface IPlugin {
  id: string;
  name: string;
  version: string;
  mount(container: HTMLElement, context: IAppContext): void | Promise<void>;
  unmount(container: HTMLElement): void | Promise<void>;
}
