import type { IPlugin } from '@toolbox/sdk';

type RemoteContainer = {
  init: (shareScope: unknown) => Promise<void>;
  get: (module: string) => Promise<() => unknown>;
};

declare global {
  interface Window {
    [scope: string]: RemoteContainer | undefined;
  }

  // Webpack MF runtime globals.
  // eslint-disable-next-line no-var
  var __webpack_init_sharing__: ((scope: string) => Promise<void>) | undefined;
  // eslint-disable-next-line no-var
  var __webpack_share_scopes__: { default: unknown } | undefined;
}

const loadedRemoteUrls = new Set<string>();

function injectRemoteScript(url: string): Promise<void> {
  if (loadedRemoteUrls.has(url)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.type = 'text/javascript';
    script.async = true;

    script.onload = () => {
      loadedRemoteUrls.add(url);
      resolve();
    };

    script.onerror = () => {
      reject(new Error(`Failed to load remote script: ${url}`));
    };

    document.head.appendChild(script);
  });
}

export async function loadRemotePlugin(url: string, scope: string, module: string): Promise<IPlugin> {
  if (!url || !scope || !module) {
    throw new Error('loadRemotePlugin requires url, scope, and module.');
  }

  await injectRemoteScript(url);

  if (!__webpack_init_sharing__ || !__webpack_share_scopes__) {
    throw new Error('Webpack Module Federation runtime is unavailable.');
  }

  await __webpack_init_sharing__('default');

  const container = window[scope];
  if (!container) {
    throw new Error(`Remote scope "${scope}" is unavailable on window.`);
  }

  await container.init(__webpack_share_scopes__.default);

  const factory = await container.get(module);
  const mod = factory();
  const plugin = (mod as { default?: IPlugin }).default ?? (mod as IPlugin);

  if (!plugin || typeof plugin.mount !== 'function' || typeof plugin.unmount !== 'function') {
    throw new Error(`Remote module ${scope}/${module} does not export a valid IPlugin.`);
  }

  return plugin;
}
