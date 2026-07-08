import { app, BrowserWindow, ipcMain, Tray, nativeImage, Menu } from 'electron'
import { Monitor } from './monitor'
import { join } from 'path'

let mainWindow: BrowserWindow | null = null
let monitor: Monitor | null = null
let tray: Tray | null = null
let quitting = false

function createWindow() {
  const iconPath = join(__dirname, '../../resources/icon.png')

  mainWindow = new BrowserWindow({
    width: 560,
    height: 56,
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
  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
}

app.on('before-quit', () => {
  quitting = true
})

function createTray() {
  const iconPath = join(__dirname, '../../resources/icon.png')
  let trayIcon: ReturnType<typeof nativeImage.createFromPath>
  try {
    trayIcon = nativeImage.createFromPath(iconPath)
    if (trayIcon.isEmpty()) throw new Error('empty icon')
  } catch {
    trayIcon = nativeImage.createEmpty()
  }

  tray = new Tray(trayIcon)
  tray.setToolTip('RedBall')

  const ctx = Menu.buildFromTemplate([
    { label: '显示', click: () => showWindow() },
    { label: '退出', click: () => app.quit() }
  ])
  tray.setContextMenu(ctx)
  tray.on('double-click', () => showWindow())
}

function showWindow() {
  if (!mainWindow) return
  try {
    if (mainWindow.isDestroyed()) {
      createWindow()
      return
    }
  } catch {
    createWindow()
    return
  }
  mainWindow.show()
  mainWindow.focus()
}

app.whenReady().then(() => {
  quitting = false
  createWindow()
  createTray()

  monitor = new Monitor()
  monitor.start(stats => {
    mainWindow?.webContents.send('stats-update', stats)
  })

  ipcMain.on('move-window', (_event, dx: number, dy: number) => {
    if (!mainWindow) return
    const [x, y] = mainWindow.getPosition()
    mainWindow.setPosition(x + dx, y + dy)
  })

  ipcMain.on('toggle-always-on-top', () => {
    if (!mainWindow) return
    mainWindow.setAlwaysOnTop(!mainWindow.isAlwaysOnTop())
  })

  ipcMain.on('close-app', () => {
    if (!mainWindow) return
    mainWindow.hide()
  })

  ipcMain.on('get-autostart', (_event) => {
    _event.returnValue = app.getLoginItemSettings().openAtLogin
  })

  ipcMain.on('toggle-autostart', (_event, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true })
  })
})

app.on('window-all-closed', () => {
  monitor?.stop()
})
