const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', Object.freeze({
  isDesktop: true,
  getRuntimeInfo: () => ipcRenderer.invoke('desktop:get-runtime-info'),
  getDisplaySetup: () => ipcRenderer.invoke('desktop:get-display-setup'),
  identifyDisplay: (displayId) => ipcRenderer.invoke('desktop:identify-display', String(displayId)),
  saveDisplaySettings: (settings) => ipcRenderer.invoke('desktop:save-display-settings', settings),
  continuePreview: () => ipcRenderer.invoke('desktop:continue-preview'),
  openDisplaySetup: () => ipcRenderer.invoke('desktop:open-display-setup'),
  focusStage: () => ipcRenderer.invoke('desktop:focus-stage'),
  openOperationManual: () => ipcRenderer.invoke('desktop:open-operation-manual'),
  onDisplayWarning: (callback) => {
    const listener = (_event, warning) => callback(warning);
    ipcRenderer.on('desktop:display-warning', listener);
    return () => ipcRenderer.removeListener('desktop:display-warning', listener);
  }
}));
