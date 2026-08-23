interface SystemStats {
  cpu: number
  memPercent: number
  memUsed: number
  memTotal: number
  gpuPercent: number | null
  vramUsed: number | null
  vramTotal: number | null
  gpuTemp: number | null
  netRx: number
  netTx: number
  topProcs: { name: string; percent: number }[]
}

interface ElectronAPI {
  onStatsUpdate: (callback: (stats: SystemStats) => void) => void
  moveWindow: (dx: number, dy: number) => void
  toggleAlwaysOnTop: () => void
  getAlwaysOnTop: () => boolean
  closeApp: () => void
  getAutostart: () => boolean
  toggleAutostart: (enabled: boolean) => void
}

interface WindowWithElectron extends Window {
  electronAPI?: ElectronAPI
}

const api = (window as WindowWithElectron).electronAPI!

function fmtMem(gb: number): string {
  if (gb >= 10) return gb.toFixed(0) + 'G'
  return gb.toFixed(1) + 'G'
}

function fmtSpeed(kbps: number): string {
  // 260807 Red 补上单位 /s 和 B：此前只显示 "12.5M"，容易被误读成 Mb
  if (kbps >= 1024) return (kbps / 1024).toFixed(1) + 'MB/s'
  return kbps + 'KB/s'
}

function gpuTempClass(temp: number | null): string {
  if (temp === null) return ''
  if (temp < 55) return 'temp-safe'
  if (temp < 70) return 'temp-warn'
  return 'temp-crit'
}

function updateStats(s: SystemStats) {
  // CPU
  document.getElementById('cpu-val')!.textContent = s.cpu + '%'
  document.getElementById('cpu-fill')!.style.width = s.cpu + '%'

  // Memory
  document.getElementById('mem-val')!.textContent = fmtMem(s.memUsed) + ' / ' + fmtMem(s.memTotal)
  document.getElementById('mem-fill')!.style.width = s.memPercent + '%'

  // GPU
  const gpuFill = document.getElementById('gpu-fill')!
  const gpuVal = document.getElementById('gpu-val')!
  const gpuTempEl = document.getElementById('gpu-temp')!
  const vramFill = document.getElementById('vram-fill')!
  const vramVal = document.getElementById('vram-val')!

  if (s.gpuPercent !== null) {
    gpuFill.style.display = ''
    gpuVal.style.display = ''
    gpuVal.textContent = s.gpuPercent + '%'
    gpuFill.style.width = s.gpuPercent + '%'

    // GPU temperature
    gpuTempEl.textContent = s.gpuTemp != null ? s.gpuTemp + '°C' : '--°C'
    const tc = gpuTempClass(s.gpuTemp)
    gpuTempEl.className = 'val temp ' + tc

    // GPU bar color follows temperature
    gpuFill.className = 'bar-fill'
    if (s.gpuTemp !== null) {
      if (s.gpuTemp >= 70) gpuFill.classList.add('temp-crit')
      else if (s.gpuTemp >= 55) gpuFill.classList.add('temp-warn')
    }

    // VRAM
    if (s.vramUsed !== null && s.vramTotal !== null) {
      vramFill.style.display = ''
      vramVal.style.display = ''
      vramVal.textContent = fmtMem(s.vramUsed) + ' / ' + fmtMem(s.vramTotal)
      vramFill.style.width = (s.vramTotal > 0 ? (s.vramUsed / s.vramTotal * 100) : 0) + '%'
    } else {
      vramFill.style.display = 'none'
      vramVal.style.display = 'none'
    }
  } else {
    gpuFill.style.display = 'none'
    gpuVal.style.display = 'none'
    gpuTempEl.textContent = '--°C'
    gpuTempEl.className = 'val temp'
    vramFill.style.display = 'none'
    vramVal.style.display = 'none'
  }

  // Network
  document.getElementById('net-rx')!.textContent = fmtSpeed(s.netRx)
  document.getElementById('net-tx')!.textContent = fmtSpeed(s.netTx)

  // 260823 Red 进程 top3：单进程 ≥20%（≈半核）黄色警示，≥40%（≈1 核以上）红色
  const procList = document.getElementById('proc-list')!
  if (s.topProcs && s.topProcs.length > 0) {
    procList.replaceChildren()
    for (const p of s.topProcs) {
      const el = document.createElement('span')
      el.className = 'proc-item' + (p.percent >= 40 ? ' crit' : p.percent >= 20 ? ' warn' : '')
      el.textContent = p.name + ' ' + p.percent + '%'
      procList.appendChild(el)
    }
  } else {
    procList.textContent = '--'
  }
}

// --- Right-click menu ---

const menu = document.getElementById('menu')!
const menuAutostart = document.getElementById('menu-autostart')!
const menuPin = document.getElementById('menu-pin')!

document.addEventListener('contextmenu', (e: MouseEvent) => {
  e.preventDefault()
  menu.style.left = e.clientX + 'px'
  menu.style.top = e.clientY + 'px'
  menu.classList.remove('hidden')
})

document.addEventListener('click', () => {
  menu.classList.add('hidden')
})

// 260813 Red 窗口拖动改为 renderer 自实现：此前 #app 是 app-region drag，
// drag 区域会吞掉右键事件导致自定义菜单（置顶/开机自启/关闭）永远弹不出来。
// 现在用 move-window IPC 增量移动窗口，右键事件能正常到达页面。
let dragging = false
let lastX = 0
let lastY = 0

document.addEventListener('pointerdown', (e: PointerEvent) => {
  if (e.button !== 0) return
  // 菜单打开时点菜单项不触发拖动
  if (!menu.classList.contains('hidden')) return
  dragging = true
  lastX = e.screenX
  lastY = e.screenY
  // 260823 Red pointer capture：窗口只有 380x78，拖动时鼠标滑出窗口边框，
  // 不捕获的话 Chromium 立刻停止派发 mousemove，窗口就停在原地（拖不到副屏）。
  // capture 后鼠标飞出窗口仍持续派发，直到 mouseup/pointercancel。
  document.documentElement.setPointerCapture(e.pointerId)
})

document.addEventListener('pointermove', (e: PointerEvent) => {
  if (!dragging) return
  const dx = e.screenX - lastX
  const dy = e.screenY - lastY
  if (dx === 0 && dy === 0) return
  lastX = e.screenX
  lastY = e.screenY
  api.moveWindow(dx, dy)
})

document.addEventListener('pointerup', () => {
  dragging = false
})

document.addEventListener('pointercancel', () => {
  dragging = false
})

// 置顶开关：勾选状态与主进程 userTopmost 同步
menuPin.classList.toggle('checked', api.getAlwaysOnTop())
menuPin.addEventListener('click', () => {
  api.toggleAlwaysOnTop()
  menuPin.classList.toggle('checked')
})

menuAutostart.addEventListener('click', () => {
  const enabled = !api.getAutostart()
  api.toggleAutostart(enabled)
  menuAutostart.classList.toggle('checked', enabled)
})

document.getElementById('menu-close')!.addEventListener('click', () => {
  api.closeApp()
})

// --- Autostart initial state ---

menuAutostart.classList.toggle('checked', api.getAutostart())


// --- Listen for stats ---

api.onStatsUpdate(stats => updateStats(stats))
