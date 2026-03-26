import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { IDataEnvelope, IStorageProxy } from '@toolbox/sdk';

interface ToolboxDBSchema extends DBSchema {
  kv: {
    key: string;
    value: IDataEnvelope<unknown>;
  };
  pluginCode: {
    key: string;
    value: {
      code: string;
      updatedAt: number;
    };
  };
}

const DB_NAME = 'toolbox-host-db';
const DB_VERSION = 1;
const KV_STORE = 'kv';
const CODE_STORE = 'pluginCode';

let dbPromise: Promise<IDBPDatabase<ToolboxDBSchema>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<ToolboxDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(KV_STORE)) {
          db.createObjectStore(KV_STORE);
        }

        if (!db.objectStoreNames.contains(CODE_STORE)) {
          db.createObjectStore(CODE_STORE);
        }
      }
    });
  }

  return dbPromise;
}

function buildStorageKey(pluginId: string, key: string): string {
  return `plugin:${pluginId}:${key}`;
}

function assertValidKey(key: string): void {
  if (!key.trim()) {
    throw new Error('Storage key cannot be empty.');
  }
}

function assertValidVersion(version: string): void {
  if (!version.trim()) {
    throw new Error('Version cannot be empty.');
  }
}

function assertSerializable(payload: unknown): void {
  try {
    JSON.stringify(payload);
  } catch {
    throw new Error('Payload must be JSON-serializable.');
  }
}

function assertEnvelope<T>(envelope: IDataEnvelope<T>, expectedPluginId: string): void {
  if (envelope.type !== 'PERSIST') {
    throw new Error('Envelope type must be PERSIST.');
  }

  if (envelope.pluginId !== expectedPluginId) {
    throw new Error('Envelope pluginId mismatch.');
  }

  if (typeof envelope.timestamp !== 'number' || Number.isNaN(envelope.timestamp)) {
    throw new Error('Envelope timestamp is invalid.');
  }

  assertValidVersion(envelope.version);
}

export function createStorageProxy(pluginId: string): IStorageProxy {
  if (!pluginId.trim()) {
    throw new Error('pluginId cannot be empty when creating a storage proxy.');
  }

  return {
    async get<T>(key: string): Promise<T | null> {
      assertValidKey(key);

      const db = await getDb();
      const storageKey = buildStorageKey(pluginId, key);
      const envelope = await db.get(KV_STORE, storageKey);

      if (!envelope) {
        return null;
      }

      assertEnvelope(envelope, pluginId);
      return envelope.payload as T;
    },

    async save<T>(key: string, payload: T, version: string): Promise<void> {
      assertValidKey(key);
      assertValidVersion(version);
      assertSerializable(payload);

      const envelope: IDataEnvelope<T> = {
        pluginId,
        version,
        timestamp: Date.now(),
        type: 'PERSIST',
        payload
      };

      const storageKey = buildStorageKey(pluginId, key);
      const db = await getDb();
      await db.put(KV_STORE, envelope as IDataEnvelope<unknown>, storageKey);
    }
  };
}

export async function savePluginCode(id: string, jsCodeString: string): Promise<void> {
  if (!id.trim()) {
    throw new Error('Plugin id cannot be empty.');
  }

  if (!jsCodeString.trim()) {
    throw new Error('Plugin code cannot be empty.');
  }

  const db = await getDb();
  await db.put(CODE_STORE, { code: jsCodeString, updatedAt: Date.now() }, id);
}

export async function getPluginCode(id: string): Promise<string | null> {
  if (!id.trim()) {
    throw new Error('Plugin id cannot be empty.');
  }

  const db = await getDb();
  const record = await db.get(CODE_STORE, id);
  return record?.code ?? null;
}
