import { useEffect, useMemo, useRef, useState } from 'react';
import type { IPlugin } from '@toolbox/sdk';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PluginContainer } from './components/PluginContainer';
import { installAndLoadPlugin, normalizePluginSourceUrl } from './core/pluginLoader';
import {
  clearPluginCodeCache,
  clearStorageAuditRecords,
  exportIndexedDbBackup,
  getStorageAuditRecords,
  importIndexedDbBackup,
  runStorageProbe,
  type StorageAuditRecord
} from './core/storageManager';

interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  url: string;
  lastOpenedAt: number;
  revision: number;
}

const DEFAULT_PLUGIN_URL =
  'https://raw.githubusercontent.com/example/toolbox-plugins/main/dist/hello-plugin.js';

type StaticHubPane = 'workspace' | 'installed' | 'operations';
type PluginHubPane = `plugin:${string}`;
type HubPane = StaticHubPane | PluginHubPane;
type UrlConversionMode = 'none' | 'raw' | 'jsdelivr';

const INSTALLED_PLUGINS_STORAGE_KEY = 'orbit-hub.installed-plugins';

const URL_CONVERSION_OPTIONS: Array<{ value: UrlConversionMode; label: string }> = [
  { value: 'none', label: 'Keep input URL as-is' },
  { value: 'raw', label: 'Convert to raw.githubusercontent' },
  { value: 'jsdelivr', label: 'Convert to jsDelivr (cdn.jsdelivr.net)' }
];

function pluginPaneId(id: string): PluginHubPane {
  return `plugin:${id}`;
}

function toPluginIdFromPane(pane: HubPane): string | null {
  if (!pane.startsWith('plugin:')) {
    return null;
  }

  return pane.slice('plugin:'.length);
}

function normalizeInstalledPlugins(raw: string | null): InstalledPlugin[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(
        (item): item is InstalledPlugin =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as InstalledPlugin).id === 'string' &&
          typeof (item as InstalledPlugin).name === 'string' &&
          typeof (item as InstalledPlugin).version === 'string' &&
          typeof (item as InstalledPlugin).url === 'string' &&
          typeof (item as InstalledPlugin).lastOpenedAt === 'number'
      )
      .map((item) => ({
        ...item,
        revision:
          typeof (item as Partial<InstalledPlugin>).revision === 'number'
            ? (item as InstalledPlugin).revision
            : (item as InstalledPlugin).lastOpenedAt
      }))
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  } catch {
    return [];
  }
}

function loadInstalledPluginsFromLocalStorage(): InstalledPlugin[] {
  return normalizeInstalledPlugins(localStorage.getItem(INSTALLED_PLUGINS_STORAGE_KEY));
}

async function loadInstalledPluginsFromDesktopBridge(): Promise<InstalledPlugin[] | null> {
  const desktopBridge = window.__ORBIT_DESKTOP__;
  if (!desktopBridge) {
    return null;
  }

  try {
    const raw = await desktopBridge.installedPlugins.get();
    return normalizeInstalledPlugins(raw);
  } catch (error) {
    console.warn('[Orbit Hub] Failed to read installed plugins from desktop storage.', error);
    return null;
  }
}

async function persistInstalledPlugins(installedPlugins: InstalledPlugin[]): Promise<void> {
  const payload = JSON.stringify(installedPlugins);
  const desktopBridge = window.__ORBIT_DESKTOP__;

  if (desktopBridge) {
    try {
      await desktopBridge.installedPlugins.set(payload);
      return;
    } catch (error) {
      console.warn('[Orbit Hub] Failed to write installed plugins to desktop storage.', error);
    }
  }

  localStorage.setItem(INSTALLED_PLUGINS_STORAGE_KEY, payload);
}

const HUB_PANES: Array<{ id: StaticHubPane; title: string; tagline: string }> = [
  {
    id: 'workspace',
    title: 'Plugin Workspace',
    tagline: 'Install, mount, and iterate on a single plugin runtime.'
  },
  {
    id: 'installed',
    title: 'Installed Plugins',
    tagline: 'Browse and open installed plugin cards quickly.'
  },
  {
    id: 'operations',
    title: 'Host Operations',
    tagline: 'Observe runtime posture and local-first storage health.'
  }
];

