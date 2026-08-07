import { app, BrowserWindow, ipcMain, Tray, nativeImage, Menu } from 'electron'
import { Monitor } from './monitor'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'


let mainWindow: BrowserWindow | null = null
let monitor: Monitor | null = null
let tray: Tray | null = null
let quitting = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

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

// 260721 Red 生成纯色圆点图标（BGRA raw buffer），避免文件/格式依赖
function createDotIcon(size: number, r: number, g: number, b: number): Electron.NativeImage {
  const buf = Buffer.alloc(size * size * 4)
  const cx = (size - 1) / 2
  const cy = (size - 1) / 2
  const radius = (size - 2) / 2
  const pupilCx = cx
  const pupilCy = cy - size * 0.1
  const pupilR = Math.max(1, size * 0.18)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const dx = x - cx, dy = y - cy
      if (Math.sqrt(dx * dx + dy * dy) <= radius) {
        const px = x - pupilCx, py = y - pupilCy
        if (Math.sqrt(px * px + py * py) <= pupilR) {
          // 白色瞳孔 — Windows 字节序为 BGRA
          buf[i] = 255; buf[i + 1] = 255; buf[i + 2] = 255; buf[i + 3] = 255
        } else {
          // B G R A
          buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = 255
        }
      } else {
        buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 0
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size })
}

function createWindow() {
  // 260721 Red 改用 raw RGBA 生成，不受 PNG 解码/文件路径影响
  const winIcon = createDotIcon(32, 220, 40, 40)

  // 260802 Red 隐藏任务栏图标：窗口可通过托盘显示/隐藏，无需任务栏入口
  mainWindow = new BrowserWindow({
    width: 380,
    height: 56,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    icon: winIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.setIcon(winIcon)

  // 260719 Red 恢复上次保存的窗口位置
  const savedPos = loadPosition()
  if (savedPos) {
    mainWindow.setPosition(savedPos.x, savedPos.y)
  }

  mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  mainWindow.setVisibleOnAllWorkspaces(true)

  // 260719 Red 窗口移动时保存位置；260807 Red 加 300ms 防抖，拖动过程不必每像素写盘
  mainWindow.on('move', () => {
    if (!mainWindow) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => savePosition(mainWindow!), 300)
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
  // 260721 Red 改用 raw RGBA 生成托盘图标，16x16 适合通知区域
  const trayIcon = createDotIcon(16, 220, 40, 40)

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

// 260807 Red 单实例锁：自启与手动启动同时发生时只保留一个实例，避免双份采集进程互抢窗口位置
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  // 260807 Red 二次启动时唤起已有实例的窗口
  app.on('second-instance', () => showWindow())

  app.whenReady().then(() => {
    // 260802 Red AppUserModelId 必须在创建窗口之前设置，否则任务栏图标可能丢失
    app.setAppUserModelId('com.redball.monitor')
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
}
