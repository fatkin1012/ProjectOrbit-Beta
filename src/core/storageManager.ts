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

export interface StorageAuditRecord {
  ts: number;
  pluginId: string;
  op: 'get' | 'save';
  key: string;
  ok: boolean;
  detail?: string;
}

const DB_NAME = 'toolbox-host-db';
const DB_VERSION = 1;
const KV_STORE = 'kv';
const CODE_STORE = 'pluginCode';
const STORAGE_AUDIT_LOG_KEY = 'orbit-hub.storage-audit';
const STORAGE_AUDIT_MAX = 200;

let dbPromise: Promise<IDBPDatabase<ToolboxDBSchema>> | null = null;
let dbInitialized = false;

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

// Ensure database is initialized and ready before plugins use storage
export async function ensureStorageReady(): Promise<boolean> {
  try {
    const db = await getDb();
    // Test the DB is working by checking object store names
    if (!db.objectStoreNames.contains(KV_STORE)) {
      throw new Error('KV_STORE object store not found');
    }
    dbInitialized = true;
    console.info('[Storage] Database initialization successful');
    return true;
  } catch (error) {
    console.error('[Storage] Database initialization failed', error);
    dbInitialized = false;
    return false;
  }
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
  if (typeof version !== 'string' || !version.trim()) {
    throw new Error('Version cannot be empty.');
  }
}

function normalizeVersion(version: unknown): string {
  if (typeof version === 'string' && version.trim()) {
    return version;
  }

  return '0.0.0';
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

function extractEnvelopePayload<T>(envelope: IDataEnvelope<unknown>): {
  ok: boolean;
  payload: T | null;
  migratedFromLegacyData: boolean;
} {
  if ('payload' in envelope) {
    const payload = (envelope as IDataEnvelope<T>).payload;

    if (payload === undefined) {
      return { ok: false, payload: null, migratedFromLegacyData: false };
    }

    return { ok: true, payload, migratedFromLegacyData: false };
  }

  const legacyEnvelope = envelope as IDataEnvelope<unknown> & { data?: unknown };
  if ('data' in legacyEnvelope) {
    return {
      ok: true,
      payload: legacyEnvelope.data as T,
      migratedFromLegacyData: true
    };
  }

  return { ok: false, payload: null, migratedFromLegacyData: false };
}

function appendStorageAudit(record: StorageAuditRecord): void {
  try {
    const raw = localStorage.getItem(STORAGE_AUDIT_LOG_KEY);
    const current = raw ? (JSON.parse(raw) as StorageAuditRecord[]) : [];
    const next = [record, ...current].slice(0, STORAGE_AUDIT_MAX);
    localStorage.setItem(STORAGE_AUDIT_LOG_KEY, JSON.stringify(next));
  } catch {
    // swallow audit failures to avoid breaking storage operations
  }
}

export function getStorageAuditRecords(pluginId?: string): StorageAuditRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_AUDIT_LOG_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const filtered = parsed.filter(
      (item): item is StorageAuditRecord =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as StorageAuditRecord).ts === 'number' &&
        typeof (item as StorageAuditRecord).pluginId === 'string' &&
        ((item as StorageAuditRecord).op === 'get' || (item as StorageAuditRecord).op === 'save') &&
        typeof (item as StorageAuditRecord).key === 'string' &&
        typeof (item as StorageAuditRecord).ok === 'boolean'
    );

    if (!pluginId) {
      return filtered;
    }

    return filtered.filter((item) => item.pluginId === pluginId);
  } catch {
    return [];
  }
}

export function clearStorageAuditRecords(): void {
  localStorage.removeItem(STORAGE_AUDIT_LOG_KEY);
}

