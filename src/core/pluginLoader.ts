import type { IPlugin } from '@toolbox/sdk';
import { getPluginCode, savePluginCode } from './storageManager';

const LOADER_LOG_PREFIX = '[PluginLoader:debug]';

function debugLog(message: string, data?: unknown): void {
  if (data === undefined) {
    console.info(`${LOADER_LOG_PREFIX} ${message}`);
    return;
  }

  console.info(`${LOADER_LOG_PREFIX} ${message}`, data);
}

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

async function importFromUrl(url: string): Promise<Record<string, unknown>> {
  const resolved = new URL(url, window.location.href);
  // Force a fresh module evaluation so plugin updates with the same URL can remount immediately.
  resolved.searchParams.set('__orbit_host_ts', String(Date.now()));
  debugLog('importing plugin module from URL', { inputUrl: url, resolvedUrl: resolved.toString() });
  return (await import(/* @vite-ignore */ resolved.toString())) as Record<string, unknown>;
}

function toJsDelivrUrl(url: string): string | null {
  const rawMatch = url.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i);
  if (!rawMatch) {
    return null;
  }

  const [, owner, repo, ref, filePath] = rawMatch;
  return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${filePath}`;
}

function getImportUrlCandidates(url: string): string[] {
  const candidates = [url, toJsDelivrUrl(url)].filter((value): value is string => Boolean(value));
  return Array.from(new Set(candidates));
}

function toCompanionCssCandidates(moduleUrl: string): string[] {
  const parsed = new URL(moduleUrl, window.location.href);
  const parts = parsed.pathname.split('/');
  const fileName = parts[parts.length - 1] ?? 'plugin.js';
  const baseName = fileName.replace(/\.[^.]+$/, '');

  const cssNames = [
    `${baseName}.css`,
    'plugin.css',
    'style.css',
    'styles.css',
    'orbit-task-board.css'
  ];

  const baseHref = parsed.toString().replace(/[^/]*([?#].*)?$/, '');
  return cssNames.map((name) => new URL(name, baseHref).toString());
}

function hasStylesheetLink(url: string): boolean {
  const links = document.querySelectorAll('link[rel="stylesheet"]');
  return Array.from(links).some((link) => {
    const href = (link as HTMLLinkElement).href;
    return href === url || href.startsWith(`${url}?`);
  });
}

async function loadCompanionStylesheet(url: string, pluginId: string): Promise<boolean> {
  if (hasStylesheetLink(url)) {
    debugLog('stylesheet already loaded, skipping', { pluginId, url });
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${url}${url.includes('?') ? '&' : '?'}__orbit_style_ts=${Date.now()}`;
    link.dataset.orbitPluginStyle = pluginId;

    link.onload = () => {
      debugLog('companion stylesheet loaded', { pluginId, url });
      resolve(true);
    };

    link.onerror = () => {
      link.remove();
      debugLog('companion stylesheet failed', { pluginId, url });
      resolve(false);
    };

    document.head.appendChild(link);
  });
}

async function ensurePluginStyles(pluginId: string, moduleUrl: string): Promise<void> {
  const candidates = toCompanionCssCandidates(moduleUrl);
  debugLog('probing companion stylesheet candidates', { pluginId, candidates });

  for (const candidate of candidates) {
    const ok = await loadCompanionStylesheet(candidate, pluginId);
    if (ok) {
      return;
    }
  }

  debugLog('no companion stylesheet could be loaded', { pluginId, moduleUrl });
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

type BundleProfile = 'kanban-modern' | 'task-board-legacy' | 'unknown';

function detectBundleProfile(jsCode: string): BundleProfile {
  if (/kanban-shell|board-sidebar|workspace-header/.test(jsCode)) {
    return 'kanban-modern';
  }

  if (/task-board__|task-column|TASK_COUNT_CHANGED/.test(jsCode)) {
    return 'task-board-legacy';
  }

  return 'unknown';
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
  let moduleExports: Record<string, unknown> | null = null;
  let importedFromUrl: string | null = null;

  debugLog('installAndLoadPlugin start', { pluginId, url });

  try {
    const response = await fetch(url, {
      signal,
      cache: 'no-store'
    });
    debugLog('fetch completed', {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type'),
      contentLength: response.headers.get('content-length')
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch plugin: ${response.status} ${response.statusText}`);
    }

    jsCode = await response.text();
    const bundleProfile = detectBundleProfile(jsCode);
    debugLog('plugin source downloaded', {
      chars: jsCode.length,
      preview: jsCode.slice(0, 180),
      bundleProfile
    });

    if (bundleProfile === 'task-board-legacy') {
      console.warn(
        '[PluginLoader] Loaded plugin bundle looks like legacy task-board UI. ' +
          'If you expect the full kanban UI, the remote dist/plugin.js is likely outdated and should be rebuilt/published.'
      );
    }

    await savePluginCode(pluginId, jsCode);
    debugLog('plugin source cached to storage', { pluginId, chars: jsCode.length });

    const importCandidates = getImportUrlCandidates(url);
    debugLog('trying URL import candidates', { pluginId, importCandidates });

    let lastImportError: unknown = null;
    for (const candidate of importCandidates) {
      try {
        moduleExports = await importFromUrl(candidate);
        importedFromUrl = candidate;
        debugLog('URL import succeeded', {
          pluginId,
          importedFromUrl,
          exportKeys: Object.keys(moduleExports)
        });
        break;
      } catch (urlImportError) {
        lastImportError = urlImportError;
        debugLog('URL import candidate failed', { pluginId, candidate, error: toErrorMessage(urlImportError) });
      }
    }

    if (!moduleExports) {
      console.warn(
        `[PluginLoader] URL import failed for "${pluginId}", falling back to blob import.`,
        lastImportError
      );
      debugLog('attempting blob import fallback', {
        pluginId,
        containsCssHint:
          /\.css['\"]|from\s+['\"][^'\"]+\.css['\"]|url\(/i.test(jsCode)
      });
      moduleExports = await importFromCode(jsCode);
      debugLog('blob import succeeded', { exportKeys: Object.keys(moduleExports) });
    } else if (importedFromUrl) {
      await ensurePluginStyles(pluginId, importedFromUrl);
    }
  } catch (fetchError) {
    if (fetchError instanceof DOMException && fetchError.name === 'AbortError') {
      throw fetchError;
    }

    debugLog('fetch failed, trying cached plugin code', {
      pluginId,
      reason: toErrorMessage(fetchError)
    });

    const cachedCode = await getPluginCode(pluginId);
    if (!cachedCode) {
      throw new Error(`Unable to fetch plugin and no cache exists: ${toErrorMessage(fetchError)}`);
    }

    jsCode = cachedCode;
    debugLog('loaded cached plugin source', { pluginId, chars: jsCode.length });
    moduleExports = await importFromCode(jsCode);
    debugLog('cached blob import succeeded', { exportKeys: Object.keys(moduleExports) });
  }

  if (!moduleExports) {
    throw new Error('Plugin module failed to load.');
  }

  const pluginCandidate = resolvePluginExport(moduleExports);
  const plugin = normalizePlugin(pluginCandidate, pluginId);
  debugLog('resolved plugin export candidate', {
    moduleKeys: Object.keys(moduleExports),
    resolvedKeys: getObjectKeys(pluginCandidate)
  });

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

  debugLog('plugin contract validated', {
    pluginId: plugin.id,
    name: plugin.name,
    version: plugin.version
  });

  return plugin;
}
