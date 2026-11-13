const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('autobot', {
  getModelConfig: () => ipcRenderer.invoke('model:get'),
  saveModelConfig: (value) => ipcRenderer.invoke('model:save', value),
  sendDesignMessage: (value) => ipcRenderer.invoke('design:message', value),
  sendRpaMessage: (value) => ipcRenderer.invoke('design:rpa-message', value),
  resetDesign: (mode) => ipcRenderer.invoke('design:reset', mode),
  runtimeStatus: (diagnose) => ipcRenderer.invoke('runtime:status', diagnose),
  recentRuns: () => ipcRenderer.invoke('runs:list'),
  taskRuns: (id) => ipcRenderer.invoke('runs:task', id),
  runDetail: (id) => ipcRenderer.invoke('runs:detail', id),
  exportFlow: () => ipcRenderer.invoke('flow:export'),
  exportDesign: () => ipcRenderer.invoke('design:export'),
  status: () => ipcRenderer.invoke('flow:status'),
  importFlow: () => ipcRenderer.invoke('flow:import'),
  selectFlow: (id) => ipcRenderer.invoke('flow:select', id),
  saveCredentials: (values) => ipcRenderer.invoke('flow:save-credentials', values),
  saveFlowPreferences: (value) => ipcRenderer.invoke('flow:preferences', value),
  onRunsChanged: (callback) => ipcRenderer.on('runs:changed', () => callback()),
  run: (options) => ipcRenderer.invoke('flow:run', options),
});
