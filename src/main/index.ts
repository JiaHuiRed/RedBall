import { app, BrowserWindow, ipcMain, Tray, nativeImage, Menu } from 'electron'
import { Monitor } from './monitor'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { applyAcrylic } from './acrylic'


let mainWindow: BrowserWindow | null = null
let monitor: Monitor | null = null
let tray: Tray | null = null
let quitting = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
let topmostGuard: ReturnType<typeof setInterval> | null = null
// 260813 Red 置顶意图标志：不用 isAlwaysOnTop() 判断——Electron 该 API 返回内部缓存，
// 窗口被系统踢出 topmost 带（UAC/全屏切换等）后缓存仍是 true，守护会永远不触发。
// 只要用户没手动取消置顶，就无条件周期重设，把窗口拉回最前。
let userTopmost = true

// 260823 Red 面板固定尺寸：setPosition 在 Windows 高 DPI 下有尺寸漂移 bug（见 move-window），
// 全局常量供 setBounds/resize 钳制用
const WIN_W = 380
const WIN_H = 78

// 260812 Red 置顶自愈：Windows 的 topmost 带会被其他置顶窗口/系统事件挤占，
// 且被挤下去后不会自动回来。周期重设 setAlwaysOnTop(true) 把窗口拉回最前；
// 用户手动取消置顶（右键菜单）后跳过，不打扰。
function startTopmostGuard() {
  if (topmostGuard) clearInterval(topmostGuard)
  topmostGuard = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed() || quitting) return
    if (!mainWindow.isVisible() || !userTopmost) return
    mainWindow.setAlwaysOnTop(true)
  }, 10000)
}

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
  // 260808 Red 分平台毛玻璃；260823 Red 统一透明窗口 + DWM 亚克力（Win11 native tint 不可控，实测灰蒙蒙，见 acrylic.ts）
  mainWindow = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    frame: false,
    transparent: true,
    backgroundMaterial: 'none',
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: false,
    icon: winIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  applyAcrylic(mainWindow)

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

  // 260823 Red 尺寸钳制：Electron 42 在 Windows 高 DPI（150%）下 transparent+frameless 窗口
  // setPosition 会让 DWM 把尺寸误增（实测 size += 每次位移 dx/dy，从 380x78 一路涨到 640x464）。
  // 任何路径把窗口改大，立即用 setSize 拉回固定尺寸（相等时不再调用，防循环）。
  mainWindow.on('resize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const [w, h] = mainWindow.getSize()
    if (w !== WIN_W || h !== WIN_H) mainWindow.setSize(WIN_W, WIN_H)
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
  if (topmostGuard) {
    clearInterval(topmostGuard)
    topmostGuard = null
  }
})

function toggleTopmost() {
  if (!mainWindow) return
  userTopmost = !userTopmost
  mainWindow.setAlwaysOnTop(userTopmost)
  // 托盘菜单勾选状态随动
  tray?.setContextMenu(buildTrayMenu())
}

// 260813 Red 托盘加置顶开关：窗口右键自定义菜单因 drag 区域吞事件一直弹不出来，
// 用户没有任何入口能操作置顶，托盘补一个
function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: '显示', click: () => showWindow() },
    { label: '置顶', type: 'checkbox', checked: userTopmost, click: toggleTopmost },
    { label: '退出', click: () => app.quit() }
  ])
}

function createTray() {
  // 260721 Red 改用 raw RGBA 生成托盘图标，16x16 适合通知区域
  const trayIcon = createDotIcon(16, 220, 40, 40)

  tray = new Tray(trayIcon)
  tray.setToolTip('RedBall')

  tray.setContextMenu(buildTrayMenu())
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
  // 260812 Red Windows 上 hide → show 后置顶标志可能丢失（Electron 已知问题），补一次
  if (userTopmost) mainWindow.setAlwaysOnTop(true)
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
    startTopmostGuard()

    monitor = new Monitor()

    monitor.start(stats => {
      mainWindow?.webContents.send('stats-update', stats)
    })

    ipcMain.on('move-window', (_event, dx: number, dy: number) => {
      if (!mainWindow) return
      const [x, y] = mainWindow.getPosition()
      // 260823 Red 用 setBounds 固定尺寸：只用 setPosition（旧代码）在高 DPI 屏上
      // 每次位移 dx/dy 都会让 DWM 把窗口尺寸误增 dx/dy，拖动几次就全屏化。
      mainWindow.setBounds({ x: x + dx, y: y + dy, width: WIN_W, height: WIN_H })
    })

    ipcMain.on('toggle-always-on-top', () => toggleTopmost())

    ipcMain.on('get-always-on-top', (event) => {
      event.returnValue = userTopmost
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