function formatLastActive(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-HK', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(timestamp));
}

function toRawGithubFromJsDelivr(url: string): string | null {
  const jsDelivrMatch = url.match(/^https:\/\/cdn\.jsdelivr\.net\/gh\/([^/]+)\/([^@/]+)@([^/]+)\/(.+)$/i);
  if (!jsDelivrMatch) {
    return null;
  }

  const [, owner, repo, ref, filePath] = jsDelivrMatch;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`;
}

function toJsDelivrFromRawGithub(url: string): string | null {
  const rawMatch = url.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i);
  if (!rawMatch) {
    return null;
  }

  const [, owner, repo, ref, filePath] = rawMatch;
  return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${filePath}`;
}

function convertPluginUrlByMode(inputUrl: string, mode: UrlConversionMode): string {
  const trimmed = inputUrl.trim();
  if (!trimmed) {
    return trimmed;
  }

  const githubNormalized = normalizePluginSourceUrl(trimmed);

  if (mode === 'none') {
    return githubNormalized;
  }

  if (mode === 'raw') {
    return toRawGithubFromJsDelivr(githubNormalized) ?? githubNormalized;
  }

  const rawCandidate = toRawGithubFromJsDelivr(githubNormalized) ?? githubNormalized;
  return toJsDelivrFromRawGithub(rawCandidate) ?? rawCandidate;
}

