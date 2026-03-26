import { useEffect, useMemo, useState } from 'react';
import type { IPlugin } from '@toolbox/sdk';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PluginContainer } from './components/PluginContainer';
import {
  clearStorageAuditRecords,
  getStorageAuditRecords,
  runStorageProbe,
  type StorageAuditRecord
} from './core/storageManager';

interface ActivePlugin {
  id: string;
  url: string;
  nonce: number;
}

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

type StaticHubPane = 'workspace' | 'library' | 'operations';
type PluginHubPane = `plugin:${string}`;
type HubPane = StaticHubPane | PluginHubPane;

const INSTALLED_PLUGINS_STORAGE_KEY = 'orbit-hub.installed-plugins';

function pluginPaneId(id: string): PluginHubPane {
  return `plugin:${id}`;
}

function toPluginIdFromPane(pane: HubPane): string | null {
  if (!pane.startsWith('plugin:')) {
    return null;
  }

  return pane.slice('plugin:'.length);
}

function loadInstalledPlugins(): InstalledPlugin[] {
  try {
    const raw = localStorage.getItem(INSTALLED_PLUGINS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

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

const HUB_PANES: Array<{ id: StaticHubPane; title: string; tagline: string }> = [
  {
    id: 'workspace',
    title: 'Plugin Workspace',
    tagline: 'Install, mount, and iterate on a single plugin runtime.'
  },
  {
    id: 'library',
    title: 'Plugin Library',
    tagline: 'Track available modules and compatibility readiness.'
  },
  {
    id: 'operations',
    title: 'Host Operations',
    tagline: 'Observe runtime posture and local-first storage health.'
  }
];

export default function App() {
  const [activePane, setActivePane] = useState<HubPane>('workspace');
  const [pluginId, setPluginId] = useState('hello-plugin');
  const [sourceUrl, setSourceUrl] = useState(DEFAULT_PLUGIN_URL);
  const [activePlugin, setActivePlugin] = useState<ActivePlugin | null>(null);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>(() =>
    loadInstalledPlugins()
  );
  const [validationError, setValidationError] = useState('');
  const [probeMessage, setProbeMessage] = useState('');
  const [isProbing, setIsProbing] = useState(false);
  const [auditRecords, setAuditRecords] = useState<StorageAuditRecord[]>([]);
  const [updatingPluginId, setUpdatingPluginId] = useState<string | null>(null);

  const activeInstalledPlugin = useMemo(() => {
    const pluginIdFromPane = toPluginIdFromPane(activePane);
    if (!pluginIdFromPane) {
      return null;
    }

    return installedPlugins.find((plugin) => plugin.id === pluginIdFromPane) ?? null;
  }, [activePane, installedPlugins]);

  const isPluginPaneActive = activeInstalledPlugin !== null;

  useEffect(() => {
    localStorage.setItem(INSTALLED_PLUGINS_STORAGE_KEY, JSON.stringify(installedPlugins));
  }, [installedPlugins]);

  useEffect(() => {
    const activeId = activeInstalledPlugin?.id;
    setAuditRecords(getStorageAuditRecords(activeId));
  }, [activeInstalledPlugin?.id, installedPlugins]);

  async function handleRunProbe(): Promise<void> {
    const targetPluginId = activeInstalledPlugin?.id ?? pluginId.trim();

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

    setActivePlugin(null);
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

    if (activePlugin?.id === targetPluginId) {
      setActivePlugin(null);
    }

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

  function onInstall(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedId = pluginId.trim();
    const normalizedUrl = sourceUrl.trim();

    if (!normalizedId) {
      setValidationError('Plugin ID is required.');
      return;
    }

    if (!/^https?:\/\//i.test(normalizedUrl)) {
      setValidationError('Source URL must start with http:// or https://');
      return;
    }

    setValidationError('');

    setActivePlugin({
      id: normalizedId,
      url: normalizedUrl,
      nonce: Date.now()
    });
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
              workspace actions, library governance, and runtime operations.
            </p>
          </section>

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

            {installedPlugins.map((plugin) => {
              const paneId = pluginPaneId(plugin.id);
              const isActive = paneId === activePane;

              return (
                <button
                  key={paneId}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`pane-${paneId}`}
                  id={`tab-${paneId}`}
                  className={`host-btn hub-chip plugin-chip ${isActive ? 'is-active' : ''}`}
                  onClick={() => setActivePane(paneId)}
                >
                  <span className="chip-title">{plugin.name}</span>
                  <span className="chip-tagline">{plugin.id} · v{plugin.version}</span>
                </button>
              );
            })}
          </section>
        </>
      )}

      {!isPluginPaneActive && activePane === 'workspace' && (
        <section
          className="workspace-grid"
          role="tabpanel"
          id="pane-workspace"
          aria-labelledby="tab-workspace"
        >
          <section className="card">
            <h2>Install Plugin</h2>
            <form className="plugin-form" onSubmit={onInstall} noValidate>
              <label htmlFor="plugin-id">Plugin ID</label>
              <input
                id="plugin-id"
                name="plugin-id"
                value={pluginId}
                onChange={(event) => setPluginId(event.target.value)}
                placeholder="example-plugin"
                autoComplete="off"
              />

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

              {validationError && (
                <p className="inline-error" role="alert">
                  {validationError}
                </p>
              )}

              <button type="submit" className="host-btn">Install and Mount</button>
            </form>
          </section>

          <ErrorBoundary>
            <section className="card plugin-card">
              <h2>Plugin Runtime</h2>
              {!activePlugin && (
                <p className="muted">No plugin mounted yet. Install one to activate this pane.</p>
              )}
              {activePlugin && (
                <PluginContainer
                  key={activePlugin.nonce}
                  pluginId={activePlugin.id}
                  sourceUrl={activePlugin.url}
                  onReady={(plugin) =>
                    upsertInstalledPluginFromRuntime(plugin, activePlugin.url, { forceReload: true })
                  }
                />
              )}
            </section>
          </ErrorBoundary>

          {installedPlugins.length > 0 && (
            <section className="card pane-card">
              <h2>Installed Plugins</h2>
              <ul className="ops-list installed-list">
                {installedPlugins.map((plugin) => (
                  <li key={`installed-${plugin.id}`}>
                    <span>
                      {plugin.name} <small>({plugin.id})</small>
                    </span>
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
            </section>
          )}
        </section>
      )}

      {!isPluginPaneActive && activePane === 'library' && (
        <section className="card pane-card" role="tabpanel" id="pane-library" aria-labelledby="tab-library">
          <h2>Plugin Library</h2>
          <p className="muted">
            Use this lane to curate plugin inventory, maintain trust metadata, and stage releases.
          </p>
          <div className="status-grid">
            <article className="status-tile">
              <p className="status-label">Approved</p>
              <p className="status-value">12</p>
            </article>
            <article className="status-tile">
              <p className="status-label">Needs Review</p>
              <p className="status-value">3</p>
            </article>
            <article className="status-tile">
              <p className="status-label">Deprecated</p>
              <p className="status-value">1</p>
            </article>
          </div>
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
            <li>
              <span>Mounted Plugin Slot</span>
              <strong>{activePlugin ? activePlugin.id : 'Idle'}</strong>
            </li>
          </ul>

          <div className="ops-actions">
            <button type="button" className="host-btn" onClick={handleRunProbe} disabled={isProbing}>
              {isProbing ? 'Running Probe...' : 'Run DB Probe'}
            </button>
            <button type="button" className="host-btn inline-delete-btn" onClick={handleClearAudit}>
              Clear Audit
            </button>
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

      {installedPlugins.map((plugin) => {
        const paneId = pluginPaneId(plugin.id);
        const isActive = activePane === paneId;

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
              />
            </section>
          </ErrorBoundary>
        );
      })}
    </main>
  );
}
