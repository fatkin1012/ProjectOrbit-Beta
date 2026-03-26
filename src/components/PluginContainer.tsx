import { useEffect, useRef, useState } from 'react';
import type { IPlugin } from '@toolbox/sdk';
import { createAppContext } from '../core/contextFactory';
import { installAndLoadPlugin } from '../core/pluginLoader';

interface PluginContainerProps {
  pluginId: string;
  sourceUrl: string;
}

export function PluginContainer({ pluginId, sourceUrl }: PluginContainerProps) {
  const mountRootRef = useRef<HTMLDivElement | null>(null);
  const activePluginRef = useRef<IPlugin | null>(null);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    setStatus('loading');
    setErrorMessage('');

    void (async () => {
      try {
        const plugin = await installAndLoadPlugin(sourceUrl, pluginId, controller.signal);
        const mountPoint = mountRootRef.current;

        if (!mountPoint) {
          throw new Error('Plugin mount point does not exist.');
        }

        const context = createAppContext(pluginId);
        await plugin.mount(mountPoint, context);
        activePluginRef.current = plugin;
        setStatus('ready');
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        const message = error instanceof Error ? error.message : 'Unknown plugin load error.';
        setErrorMessage(message);
        setStatus('error');
      }
    })();

    return () => {
      controller.abort();
      const plugin = activePluginRef.current;
      const mountPoint = mountRootRef.current;

      activePluginRef.current = null;

      if (!plugin || !mountPoint) {
        return;
      }

      void Promise.resolve(plugin.unmount(mountPoint)).catch((error) => {
        console.error(`[PluginContainer] unmount failed for ${pluginId}`, error);
      });
    };
  }, [pluginId, sourceUrl]);

  return (
    <section className="plugin-shell" aria-live="polite">
      {status === 'loading' && (
        <div className="plugin-feedback loading-state" role="status">
          <div className="loader" />
          <p>Installing and mounting plugin...</p>
        </div>
      )}

      {status === 'error' && (
        <div className="plugin-feedback error-state" role="alert">
          <h3>Plugin failed to load</h3>
          <p>{errorMessage}</p>
        </div>
      )}

      <div
        ref={mountRootRef}
        className={`plugin-root ${status === 'ready' ? 'is-ready' : 'is-hidden'}`}
      />
    </section>
  );
}
