import { useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PluginContainer } from './components/PluginContainer';

interface ActivePlugin {
  id: string;
  url: string;
  nonce: number;
}

const DEFAULT_PLUGIN_URL =
  'https://raw.githubusercontent.com/example/toolbox-plugins/main/dist/hello-plugin.js';

export default function App() {
  const [pluginId, setPluginId] = useState('hello-plugin');
  const [sourceUrl, setSourceUrl] = useState(DEFAULT_PLUGIN_URL);
  const [activePlugin, setActivePlugin] = useState<ActivePlugin | null>(null);
  const [validationError, setValidationError] = useState('');

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
    <main className="page-shell">
      <section className="hero">
        <p className="eyebrow">Local-First Hot Plug Host</p>
        <h1>Project Orbit Toolbox Runtime</h1>
        <p className="hero-copy">
          Install remote plugin bundles at runtime, cache them locally, and isolate persistent
          state by plugin namespace with strict envelope validation.
        </p>
      </section>

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

          <button type="submit">Install and Mount</button>
        </form>
      </section>

      <ErrorBoundary>
        <section className="card plugin-card">
          <h2>Plugin Runtime</h2>
          {!activePlugin && <p className="muted">No plugin mounted yet.</p>}
          {activePlugin && (
            <PluginContainer
              key={activePlugin.nonce}
              pluginId={activePlugin.id}
              sourceUrl={activePlugin.url}
            />
          )}
        </section>
      </ErrorBoundary>
    </main>
  );
}
