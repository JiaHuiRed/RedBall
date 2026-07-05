import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { Monitor } from './monitor'

let mainWindow: BrowserWindow | null = null
let monitor: Monitor | null = null

function createWindow() {
  const iconPath = join(__dirname, '../../resources/icon.png')

  mainWindow = new BrowserWindow({
    width: 236,
    height: 184,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    hasShadow: false,
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  mainWindow.setVisibleOnAllWorkspaces(true)
}

app.whenReady().then(() => {
  createWindow()

  monitor = new Monitor()
  monitor.start(stats => {
    mainWindow?.webContents.send('stats-update', stats)
  })

  ipcMain.on('move-window', (_event, dx: number, dy: number) => {
    if (!mainWindow) return
    const [x, y] = mainWindow.getPosition()
    mainWindow.setPosition(x + dx, y + dy)
  })

  ipcMain.on('close-app', () => {
    app.quit()
  })
})

app.on('window-all-closed', () => {
  monitor?.stop()
  app.quit()
})
