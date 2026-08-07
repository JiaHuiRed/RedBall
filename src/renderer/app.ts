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
}

interface ElectronAPI {
  onStatsUpdate: (callback: (stats: SystemStats) => void) => void
  moveWindow: (dx: number, dy: number) => void
  toggleAlwaysOnTop: () => void
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
  if (kbps >= 1024) return (kbps / 1024).toFixed(1) + 'M'
  return kbps + 'K'
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
}

// --- Right-click menu ---

const menu = document.getElementById('menu')!
const menuAutostart = document.getElementById('menu-autostart')!

document.addEventListener('contextmenu', (e: MouseEvent) => {
  e.preventDefault()
  menu.style.left = e.clientX + 'px'
  menu.style.top = e.clientY + 'px'
  menu.classList.remove('hidden')
})

document.addEventListener('click', () => {
  menu.classList.add('hidden')
})

document.getElementById('menu-pin')!.addEventListener('click', () => {
  api.toggleAlwaysOnTop()
})

document.getElementById('menu-autostart')!.addEventListener('click', () => {
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
