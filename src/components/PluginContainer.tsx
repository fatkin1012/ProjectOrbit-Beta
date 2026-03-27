import { useEffect, useRef, useState } from 'react';
import type { IPlugin } from '@toolbox/sdk';
import { createAppContext } from '../core/contextFactory';
import { installAndLoadPlugin } from '../core/pluginLoader';
import { ensureStorageReady } from '../core/storageManager';

interface PluginContainerProps {
  pluginId: string;
  sourceUrl: string;
  mode?: 'embedded' | 'fullpage';
  onReady?: (plugin: IPlugin) => void;
}

const MOUNT_WARN_TIMEOUT_MS = 6000;
const CONTAINER_LOG_PREFIX = '[PluginContainer:debug]';

function getStylesheetCount(): number {
  try {
    return document.styleSheets.length;
  } catch {
    return -1;
  }
}

async function waitForMountReady(node: HTMLElement, timeoutMs = 1200): Promise<void> {
  const start = performance.now();

  await new Promise<void>((resolve) => {
    const check = () => {
      if (node.clientWidth > 0 && node.clientHeight > 0) {
        resolve();
        return;
      }

      if (performance.now() - start >= timeoutMs) {
        resolve();
        return;
      }

      window.requestAnimationFrame(check);
    };

    check();
  });
}

export function PluginContainer({
  pluginId,
  sourceUrl,
  mode = 'embedded',
  onReady
}: PluginContainerProps) {
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

    console.info(`${CONTAINER_LOG_PREFIX} load cycle start`, {
      pluginId,
      sourceUrl,
      mode,
      stylesheetCount: getStylesheetCount()
    });

    void (async () => {
      try {
        const plugin = await installAndLoadPlugin(sourceUrl, pluginId, controller.signal);
        const mountPoint = mountRootRef.current;

        console.info(`${CONTAINER_LOG_PREFIX} plugin loaded`, {
          requestedPluginId: pluginId,
          resolvedPluginId: plugin.id,
          pluginName: plugin.name,
          pluginVersion: plugin.version
        });

        if (!mountPoint) {
          throw new Error('Plugin mount point does not exist.');
        }

        await waitForMountReady(mountPoint);

        // Ensure storage is ready before mounting plugin
        const storageReady = await ensureStorageReady();
        if (!storageReady) {
          console.warn(`${CONTAINER_LOG_PREFIX} storage initialization failed, continuing with degraded storage support`);
        }

        const beforeMountStylesheetCount = getStylesheetCount();
        console.info(`${CONTAINER_LOG_PREFIX} mount start`, {
          pluginId,
          beforeMountStylesheetCount,
          mountWidth: mountPoint.clientWidth,
          mountHeight: mountPoint.clientHeight,
          storageReady
        });

        const context = createAppContext(pluginId);
        const mountResult = plugin.mount(mountPoint, context);

        activePluginRef.current = plugin;

        window.setTimeout(() => {
          if (disposed) {
            return;
          }

          console.info(`${CONTAINER_LOG_PREFIX} post-mount snapshot`, {
            pluginId,
            afterMountStylesheetCount: getStylesheetCount(),
            childElementCount: mountPoint.childElementCount,
            firstChildTagName: mountPoint.firstElementChild?.tagName ?? null
          });
        }, 0);

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

              console.error(`${CONTAINER_LOG_PREFIX} mount promise rejected`, {
                pluginId,
                error
              });
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

        console.error(`${CONTAINER_LOG_PREFIX} load cycle failed`, {
          pluginId,
          sourceUrl,
          error
        });
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

      console.info(`${CONTAINER_LOG_PREFIX} unmount start`, {
        pluginId,
        childElementCount: mountPoint.childElementCount,
        stylesheetCount: getStylesheetCount()
      });

      void Promise.resolve(plugin.unmount(mountPoint)).catch((error) => {
        console.error(`[PluginContainer] unmount failed for ${pluginId}`, error);
      });
    };
  }, [pluginId, sourceUrl]);

  return (
    <section className={`plugin-shell ${mode === 'fullpage' ? 'plugin-shell-fullpage' : ''}`} aria-live="polite">
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
        className={`plugin-root ${mode === 'fullpage' ? 'plugin-root-fullpage' : ''} ${status === 'error' ? 'is-hidden' : 'is-ready'}`}
      />
    </section>
  );
}
