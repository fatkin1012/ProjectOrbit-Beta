/// <reference types="vite/client" />

declare global {
  interface Window {
    __TOOLBOX_HOST__?: {
      version: string;
      startedAt: number;
    };
    __ORBIT_DESKTOP__?: {
      installedPlugins: {
        get: () => Promise<string | null>;
        set: (payload: string) => Promise<boolean>;
      };
    };
  }
}

export {};
