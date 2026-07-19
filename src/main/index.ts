import { app, BrowserWindow, ipcMain, Tray, nativeImage, Menu } from 'electron'
import { Monitor } from './monitor'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'

let mainWindow: BrowserWindow | null = null
let monitor: Monitor | null = null
let tray: Tray | null = null
let quitting = false

// 260719 Red 窗口位置记忆：读写 userData 下的 window-position.json
function getPositionFile(): string {
  return join(app.getPath('userData'), 'window-position.json')
}

function loadPosition(): { x: number; y: number } | null {
  try {
    const data = readFileSync(getPositionFile(), 'utf8')
    const pos = JSON.parse(data)
    if (typeof pos.x === 'number' && typeof pos.y === 'number') return pos
  } catch { /* 不存在或损坏 */ }
  return null
}

function savePosition(win: BrowserWindow) {
  const [x, y] = win.getPosition()
  try {
    writeFileSync(getPositionFile(), JSON.stringify({ x, y }))
  } catch { /* 忽略写入失败 */ }
}

// 260719 Red 托盘图标路径：打包后用 process.resourcesPath
function getIconPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'icon.png')
  }
  return join(__dirname, '../../resources/icon.png')
}

function createWindow() {
  const iconPath = getIconPath()

  mainWindow = new BrowserWindow({
    width: 320,
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

  // 260719 Red 恢复上次保存的窗口位置
  const savedPos = loadPosition()
  if (savedPos) {
    mainWindow.setPosition(savedPos.x, savedPos.y)
  }

  mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  mainWindow.setVisibleOnAllWorkspaces(true)

  // 260719 Red 窗口移动时保存位置
  mainWindow.on('move', () => {
    if (mainWindow) savePosition(mainWindow)
  })

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
  const iconPath = getIconPath()
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
