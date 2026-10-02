/**
 * The only bridge between the kiosk UI and the machine. Everything is an
 * explicit, named channel — the renderer never touches node directly, which
 * matters because this box sits unattended in public with a camera on it.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('booth', {
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    save: next => ipcRenderer.invoke('config:save', next),
    reload: () => ipcRenderer.invoke('config:reload'),
  },
  printers: {
    list: () => ipcRenderer.invoke('printers:list'),
    print: args => ipcRenderer.invoke('print:image', args),
    use: (name, role) => ipcRenderer.invoke('printers:use', name, role),
    papers: () => ipcRenderer.invoke('printers:papers'),
    method: m => ipcRenderer.invoke('printers:method', m),
  },
  cards: {
    nextMint: args => ipcRenderer.invoke('cards:nextMint', args),
    record: card => ipcRenderer.invoke('cards:record', card),
    stats: args => ipcRenderer.invoke('cards:stats', args),
  },
  sales: {
    record: sale => ipcRenderer.invoke('sales:record', sale),
    summary: () => ipcRenderer.invoke('sales:summary'),
  },
  media: {
    save: args => ipcRenderer.invoke('media:save', args),
  },
  // Tethered camera (camera.stills): live view frames and full-res captures.
  stills: {
    status: () => ipcRenderer.invoke('stills:status'),
    liveview: () => ipcRenderer.invoke('stills:liveview'),
    capture: () => ipcRenderer.invoke('stills:capture'),
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    quit: () => ipcRenderer.invoke('app:quit'),
    reload: () => ipcRenderer.invoke('app:reload'),
    cameraHolders: () => ipcRenderer.invoke('app:cameraHolders'),
  },
});
