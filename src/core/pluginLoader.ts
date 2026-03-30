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

function toRawGithubUrlFromJsDelivr(url: string): string | null {
  const jsDelivrMatch = url.match(/^https:\/\/cdn\.jsdelivr\.net\/gh\/([^/]+)\/([^@/]+)@([^/]+)\/(.+)$/i);
  if (!jsDelivrMatch) {
    return null;
  }

  const [, owner, repo, ref, filePath] = jsDelivrMatch;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`;
}

function getImportUrlCandidates(url: string, includeCdnFallback = true): string[] {
  const candidates = includeCdnFallback
    ? [url, toRawGithubUrlFromJsDelivr(url), toJsDelivrUrl(url)]
    : [url, toRawGithubUrlFromJsDelivr(url)];

  const normalized = candidates.filter((value): value is string => Boolean(value));
  return Array.from(new Set(normalized));
}

function getPreferredFetchCandidates(url: string): string[] {
  const rawMirror = toRawGithubUrlFromJsDelivr(url);
  if (rawMirror) {
    // Prefer raw GitHub when source is jsDelivr to avoid stale edge caches.
    return Array.from(new Set([rawMirror, url]));
  }

  return getImportUrlCandidates(url, true);
}

function summarizeSourceForDebug(source: string): string {
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }

  return `${source.length}:${hash.toString(16)}`;
}

function withCacheBust(url: string, key = '__orbit_fetch_ts'): string {
  const resolved = new URL(url, window.location.href);
  resolved.searchParams.set(key, String(Date.now()));
  return resolved.toString();
}

function isRawGithubUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === 'raw.githubusercontent.com';
  } catch {
    return false;
  }
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

// --- Plugin sandboxing helpers -------------------------------------------------
// Map host mount elements to their shadow roots so we can redirect plugin DOM
// and style insertions into an isolated shadow root to avoid leaking global
// CSS (many third-party plugins inject global `body`, `*` or heading styles).
const __orbitSandboxRegistry = new Map<HTMLElement, ShadowRoot>();
let __orbitSandboxPatchCount = 0;
let __orbitOrigAppendChild: typeof Node.prototype.appendChild = Node.prototype.appendChild;

function __orbitApplyAppendPatch(): void {
  if (__orbitSandboxPatchCount > 0) {
    __orbitSandboxPatchCount += 1;
    return;
  }

  __orbitOrigAppendChild = Node.prototype.appendChild;

  Node.prototype.appendChild = function <T extends Node>(this: Node, node: T): T {
    try {
      // If code is appending into a host mount element that we manage,
      // redirect the append into that host's shadow root instead.
      if (this instanceof HTMLElement) {
        const el = this as HTMLElement;
        const shadow = __orbitSandboxRegistry.get(el);
        if (shadow) {
          return shadow.appendChild(node) as unknown as T;
        }
      }

      // If code is appending a <style> into document.head, route it into the
      // most recently registered plugin shadow root so the CSS is scoped.
      if (this === document.head && node instanceof HTMLStyleElement) {
        const hosts = Array.from(__orbitSandboxRegistry.keys());
        if (hosts.length > 0) {
          const lastHost = hosts[hosts.length - 1];
          const shadow = __orbitSandboxRegistry.get(lastHost)!;
          return shadow.appendChild(node) as unknown as T;
        }
      }
    } catch {
      // Fall through to default behavior on any error
    }

    return __orbitOrigAppendChild.call(this, node as any) as T;
  };

  __orbitSandboxPatchCount = 1;
}

function __orbitRemoveAppendPatch(): void {
  __orbitSandboxPatchCount = Math.max(0, __orbitSandboxPatchCount - 1);
  if (__orbitSandboxPatchCount === 0) {
    try {
      Node.prototype.appendChild = __orbitOrigAppendChild;
    } catch {
      // ignore
    }
  }
}

// ------------------------------------------------------------------------------

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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function buildPluginCacheKey(pluginId: string, normalizedUrl: string): string {
  return `${pluginId}::${normalizedUrl}`;
}

type BundleProfile = 'kanban-modern' | 'task-board-legacy' | 'unknown';

export function normalizePluginSourceUrl(inputUrl: string): string {
  const trimmed = inputUrl.trim();
  if (!trimmed) {
    return trimmed;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') {
    return trimmed;
  }

  const pathParts = parsed.pathname.split('/').filter(Boolean);

  // Convert GitHub file views to raw content URLs that can be fetched/imported directly.
  if (pathParts.length >= 5 && (pathParts[2] === 'blob' || pathParts[2] === 'raw')) {
    const owner = pathParts[0];
    const repo = pathParts[1];
    const ref = pathParts[3];
    const filePath = pathParts.slice(4).join('/');

    if (owner && repo && ref && filePath) {
      return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`;
    }
  }

  return trimmed;
}

