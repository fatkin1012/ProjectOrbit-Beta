import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { IAppContext, IPlugin } from '@toolbox/sdk';
import { createStorageProxy } from '../storage/storageManager';
import { globalEventBus } from '../events/eventBus';
import { loadRemotePlugin } from '../mf/loadRemotePlugin';
import { ErrorBoundary } from './ErrorBoundary';

interface PluginContainerProps {
  pluginUrl: string;
  pluginId: string;
  scope: string;
  module: string;
  theme?: 'light' | 'dark';
  initialConfig?: Record<string, unknown>;
}

type ViewState =
  | { phase: 'idle' | 'loading' }
  | { phase: 'ready' }
  | { phase: 'error'; message: string };

export function PluginContainer({
  pluginUrl,
  pluginId,
  scope,
  module,
  theme = 'light',
  initialConfig = {}
}: PluginContainerProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mountedPluginRef = useRef<IPlugin | null>(null);
  const [viewState, setViewState] = useState<ViewState>({ phase: 'idle' });

  const context = useMemo<IAppContext>(() => {
    return {
      storage: createStorageProxy(pluginId),
      eventBus: globalEventBus,
      theme,
      initialConfig
    };
  }, [initialConfig, pluginId, theme]);

  useEffect(() => {
    let isCancelled = false;

    async function mountPlugin(): Promise<void> {
      if (!containerRef.current) {
        return;
      }

      setViewState({ phase: 'loading' });

      try {
        const plugin = await loadRemotePlugin(pluginUrl, scope, module);

        if (plugin.id !== pluginId) {
          throw new Error(
            `Plugin identity mismatch. expected=${pluginId}, actual=${plugin.id}`
          );
        }

        await plugin.mount(containerRef.current, context);

        if (!isCancelled) {
          mountedPluginRef.current = plugin;
          setViewState({ phase: 'ready' });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown plugin load error';
        if (!isCancelled) {
          setViewState({ phase: 'error', message });
        }
      }
    }

    void mountPlugin();

    return () => {
      isCancelled = true;

      const plugin = mountedPluginRef.current;
      const container = containerRef.current;

      if (plugin && container) {
        void Promise.resolve(plugin.unmount(container)).catch((error: unknown) => {
          console.error(`[PluginContainer] unmount failed for ${plugin.id}`, error);
        });
      }

      mountedPluginRef.current = null;
    };
  }, [context, module, pluginId, pluginUrl, scope]);

  return (
    <ErrorBoundary>
      <section className="plugin-shell" data-plugin-id={pluginId}>
        {viewState.phase === 'loading' && (
          <div className="plugin-state plugin-state--loading">Loading plugin...</div>
        )}

        {viewState.phase === 'error' && (
          <div className="plugin-state plugin-state--error">
            <h3>Plugin Load Failed</h3>
            <p>{viewState.message}</p>
          </div>
        )}

        <div
          ref={containerRef}
          className={viewState.phase === 'ready' ? 'plugin-mount is-ready' : 'plugin-mount'}
        />
      </section>
    </ErrorBoundary>
  );
}
