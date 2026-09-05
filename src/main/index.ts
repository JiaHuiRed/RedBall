import { app, BrowserWindow, ipcMain, Tray, nativeImage, Menu, screen } from 'electron'
import { Monitor } from './monitor'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { applyAcrylic, ensureRealTopmost } from './acrylic'


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
// 260905 Red 守护补自愈路径：原守护只处理"可见但被挤出 topmost 带"，
// 现在发现窗口被系统藏掉（非用户主动隐藏）时也拉回来——游戏独占全屏
// 会藏置顶窗口，Electron transparent 窗口被藏后不会自动恢复，只能托盘救。
function startTopmostGuard() {
  if (topmostGuard) clearInterval(topmostGuard)
  topmostGuard = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed() || quitting) return
    if (!userTopmost) return
    if (mainWindow.isVisible()) {
      // 260905 Red 不再用 setAlwaysOnTop（Electron 缓存短路，踢出带后重设无效），
      // 改为 FFI 查真实 topmost 位、缺位强插；游戏全屏占前台时系统拒绝插入，
      // 等游戏退出后守护下一轮自动救回
      ensureRealTopmost(mainWindow)
    } else if (!userHiddenByUser) {
      // 260905 Red 被全屏游戏藏掉的窗口自动恢复。
      // 用 showInactive 不抢焦点：守护周期触发，showWindow 的 focus() 会每 10 秒
      // 把全屏游戏打回桌面，比窗口消失还烦
      mainWindow.showInactive()
      ensureRealTopmost(mainWindow)
    }
      // 260905 Red 守护 1s 一跳：FFI 查位开销极小；全屏压制一结束球 1s 内自动回，
      // 原 10s 周期退出全屏后要干等
    }, 1000)
  }

// 260905 Red 全屏游戏自愈标志：区分"用户主动隐藏"（托盘关闭/右键菜单）与
// "系统藏掉"（游戏独占全屏时 Windows 会藏所有置顶窗口，Electron transparent 窗口
// 被藏后不会自动恢复）。只有用户主动隐藏才允许窗口保持不可见。
let userHiddenByUser = false

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

// 260905 Red 位置钳制：pointer capture 拖动可以把窗口甩出屏幕外，位置还会写进
// 配置文件，重启后窗口回到屏幕外、UI 上无路可救。存/取都按虚拟桌面边界钳一次，
// 保证窗口至少有 40px 留在屏幕内。
function clampPosition(x: number, y: number): { x: number; y: number } {
  const margin = 40
  const displays = screen.getAllDisplays()
  const left = Math.min(...displays.map(d => d.workArea.x))
  const top = Math.min(...displays.map(d => d.workArea.y))
  const right = Math.max(...displays.map(d => d.workArea.x + d.workArea.width))
  const bottom = Math.max(...displays.map(d => d.workArea.y + d.workArea.height))
  return {
    x: Math.min(Math.max(x, left - WIN_W + margin), right - margin),
    y: Math.min(Math.max(y, top - WIN_H + margin), bottom - margin)
  }
}

function savePosition(win: BrowserWindow) {
  // 260905 Red 保存前钳制，屏幕外位置不入盘
  const [rawX, rawY] = win.getPosition()
  const { x, y } = clampPosition(rawX, rawY)
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

  // 260719 Red 恢复上次保存的窗口位置；260905 Red 恢复前钳制，屏幕外的旧存档也能救回来
  const savedPos = loadPosition()
  if (savedPos) {
    const fixed = clampPosition(savedPos.x, savedPos.y)
    mainWindow.setPosition(fixed.x, fixed.y)
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
      // 260905 Red 用户点关闭 = 主动隐藏，守护不要把它拉回来
      userHiddenByUser = true
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
  // 260905 Red 手动显示过就算用户意图恢复，守护不再重复救
  userHiddenByUser = false
  // 260905 Red 同守护：真实位缺失时 FFI 强插，绕开 Electron 缓存短路
  if (userTopmost) ensureRealTopmost(mainWindow)
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
      // 260905 Red 用户主动隐藏，守护不要拉回
      userHiddenByUser = true
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