export async function runStorageProbe(pluginId: string): Promise<{ ok: boolean; message: string }> {
  if (!pluginId.trim()) {
    return { ok: false, message: 'Plugin id is empty.' };
  }

  try {
    const proxy = createStorageProxy(pluginId);
    const probeKey = '__host_probe__';
    const payload = { at: Date.now(), source: 'orbit-hub-probe' };

    await proxy.save(probeKey, payload, '0.0.0');
    const result = await proxy.get<typeof payload>(probeKey);
    const ok = Boolean(result && result.source === payload.source);

    return {
      ok,
      message: ok
        ? 'Probe succeeded. IndexedDB write/read is working.'
        : 'Probe write/read mismatch. Check plugin key usage and payload shape.'
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown probe error.';
    return { ok: false, message: `Probe failed: ${message}` };
  }
}

export function createStorageProxy(pluginId: string): IStorageProxy {
  if (!pluginId.trim()) {
    throw new Error('pluginId cannot be empty when creating a storage proxy.');
  }

  return {
    async get<T>(key: string): Promise<T | null> {
      assertValidKey(key);

      try {
        const db = await getDb();
        const storageKey = buildStorageKey(pluginId, key);
        const envelope = await db.get(KV_STORE, storageKey);

        if (!envelope) {
          appendStorageAudit({ ts: Date.now(), pluginId, op: 'get', key, ok: true, detail: 'MISS' });
          return null;
        }

        try {
          assertEnvelope(envelope, pluginId);
        } catch (error) {
          console.warn(`[Storage] Invalid envelope for ${storageKey}`, error);
          appendStorageAudit({
            ts: Date.now(),
            pluginId,
            op: 'get',
            key,
            ok: false,
            detail: 'Invalid envelope'
          });
          return null;
        }

        const payloadResult = extractEnvelopePayload<T>(envelope);
        if (!payloadResult.ok) {
          appendStorageAudit({
            ts: Date.now(),
            pluginId,
            op: 'get',
            key,
            ok: false,
            detail: 'Envelope has no payload'
          });
          return null;
        }

        if (payloadResult.migratedFromLegacyData) {
          // Normalize old envelope shape that used "data" instead of "payload".
          const migratedEnvelope: IDataEnvelope<T> = {
            pluginId,
            version: normalizeVersion(envelope.version),
            timestamp: typeof envelope.timestamp === 'number' ? envelope.timestamp : Date.now(),
            type: 'PERSIST',
            payload: payloadResult.payload as T
          };

          void db.put(KV_STORE, migratedEnvelope as IDataEnvelope<unknown>, storageKey);
        }

        appendStorageAudit({
          ts: Date.now(),
          pluginId,
          op: 'get',
          key,
          ok: true,
          detail: payloadResult.migratedFromLegacyData ? 'HIT (migrated legacy)' : 'HIT'
        });

        console.info(`[Storage] Get successful for ${pluginId}/${key}`, { 
          dataSize: JSON.stringify(payloadResult.payload).length,
          storageKey 
        });

        return payloadResult.payload;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[Storage] Get failed for ${pluginId}/${key}`, { error: errorMsg });
        appendStorageAudit({
          ts: Date.now(),
          pluginId,
          op: 'get',
          key,
          ok: false,
          detail: `Error: ${errorMsg.slice(0, 100)}`
        });
        return null;
      }
    },

    async save<T>(key: string, payload: T, version: string): Promise<void> {
      assertValidKey(key);
      assertSerializable(payload);

      const normalizedVersion = normalizeVersion(version);

      if (normalizedVersion !== version) {
        console.warn(
          `[Storage] Plugin ${pluginId} did not provide a valid version while saving key "${key}". ` +
            'Falling back to "0.0.0".'
        );
      }

      assertValidVersion(normalizedVersion);

      const envelope: IDataEnvelope<T> = {
        pluginId,
        version: normalizedVersion,
        timestamp: Date.now(),
        type: 'PERSIST',
        payload
      };

      const storageKey = buildStorageKey(pluginId, key);
      try {
        const db = await getDb();
        await db.put(KV_STORE, envelope as IDataEnvelope<unknown>, storageKey);
        appendStorageAudit({ ts: Date.now(), pluginId, op: 'save', key, ok: true });
        console.info(`[Storage] Save successful for ${pluginId}/${key}`, { 
          dataSize: JSON.stringify(envelope).length,
          storageKey
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[Storage] Save failed for ${pluginId}/${key}`, { error: errorMsg, storageKey });
        appendStorageAudit({ 
          ts: Date.now(), 
          pluginId, 
          op: 'save', 
          key, 
          ok: false,
          detail: `Error: ${errorMsg.slice(0, 100)}`
        });
        throw error;
      }
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
