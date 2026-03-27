const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__ORBIT_DESKTOP__', {
  installedPlugins: {
    async get() {
      return await ipcRenderer.invoke('orbit:installedPlugins:get');
    },
    async set(payload) {
      return await ipcRenderer.invoke('orbit:installedPlugins:set', payload);
    }
  }
});