export default function App() {
  const [activePane, setActivePane] = useState<HubPane>('workspace');
  const [sourceUrl, setSourceUrl] = useState(DEFAULT_PLUGIN_URL);
  const [urlConversionMode, setUrlConversionMode] = useState<UrlConversionMode>('none');
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([]);
  const [isInstalledPluginsHydrated, setIsInstalledPluginsHydrated] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);
  const [probeMessage, setProbeMessage] = useState('');
  const [isProbing, setIsProbing] = useState(false);
  const [isClearingPluginCache, setIsClearingPluginCache] = useState(false);
  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [isImportingBackup, setIsImportingBackup] = useState(false);
  const [auditRecords, setAuditRecords] = useState<StorageAuditRecord[]>([]);
  const [updatingPluginId, setUpdatingPluginId] = useState<string | null>(null);
  const importBackupInputRef = useRef<HTMLInputElement | null>(null);

  const activeInstalledPlugin = useMemo(() => {
    const pluginIdFromPane = toPluginIdFromPane(activePane);
    if (!pluginIdFromPane) {
      return null;
    }

    return installedPlugins.find((plugin) => plugin.id === pluginIdFromPane) ?? null;
  }, [activePane, installedPlugins]);

  const isPluginPaneActive = activeInstalledPlugin !== null;
  const convertedSourceUrlPreview = useMemo(
    () => convertPluginUrlByMode(sourceUrl, urlConversionMode),
    [sourceUrl, urlConversionMode]
  );

  useEffect(() => {
    if (isPluginPaneActive) {
      document.body.style.removeProperty('background-color');
      document.body.classList.remove('orbit-hub-view');
      return;
    }

    document.body.style.setProperty('background-color', '#ececeb', 'important');
    document.body.classList.add('orbit-hub-view');

    return () => {
      document.body.style.removeProperty('background-color');
      document.body.classList.remove('orbit-hub-view');
    };
  }, [isPluginPaneActive]);

  useEffect(() => {
    let isCancelled = false;

    void (async () => {
      const desktopPlugins = await loadInstalledPluginsFromDesktopBridge();
      const nextPlugins = desktopPlugins ?? loadInstalledPluginsFromLocalStorage();

      if (isCancelled) {
        return;
      }

      setInstalledPlugins(nextPlugins);
      setIsInstalledPluginsHydrated(true);
    })();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isInstalledPluginsHydrated) {
      return;
    }

    void persistInstalledPlugins(installedPlugins);
  }, [installedPlugins, isInstalledPluginsHydrated]);

  useEffect(() => {
    const activeId = activeInstalledPlugin?.id;
    setAuditRecords(getStorageAuditRecords(activeId));
  }, [activeInstalledPlugin?.id, installedPlugins]);

  // Debug helper: initialize input blocker detector when ?orbitDebug=1 is present in the URL
  useEffect(() => {
    // debug loader removed
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      setActivePane('workspace');
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  async function handleRunProbe(): Promise<void> {
    const targetPluginId = activeInstalledPlugin?.id ?? installedPlugins[0]?.id ?? '';

    if (!targetPluginId) {
      setProbeMessage('No plugin selected for probe.');
      return;
    }

    setIsProbing(true);
    const result = await runStorageProbe(targetPluginId);
    setIsProbing(false);
    setProbeMessage(result.message);
    setAuditRecords(getStorageAuditRecords(targetPluginId));
  }

  function handleClearAudit(): void {
    clearStorageAuditRecords();
    setAuditRecords([]);
  }

  async function handleClearPluginCache(): Promise<void> {
    setIsClearingPluginCache(true);

    try {
      const removed = await clearPluginCodeCache();
      setProbeMessage(
        removed > 0
          ? `Cleared plugin cache entries: ${removed}.`
          : 'Plugin cache is already empty.'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown cache clear error.';
      setProbeMessage(`Failed to clear plugin cache: ${message}`);
    } finally {
      setIsClearingPluginCache(false);
    }
  }

  async function handleExportIndexedDbBackup(): Promise<void> {
    setIsExportingBackup(true);

    try {
      const backup = await exportIndexedDbBackup();
      const payload = JSON.stringify(backup, null, 2);
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().replace(/[.:]/g, '-');

      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `orbit-indexeddb-backup-${timestamp}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      setProbeMessage(
        `Backup exported: ${backup.stores.kv.length} kv entries and ${backup.stores.pluginCode.length} plugin code entries.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown backup export error.';
      setProbeMessage(`Backup export failed: ${message}`);
    } finally {
      setIsExportingBackup(false);
    }
  }

  function handleOpenImportBackupPicker(): void {
    importBackupInputRef.current?.click();
  }

  async function handleImportIndexedDbBackup(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const confirmed = window.confirm(
      'Importing this backup will replace all current IndexedDB data. Continue?'
    );
    if (!confirmed) {
      event.target.value = '';
      return;
    }

    setIsImportingBackup(true);

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const result = await importIndexedDbBackup(parsed);
      setProbeMessage(
        `Backup imported from ${file.name}: ${result.kvCount} kv entries and ${result.codeCount} plugin code entries restored.`
      );

      const activeId = activeInstalledPlugin?.id;
      setAuditRecords(getStorageAuditRecords(activeId));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown backup import error.';
      setProbeMessage(`Backup import failed: ${message}`);
    } finally {
      setIsImportingBackup(false);
      event.target.value = '';
    }
  }

  function upsertInstalledPluginFromRuntime(
    plugin: IPlugin,
    url: string,
    options?: { forceReload?: boolean }
  ): void {
    setInstalledPlugins((previous) => {
      const existing = previous.find((item) => item.id === plugin.id);
      const now = Date.now();
      const nextRecord: InstalledPlugin = {
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        url,
        lastOpenedAt: now,
        revision: options?.forceReload ? now : existing?.revision ?? now
      };

      const withoutCurrent = previous.filter((item) => item.id !== plugin.id);
      return [nextRecord, ...withoutCurrent];
    });
    setActivePane(pluginPaneId(plugin.id));
  }

  function removeInstalledPlugin(targetPluginId: string): void {
    const target = installedPlugins.find((plugin) => plugin.id === targetPluginId);
    if (!target) {
      return;
    }

    const confirmed = window.confirm(`Remove plugin "${target.name}" (${target.id}) from Orbit Hub?`);
    if (!confirmed) {
      return;
    }

    setInstalledPlugins((previous) => previous.filter((plugin) => plugin.id !== targetPluginId));

    if (toPluginIdFromPane(activePane) === targetPluginId) {
      setActivePane('workspace');
    }
  }

  function updateInstalledPlugin(targetPluginId: string): void {
    setUpdatingPluginId(targetPluginId);

    const now = Date.now();

    setInstalledPlugins((previous) => {
      const target = previous.find((plugin) => plugin.id === targetPluginId);
      if (!target) {
        return previous;
      }

      const refreshed: InstalledPlugin = {
        ...target,
        lastOpenedAt: now,
        revision: now
      };

      const withoutTarget = previous.filter((plugin) => plugin.id !== targetPluginId);
      return [refreshed, ...withoutTarget];
    });

    setActivePane(pluginPaneId(targetPluginId));

    window.setTimeout(() => {
      setUpdatingPluginId((current) => (current === targetPluginId ? null : current));
    }, 600);
  }

  async function onInstall(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const convertedUrl = convertPluginUrlByMode(sourceUrl, urlConversionMode);
    const normalizedUrl = normalizePluginSourceUrl(convertedUrl);

    if (!/^https?:\/\//i.test(normalizedUrl)) {
      setValidationError('Source URL must start with http:// or https://');
      return;
    }

    setValidationError('');
    setSourceUrl(normalizedUrl);
    setIsInstalling(true);

    try {
      // Use a temporary ID for initial load to discover the actual plugin ID
      const tempId = `plugin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const discoveredPlugin = await installAndLoadPlugin(normalizedUrl, tempId);
      
      // Now use the actual plugin ID from the discovered plugin
      // Re-fetch with correct ID to avoid storage key conflicts
      const correctId = discoveredPlugin.id || tempId;
      if (correctId !== tempId) {
        // Clear the incorrect temporary storage
        console.info('[App] Correcting plugin ID during install', { tempId, correctId });
      }
      
      upsertInstalledPluginFromRuntime(discoveredPlugin, normalizedUrl, { forceReload: true });
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : 'Plugin install failed.');
    } finally {
      setIsInstalling(false);
    }
  }

  return (
    <main className={`page-shell ${isPluginPaneActive ? 'page-shell-plugin-active' : ''}`}>
      {!isPluginPaneActive && (
        <>
          <section className="hero">
            <p className="eyebrow">Orbit Hub</p>
            <h1>Project Orbit Toolbox Runtime</h1>
            <p className="hero-copy">
              One host, multiple capabilities. Choose a function lane below to jump between plugin
              workspace actions, installed plugin access, and runtime operations.
            </p>
          </section>

          <section className="hub-shell">
            <aside className="hub-nav-rail" aria-label="Hub navigation">
              <p className="rail-title">Navigation</p>
              <section className="hub-nav" role="tablist" aria-label="Hub function selector">
                {HUB_PANES.map((pane) => {
                  const isActive = pane.id === activePane;

                  return (
                    <button
                      key={pane.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      aria-controls={`pane-${pane.id}`}
                      id={`tab-${pane.id}`}
                      className={`host-btn hub-chip ${isActive ? 'is-active' : ''}`}
                      onClick={() => setActivePane(pane.id)}
                    >
                      <span className="chip-title">{pane.title}</span>
                      <span className="chip-tagline">{pane.tagline}</span>
                    </button>
                  );
                })}
              </section>
            </aside>

            <section className="hub-content">
              {!isPluginPaneActive && activePane === 'workspace' && (
                <section
                  className="workspace-grid"
                  role="tabpanel"
                  id="pane-workspace"
                  aria-labelledby="tab-workspace"
                >
                  <section className="card pane-card workspace-quickstart">
                    <h2>Quick Start</h2>
                    <p className="muted">Get a plugin mounted in under two minutes and verify runtime health.</p>
                    <ol className="quickstart-list">
                      <li>Paste a plugin source URL.</li>
                      <li>Click Install and Mount to launch into runtime.</li>
                      <li>Open Host Operations to run DB Probe and confirm storage health.</li>
                    </ol>
                    <div className="status-grid">
                      <article className="status-tile">
                        <p className="status-label">Installed Plugins</p>
                        <p className="status-value">{installedPlugins.length}</p>
                      </article>
                      <article className="status-tile">
                        <p className="status-label">Storage Events</p>
                        <p className="status-value">{auditRecords.length}</p>
                      </article>
                    </div>
                  </section>

                  <section className="card workspace-install">
                    <h2>Install Plugin</h2>
                    <form className="plugin-form" onSubmit={onInstall} noValidate>
                      <label htmlFor="plugin-url">Plugin Source URL</label>
                      <input
                        id="plugin-url"
                        name="plugin-url"
                        type="url"
                        value={sourceUrl}
                        onChange={(event) => setSourceUrl(event.target.value)}
                        placeholder="https://.../plugin.js"
                        autoComplete="off"
                      />

                      <div className="plugin-url-tools">
                        <label htmlFor="plugin-url-conversion">URL conversion</label>
                        <select
                          id="plugin-url-conversion"
                          name="plugin-url-conversion"
                          value={urlConversionMode}
                          onChange={(event) =>
                            setUrlConversionMode(event.target.value as UrlConversionMode)
                          }
                        >
                          {URL_CONVERSION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {sourceUrl.trim() && (
                        <p className="muted plugin-url-preview" aria-live="polite">
                          Effective install URL: {convertedSourceUrlPreview}
                        </p>
                      )}

                      {validationError && (
                        <p className="inline-error" role="alert">
                          {validationError}
                        </p>
                      )}

                      <button type="submit" className="host-btn" disabled={isInstalling}>
                        {isInstalling ? 'Installing...' : 'Install Plugin'}
                      </button>
                    </form>
                  </section>

                  {installedPlugins.length > 0 && (
                    <section className="card pane-card workspace-installed">
                      <h2>Recent Activity</h2>
                      <p className="muted">最近使用的 3 個插件。</p>
                      <ul className="ops-list installed-list recent-activity-list">
                        {installedPlugins.slice(0, 3).map((plugin) => (
                          <li key={`recent-${plugin.id}`}>
                            <div className="installed-plugin-meta">
                              <strong>{plugin.name}</strong>
                              <small>({plugin.id})</small>
                              <small>Last active: {formatLastActive(plugin.lastOpenedAt)}</small>
                            </div>
                            <div className="installed-actions">
                              <button
                                type="button"
                                className="host-btn inline-open-btn"
                                onClick={() => setActivePane(pluginPaneId(plugin.id))}
                              >
                                Open
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </section>
              )}

              {!isPluginPaneActive && activePane === 'installed' && (
                <section
                  className="card pane-card"
                  role="tabpanel"
                  id="pane-installed"
                  aria-labelledby="tab-installed"
                >
                  <h2>Installed Plugins</h2>
                  <p className="muted">點擊卡片即可開啟對應插件。</p>

                  {installedPlugins.length === 0 && (
                    <p className="muted">目前還沒有已安裝插件，先到 Workspace 安裝一個吧。</p>
                  )}

                  {installedPlugins.length > 0 && (
                    <ul className="ops-list installed-list">
                      {installedPlugins.map((plugin) => (
                        <li key={`installed-pane-${plugin.id}`}>
                          <div className="installed-plugin-meta">
                            <strong>{plugin.name}</strong>
                            <small>({plugin.id})</small>
                            <small>Last active: {formatLastActive(plugin.lastOpenedAt)}</small>
                          </div>
                          <div className="installed-actions">
                            <button
                              type="button"
                              className="host-btn inline-open-btn"
                              onClick={() => setActivePane(pluginPaneId(plugin.id))}
                            >
                              Open
                            </button>
                            <button
                              type="button"
                              className="host-btn inline-update-btn"
                              onClick={() => updateInstalledPlugin(plugin.id)}
                              disabled={updatingPluginId === plugin.id}
                            >
                              {updatingPluginId === plugin.id ? 'Updating...' : 'Update'}
                            </button>
                            <button
                              type="button"
                              className="host-btn inline-delete-btn"
                              onClick={() => removeInstalledPlugin(plugin.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {!isPluginPaneActive && activePane === 'operations' && (
                <section
                  className="card pane-card"
                  role="tabpanel"
                  id="pane-operations"
                  aria-labelledby="tab-operations"
                >
                  <h2>Host Operations</h2>
                  <p className="muted">
                    Monitor runtime lifecycle, event bus pressure, and storage envelope health in one place.
                  </p>
                  <ul className="ops-list">
                    <li>
                      <span>Event Bus Drift</span>
                      <strong>Stable</strong>
                    </li>
                    <li>
                      <span>IndexedDB Envelope Writes</span>
                      <strong>Healthy</strong>
                    </li>
                  </ul>

                  <div className="ops-actions">
                    <button type="button" className="host-btn" onClick={handleRunProbe} disabled={isProbing}>
                      {isProbing ? 'Running Probe...' : 'Run DB Probe'}
                    </button>
                    <button
                      type="button"
                      className="host-btn"
                      onClick={handleClearPluginCache}
                      disabled={isClearingPluginCache}
                    >
                      {isClearingPluginCache ? 'Clearing Plugin Cache...' : 'Clear Plugin Cache'}
                    </button>
                    <button
                      type="button"
                      className="host-btn"
                      onClick={handleExportIndexedDbBackup}
                      disabled={isExportingBackup || isImportingBackup}
                    >
                      {isExportingBackup ? 'Exporting Backup...' : 'Export IndexedDB Backup'}
                    </button>
                    <button
                      type="button"
                      className="host-btn"
                      onClick={handleOpenImportBackupPicker}
                      disabled={isImportingBackup || isExportingBackup}
                    >
                      {isImportingBackup ? 'Importing Backup...' : 'Import IndexedDB Backup'}
                    </button>
                    <button type="button" className="host-btn inline-delete-btn" onClick={handleClearAudit}>
                      Clear Audit
                    </button>
                    <input
                      ref={importBackupInputRef}
                      type="file"
                      accept="application/json,.json"
                      onChange={handleImportIndexedDbBackup}
                      hidden
                    />
                  </div>

                  {probeMessage && <p className="muted probe-message">{probeMessage}</p>}

                  <section className="audit-panel" aria-live="polite">
                    <h3>Storage Audit (Recent)</h3>
                    {auditRecords.length === 0 && <p className="muted">No storage activity captured yet.</p>}
                    {auditRecords.length > 0 && (
                      <ul className="audit-list">
                        {auditRecords.slice(0, 8).map((record, index) => (
                          <li key={`${record.ts}-${record.op}-${record.key}-${index}`}>
                            <span>
                              [{record.op.toUpperCase()}] {record.pluginId}/{record.key}
                              {record.detail ? ` · ${record.detail}` : ''}
                            </span>
                            <strong>{record.ok ? 'OK' : 'FAIL'}</strong>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </section>
              )}
            </section>
          </section>
        </>
      )}

      {installedPlugins.map((plugin) => {
        const paneId = pluginPaneId(plugin.id);
        const isActive = activePane === paneId;

        if (!isActive) {
          return null;
        }

        return (
          <ErrorBoundary key={`persisted-pane-${plugin.id}`}>
            <section
              className={`plugin-page ${isActive ? '' : 'pane-hidden'}`}
              role="tabpanel"
              id={`pane-${paneId}`}
              aria-labelledby={`tab-${paneId}`}
              aria-hidden={!isActive}
            >
              <button
                type="button"
                className="host-btn plugin-back-btn"
                onClick={() => setActivePane('workspace')}
              >
                Back To Hub
              </button>
              <PluginContainer
                key={`persisted-${plugin.id}-${plugin.url}-${plugin.revision}`}
                pluginId={plugin.id}
                sourceUrl={plugin.url}
                mode="fullpage"
                onReady={(loadedPlugin) =>
                  upsertInstalledPluginFromRuntime(loadedPlugin, plugin.url)
                }
              />
            </section>
          </ErrorBoundary>
        );
      })}
    </main>
  );
}
