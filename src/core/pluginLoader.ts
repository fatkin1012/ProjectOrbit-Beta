import type { IPlugin } from '@toolbox/sdk';
import { getPluginCode, savePluginCode } from './storageManager';

function isPlugin(value: unknown): value is IPlugin {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<IPlugin>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.version === 'string' &&
    typeof candidate.mount === 'function' &&
    typeof candidate.unmount === 'function'
  );
}

function resolvePluginExport(moduleExports: Record<string, unknown>): unknown {
  return moduleExports.default ?? moduleExports.plugin ?? moduleExports;
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
  const plugin = resolvePluginExport(moduleExports);

  if (!isPlugin(plugin)) {
    throw new Error('Loaded module does not match IPlugin contract.');
  }

  if (plugin.id !== pluginId) {
    throw new Error(`Plugin id mismatch: expected "${pluginId}", received "${plugin.id}".`);
  }

  return plugin;
}
