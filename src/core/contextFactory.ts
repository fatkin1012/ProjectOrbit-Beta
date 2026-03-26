import type { IAppContext } from '@toolbox/sdk';
import { sharedEventBus } from './eventBus';
import { createStorageProxy } from './storageManager';

export function createAppContext(pluginId: string): IAppContext {
  return {
    storage: createStorageProxy(pluginId),
    eventBus: sharedEventBus,
    theme: 'system',
    initialConfig: {
      pluginId,
      host: 'ProjectOrbit-Beta'
    }
  };
}
