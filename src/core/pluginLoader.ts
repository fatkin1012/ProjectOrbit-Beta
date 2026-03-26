import type { IPlugin } from '@toolbox/sdk';
import { getPluginCode, savePluginCode } from './storageManager';

type PluginLike = Partial<IPlugin> & Record<string, unknown>;

function isPluginCore(value: unknown): value is PluginLike {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as PluginLike;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.mount === 'function' &&
    typeof candidate.unmount === 'function'
  );
}

function isPlugin(value: unknown): value is IPlugin {
  if (!isPluginCore(value)) {
    return false;
  }

  const candidate = value as PluginLike;
  return typeof candidate.name === 'string' && typeof candidate.version === 'string';
}

function normalizePlugin(value: unknown, fallbackId: string): IPlugin | null {
  if (!isPluginCore(value)) {
    return null;
  }

  const candidate = value as PluginLike;

  return {
    id: candidate.id as string,
    name: typeof candidate.name === 'string' ? candidate.name : candidate.id ?? fallbackId,
    version: typeof candidate.version === 'string' ? candidate.version : '0.0.0',
    mount: candidate.mount as IPlugin['mount'],
    unmount: candidate.unmount as IPlugin['unmount']
  };
}

function getMissingContractFields(value: unknown): string[] {
  if (!value || typeof value !== 'object') {
    return ['id', 'name', 'version', 'mount', 'unmount'];
  }

  const candidate = value as PluginLike;
  const missing: string[] = [];

  if (typeof candidate.id !== 'string') {
    missing.push('id:string');
  }

  if (typeof candidate.name !== 'string') {
    missing.push('name:string');
  }

  if (typeof candidate.version !== 'string') {
    missing.push('version:string');
  }

  if (typeof candidate.mount !== 'function') {
    missing.push('mount:function');
  }

  if (typeof candidate.unmount !== 'function') {
    missing.push('unmount:function');
  }

  return missing;
}

function getObjectKeys(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return '(not an object)';
  }

  const keys = Object.keys(value as Record<string, unknown>);
  return keys.length ? keys.join(', ') : '(no enumerable keys)';
}

function resolvePluginExport(moduleExports: Record<string, unknown>): unknown {
  const candidates: unknown[] = [
    moduleExports.default,
    moduleExports.plugin,
    moduleExports,
    (moduleExports.default as Record<string, unknown> | undefined)?.default,
    (moduleExports.default as Record<string, unknown> | undefined)?.plugin,
    (moduleExports.plugin as Record<string, unknown> | undefined)?.default,
    (moduleExports.plugin as Record<string, unknown> | undefined)?.plugin
  ];

  return candidates.find((candidate) => isPluginCore(candidate)) ?? candidates[0];
}

async function importFromCode(code: string): Promise<Record<string, unknown>> {
  const blob = new Blob([code], { type: 'text/javascript' });
  const objectUrl = URL.createObjectURL(blob);

  try {
    return (await import(/* @vite-ignore */ objectUrl)) as Record<string, unknown>;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

export async function installAndLoadPlugin(
  url: string,
  pluginId: string,
  signal?: AbortSignal
): Promise<IPlugin> {
  if (!url.trim()) {
    throw new Error('Plugin URL cannot be empty.');
  }

  if (!pluginId.trim()) {
    throw new Error('pluginId cannot be empty.');
  }

  let jsCode = '';

  try {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch plugin: ${response.status} ${response.statusText}`);
    }

    jsCode = await response.text();
    await savePluginCode(pluginId, jsCode);
  } catch (fetchError) {
    if (fetchError instanceof DOMException && fetchError.name === 'AbortError') {
      throw fetchError;
    }

    const cachedCode = await getPluginCode(pluginId);
    if (!cachedCode) {
      throw new Error(`Unable to fetch plugin and no cache exists: ${toErrorMessage(fetchError)}`);
    }

    jsCode = cachedCode;
  }

  const moduleExports = await importFromCode(jsCode);
  const pluginCandidate = resolvePluginExport(moduleExports);
  const plugin = normalizePlugin(pluginCandidate, pluginId);

  if (!plugin) {
    const missingFields = getMissingContractFields(pluginCandidate).join(', ');
    const moduleKeys = getObjectKeys(moduleExports);
    const resolvedKeys = getObjectKeys(pluginCandidate);

    throw new Error(
      `Loaded module does not match IPlugin contract. Missing/invalid: ${missingFields}. ` +
        `module keys: [${moduleKeys}]. resolved export keys: [${resolvedKeys}]`
    );
  }

  if (!isPlugin(plugin)) {
    console.warn(
      `[PluginLoader] Plugin "${pluginId}" is missing optional metadata (name/version). ` +
        'Using fallback defaults.'
    );
  }

  if (plugin.id !== pluginId) {
    throw new Error(`Plugin id mismatch: expected "${pluginId}", received "${plugin.id}".`);
  }

  return plugin;
}
