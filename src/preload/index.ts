import { contextBridge, ipcRenderer } from 'electron'

 contextBridge.exposeInMainWorld('electronAPI', {
  onStatsUpdate: (callback: (stats: unknown) => void) => {
    ipcRenderer.on('stats-update', (_event, stats) => callback(stats))
  },
  moveWindow: (dx: number, dy: number) => {
    ipcRenderer.send('move-window', dx, dy)
  },
  toggleAlwaysOnTop: () => {
    ipcRenderer.send('toggle-always-on-top')
  },
  closeApp: () => {
    ipcRenderer.send('close-app')
  },
  getAutostart: (): boolean => ipcRenderer.sendSync('get-autostart'),
  toggleAutostart: (enabled: boolean) => {
    ipcRenderer.send('toggle-autostart', enabled)
  }
})
