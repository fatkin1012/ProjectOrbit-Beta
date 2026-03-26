import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { IDataEnvelope, IStorageProxy } from '@toolbox/sdk';

const DB_NAME = 'toolbox-host-db';
const DB_VERSION = 1;
const STORE_NAME = 'plugin-kv';

type PersistEnvelope = IDataEnvelope<unknown>;

interface ToolboxDB extends DBSchema {
  [STORE_NAME]: {
    key: string;
    value: PersistEnvelope;
  };
}

let dbPromise: Promise<IDBPDatabase<ToolboxDB>> | null = null;

function getDB(): Promise<IDBPDatabase<ToolboxDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ToolboxDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      }
    });
  }

  return dbPromise;
}

function makeStorageKey(pluginId: string, key: string): string {
  return `plugin:${pluginId}:${key}`;
}

export function createStorageProxy(pluginId: string): IStorageProxy {
  if (!pluginId) {
    throw new Error('createStorageProxy requires a non-empty pluginId.');
  }

  return {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      const db = await getDB();
      const rawKey = makeStorageKey(pluginId, key);
      const envelope = await db.get(STORE_NAME, rawKey);

      if (!envelope) {
        return undefined;
      }

      if (envelope.pluginId !== pluginId) {
        throw new Error(`Storage isolation breach detected for plugin ${pluginId}.`);
      }

      return envelope.payload as T;
    },

    async save<T = unknown>(key: string, payload: T, version: string): Promise<void> {
      const db = await getDB();
      const rawKey = makeStorageKey(pluginId, key);

      const envelope: IDataEnvelope<T> = {
        pluginId,
        version,
        timestamp: Date.now(),
        type: 'PERSIST',
        payload
      };

      await db.put(STORE_NAME, envelope as PersistEnvelope, rawKey);
    }
  };
}
