import { useEffect, useRef, useState } from 'react';
import type { IPlugin } from '@toolbox/sdk';
import { createAppContext } from '../core/contextFactory';
import { installAndLoadPlugin } from '../core/pluginLoader';

interface PluginContainerProps {
  pluginId: string;
  sourceUrl: string;
  onReady?: (plugin: IPlugin) => void;
}

const MOUNT_WARN_TIMEOUT_MS = 6000;

export function PluginContainer({ pluginId, sourceUrl, onReady }: PluginContainerProps) {
  const mountRootRef = useRef<HTMLDivElement | null>(null);
  const activePluginRef = useRef<IPlugin | null>(null);
  const onReadyRef = useRef(onReady);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;

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
        const mountResult = plugin.mount(mountPoint, context);

        activePluginRef.current = plugin;

        if (!disposed) {
          setStatus('ready');
          onReadyRef.current?.(plugin);
        }

        // Some plugins return a long-running Promise from mount (or never resolve).
        // Do not block UI readiness on that Promise.
        if (mountResult && typeof (mountResult as Promise<unknown>).then === 'function') {
          const warnTimer = window.setTimeout(() => {
            console.warn(
              `[PluginContainer] mount Promise for "${pluginId}" is still pending after ${MOUNT_WARN_TIMEOUT_MS}ms.`
            );
          }, MOUNT_WARN_TIMEOUT_MS);

          void Promise.resolve(mountResult)
            .catch((error) => {
              if (disposed) {
                return;
              }

              const message = error instanceof Error ? error.message : 'Plugin mount failed.';
              setErrorMessage(message);
              setStatus('error');
            })
            .finally(() => {
              window.clearTimeout(warnTimer);
            });
        }
      } catch (error) {
        if (disposed || (error instanceof DOMException && error.name === 'AbortError')) {
          return;
        }

        const message = error instanceof Error ? error.message : 'Unknown plugin load error.';
        setErrorMessage(message);
        setStatus('error');
      }
    })();

    return () => {
      disposed = true;
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
        className={`plugin-root ${status === 'error' ? 'is-hidden' : 'is-ready'}`}
      />
    </section>
  );
}
