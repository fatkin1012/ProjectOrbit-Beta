/// <reference types="vite/client" />

declare global {
  interface Window {
    __TOOLBOX_HOST__?: {
      version: string;
      startedAt: number;
    };
  }
}

export {};
