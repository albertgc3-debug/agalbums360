const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getAppState: () => ipcRenderer.invoke('get-app-state'),
  setLanguage: (language) => ipcRenderer.invoke('set-language', language),
  pickVtourFile: () => ipcRenderer.invoke('pick-vtour-file'),
  openVtour: (vtourPath) => ipcRenderer.invoke('open-vtour', vtourPath),
  onLogMessage: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('log-message', handler)
    return () => ipcRenderer.removeListener('log-message', handler)
  },
  onProgressUpdate: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('progress-update', handler)
    return () => ipcRenderer.removeListener('progress-update', handler)
  }
})