function detectBundleProfile(jsCode: string): BundleProfile {
  if (/kanban-shell|board-sidebar|workspace-header/.test(jsCode)) {
    return 'kanban-modern';
  }

  if (/task-board__|task-column|TASK_COUNT_CHANGED/.test(jsCode)) {
    return 'task-board-legacy';
  }

  return 'unknown';
}

function hasRelativeModuleImports(jsCode: string): boolean {
  return /from\s+['"]\.{1,2}\//.test(jsCode) || /import\(\s*['"]\.{1,2}\//.test(jsCode);
}

export async function installAndLoadPlugin(
  url: string,
  pluginId: string,
  signal?: AbortSignal
): Promise<IPlugin> {
  const normalizedUrl = normalizePluginSourceUrl(url);
  const cacheKey = buildPluginCacheKey(pluginId, normalizedUrl);

  if (!normalizedUrl.trim()) {
    throw new Error('Plugin URL cannot be empty.');
  }

  if (!pluginId.trim()) {
    throw new Error('pluginId cannot be empty.');
  }

  let jsCode = '';
  let moduleExports: Record<string, unknown> | null = null;
  let importedFromUrl: string | null = null;
  let rawImportError: unknown = null;

  debugLog('installAndLoadPlugin start', { pluginId, url, normalizedUrl });

  try {
    const fetchCandidates = getPreferredFetchCandidates(normalizedUrl);
    let response: Response | null = null;
    let fetchedFromUrl: string | null = null;
    let lastFetchError: unknown = null;

    debugLog('trying fetch candidates', { pluginId, fetchCandidates });

    for (const candidate of fetchCandidates) {
      const fetchUrl = withCacheBust(candidate);

      try {
        const candidateResponse = await fetch(fetchUrl, {
          signal,
          cache: 'no-store'
        });

        debugLog('fetch candidate completed', {
          pluginId,
          fetchUrl,
          ok: candidateResponse.ok,
          status: candidateResponse.status,
          statusText: candidateResponse.statusText,
          contentType: candidateResponse.headers.get('content-type'),
          contentLength: candidateResponse.headers.get('content-length'),
          etag: candidateResponse.headers.get('etag'),
          lastModified: candidateResponse.headers.get('last-modified')
        });

        if (!candidateResponse.ok) {
          lastFetchError = new Error(
            `Failed to fetch plugin from ${candidate}: ${candidateResponse.status} ${candidateResponse.statusText}`
          );
          continue;
        }

        response = candidateResponse;
        fetchedFromUrl = candidate;
        break;
      } catch (candidateError) {
        if (signal?.aborted || isAbortError(candidateError)) {
          throw new DOMException('Plugin fetch aborted.', 'AbortError');
        }

        lastFetchError = candidateError;
        debugLog('fetch candidate failed', {
          pluginId,
          candidate,
          error: toErrorMessage(candidateError)
        });
      }
    }

    if (!response) {
      throw new Error(
        `Failed to fetch plugin from all candidates. Last error: ${toErrorMessage(lastFetchError)}`
      );
    }

    jsCode = await response.text();
    const bundleProfile = detectBundleProfile(jsCode);
    debugLog('plugin source downloaded', {
      fetchedFromUrl,
      chars: jsCode.length,
      sourceSignature: summarizeSourceForDebug(jsCode),
      preview: jsCode.slice(0, 180),
      bundleProfile
    });

    if (bundleProfile === 'task-board-legacy') {
      console.warn(
        '[PluginLoader] Loaded plugin bundle looks like legacy task-board UI. ' +
          'If you expect the full kanban UI, the remote dist/plugin.js is likely outdated and should be rebuilt/published.'
      );
    }

    await savePluginCode(cacheKey, jsCode);
    debugLog('plugin source cached to storage', { pluginId, cacheKey, chars: jsCode.length });

    const containsInvalidLegacySelector = /#plugin-1\.0\.0/.test(jsCode);
    const containsDavinciSelector = /#plugin-davinci/.test(jsCode);
    const shouldTryBlobFirst = !hasRelativeModuleImports(jsCode);

    debugLog('import strategy decision', {
      pluginId,
      shouldTryBlobFirst,
      containsInvalidLegacySelector,
      containsDavinciSelector
    });

    let blobImportError: unknown = null;
    let urlImportError: unknown = null;
    let cdnImportError: unknown = null;

    if (shouldTryBlobFirst) {
      try {
        moduleExports = await importFromCode(jsCode);
        debugLog('blob import succeeded (fresh fetched source)', {
          pluginId,
          exportKeys: Object.keys(moduleExports)
        });
      } catch (error) {
        blobImportError = error;
        debugLog('blob import failed (fresh fetched source)', {
          pluginId,
          error: toErrorMessage(error)
        });
      }
    }

    if (!moduleExports) {
      const importCandidates = getImportUrlCandidates(normalizedUrl, false);
      debugLog('trying URL import candidates', { pluginId, importCandidates });

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
        } catch (error) {
          urlImportError = error;
          rawImportError = error;
          debugLog('URL import candidate failed', {
            pluginId,
            candidate,
            error: toErrorMessage(error)
          });
        }
      }
    }

    if (!moduleExports && !shouldTryBlobFirst) {
      try {
        moduleExports = await importFromCode(jsCode);
        debugLog('blob import succeeded after URL failure', {
          pluginId,
          exportKeys: Object.keys(moduleExports)
        });
      } catch (error) {
        blobImportError = error;
        debugLog('blob import failed after URL failure', {
          pluginId,
          error: toErrorMessage(error)
        });
      }
    }

    if (!moduleExports) {
      const cdnCandidates = getImportUrlCandidates(normalizedUrl, true).filter(
        (candidate) => candidate !== normalizedUrl
      );

      for (const candidate of cdnCandidates) {
        try {
          moduleExports = await importFromUrl(candidate);
          importedFromUrl = candidate;
          debugLog('CDN URL import succeeded', {
            pluginId,
            importedFromUrl,
            exportKeys: Object.keys(moduleExports)
          });
          break;
        } catch (error) {
          cdnImportError = error;
          debugLog('CDN URL import failed', {
            pluginId,
            candidate,
            error: toErrorMessage(error)
          });
        }
      }
    }

    if (!moduleExports) {
      throw new Error(
        `Plugin import failed across blob, URL, and CDN fallbacks. ` +
          `blob error: ${toErrorMessage(blobImportError)}; ` +
          `URL error: ${toErrorMessage(urlImportError ?? rawImportError)}; ` +
          `CDN error: ${toErrorMessage(cdnImportError)}`
      );
    }

    if (importedFromUrl) {
      await ensurePluginStyles(pluginId, importedFromUrl);
    }
  } catch (fetchError) {
    if (isAbortError(fetchError)) {
      throw fetchError;
    }

    debugLog('fetch failed, trying cached plugin code', {
      pluginId,
      reason: toErrorMessage(fetchError)
    });

    // Some environments can fail `fetch` (CORS/proxy/offline policy) while URL import still works.
    // Try direct URL/CDN import before using local cache.
    const directImportCandidates = isRawGithubUrl(normalizedUrl)
      ? []
      : getImportUrlCandidates(normalizedUrl, true);

    if (directImportCandidates.length === 0) {
      debugLog('skipping direct URL import fallback', {
        pluginId,
        reason: 'raw.githubusercontent URL dynamic import can fail due MIME=text/plain'
      });
    }
    let directImportError: unknown = null;

    for (const candidate of directImportCandidates) {
      try {
        moduleExports = await importFromUrl(candidate);
        importedFromUrl = candidate;
        debugLog('direct URL import succeeded after fetch failure', {
          pluginId,
          importedFromUrl,
          exportKeys: Object.keys(moduleExports)
        });
        break;
      } catch (candidateError) {
        directImportError = candidateError;
        debugLog('direct URL import candidate failed after fetch failure', {
          pluginId,
          candidate,
          error: toErrorMessage(candidateError)
        });
      }
    }

    if (moduleExports) {
      if (importedFromUrl) {
        await ensurePluginStyles(pluginId, importedFromUrl);
      }

      return normalizePlugin(resolvePluginExport(moduleExports), pluginId) ?? (() => {
        throw new Error('Plugin module failed contract validation after direct URL import fallback.');
      })();
    }

    const cachedCode = await getPluginCode(cacheKey);
    if (!cachedCode) {
      throw new Error(
        `Unable to fetch plugin and no URL-scoped cache exists: ${toErrorMessage(fetchError)}. ` +
          `Direct URL import also failed: ${toErrorMessage(directImportError)}`
      );
    }

    jsCode = cachedCode;
    debugLog('loaded cached plugin source', { pluginId, cacheKey, chars: jsCode.length });
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

  debugLog('plugin contract validated', {
    pluginId: plugin.id,
    name: plugin.name,
    version: plugin.version
  });
  // Wrap plugin to isolate its DOM and styles inside a shadow root that we
  // attach to the plugin mount point. This prevents third-party plugins from
  // injecting global `body`, `*`, or heading styles into the host document.
  const sandboxedPlugin = {
    ...plugin,
    mount(host: HTMLElement, context: unknown) {
      // Create a wrapper and a shadow root. Append the wrapper into the host
      // element so the plugin's internal mapping (which expects the original
      // host element) continues to work.
      const wrapper = document.createElement('div');
      wrapper.className = `orbit-plugin-sandbox ${plugin.id}`;
      host.appendChild(wrapper);

      const shadow = wrapper.attachShadow({ mode: 'open' });

      // Register the host -> shadow mapping and enable the global appendChild
      // patch so subsequent DOM/style appends are redirected into the shadow.
      __orbitSandboxRegistry.set(host, shadow);
      __orbitApplyAppendPatch();

      try {
        return plugin.mount(host, context as any);
      } catch (err) {
        // On mount error, ensure we clean up the registry and patch state.
        __orbitSandboxRegistry.delete(host);
        __orbitRemoveAppendPatch();
        throw err;
      }
    },
    async unmount(host: HTMLElement) {
      try {
        const res = plugin.unmount(host as any);
        await Promise.resolve(res);
      } finally {
        // Remove the wrapper (which contains the shadow root and any styles)
        try {
          const wrapper = host.querySelector(`.orbit-plugin-sandbox.${plugin.id}`) as HTMLElement | null;
          if (wrapper && wrapper.parentNode) {
            wrapper.parentNode.removeChild(wrapper);
          } else {
            const fallback = host.querySelector('.orbit-plugin-sandbox') as HTMLElement | null;
            if (fallback && fallback.parentNode) {
              fallback.parentNode.removeChild(fallback);
            }
          }
        } catch {
          // ignore
        }

        __orbitSandboxRegistry.delete(host);
        __orbitRemoveAppendPatch();
      }
    }
  };

  return sandboxedPlugin;
}
