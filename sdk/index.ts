export interface IDataEnvelope<T> {
  pluginId: string;
  version: string;
  timestamp: number;
  type: 'PERSIST';
  payload: T;
}

export interface IStorageProxy {
  get<T>(key: string): Promise<T | null>;
  save<T>(key: string, payload: T, version: string): Promise<void>;
}

export interface IEventBus {
  emit<T = unknown>(eventName: string, payload: T): void;
  on<T = unknown>(eventName: string, handler: (payload: T) => void): void;
  off<T = unknown>(eventName: string, handler: (payload: T) => void): void;
}

export interface IAppContext {
  storage: IStorageProxy;
  eventBus: IEventBus;
  theme: 'light' | 'dark' | 'system';
  initialConfig: Record<string, unknown>;
}

export interface IPlugin {
  id: string;
  name: string;
  version: string;
  mount(container: HTMLElement, context: IAppContext): void | Promise<void>;
  unmount(container: HTMLElement): void | Promise<void>;
}
