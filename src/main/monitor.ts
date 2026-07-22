import { execSync, spawn, ChildProcess } from 'child_process'
import * as os from 'os'
import { join } from 'path'
import { existsSync, statSync, openSync, readSync, closeSync, writeFileSync } from 'fs'

interface NetSample {
  rx: number
  tx: number
}

export interface SystemStats {
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
  fps: number | null
  fpsApp: string | null
}

export class Monitor {
  private prevNet: NetSample | null = null
  private gpuAvailable = true
  private timer: ReturnType<typeof setInterval> | null = null
  private cpuUtil = 0
  private cpuProcess: ChildProcess | null = null
  private gpuCache: { gpuPercent: number | null; vramUsed: number | null; vramTotal: number | null; gpuTemp: number | null } = { gpuPercent: null, vramUsed: null, vramTotal: null, gpuTemp: null }
  private tickCount = 0
  // 260719 Red 唤醒恢复：每 30 秒重置 gpuAvailable，避免 sleep/wake 后永久锁死
  private static readonly GPU_RETRY_INTERVAL = 30

  // 260722 Red FPS 监控
  private fpsStats: { fps: number | null; app: string | null } = { fps: null, app: null }
  private csvPath = ''
  private csvReadPos = 0
  private csvColumns: string[] = []
  // 260722 Red 每个进程保持最近 120 帧数据用于计算平均 FPS
  private fpsFrames = new Map<string, number[]>()
  private static readonly MAX_FPS_FRAMES = 120

  start(callback: (stats: SystemStats) => void, presentMonPath?: string) {
    if (presentMonPath) this.startFpsMonitor(presentMonPath)
    this.startCpuMonitor()
    this.timer = setInterval(() => callback(this.getStats()), 1000)
  }

  stop() {
    this.stopFpsMonitor()
    if (this.cpuProcess) {
      this.cpuProcess.kill()
      this.cpuProcess = null
    }
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private startCpuMonitor() {
    try {
      const proc = spawn('typeperf', [
        '\\Processor Information(_Total)\\% Processor Utility',
        '-si', '1'
      ], {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true
      })

      let buffer = ''
      proc.stdout!.on('data', (data: Buffer) => {
        buffer += data.toString()
        // Scan for CSV field separator '","' — typeperf output may split across chunks
        let idx = 0
        while ((idx = buffer.indexOf('","', idx)) >= 0) {
          const start = idx + 3 // skip '","' and the opening quote of the value field
          const end = buffer.indexOf('"', start)
          if (end < 0) break
          const val = parseFloat(buffer.substring(start, end))
          if (!isNaN(val)) this.cpuUtil = Math.round(val)
          idx = end + 1
        }
        // Trim buffer to prevent memory leak
        if (buffer.length > 2048) {
          const nl = buffer.lastIndexOf('\n')
          buffer = nl >= 0 ? buffer.substring(nl + 1) : buffer.substring(buffer.length - 2000)
        }
      })

      proc.on('error', () => { /* typeperf not available */ })
      proc.on('exit', () => { this.cpuProcess = null })
      this.cpuProcess = proc
    } catch { /* typeperf not available */ }
  }

  private getNetSample(): NetSample {
    try {
      const out = execSync('chcp 437 >nul && netstat -e 2>nul', { encoding: 'utf8', timeout: 2000 })
      const lines = out.split('\n')
      const bytesLine = lines.find((l: string) => {
        const t = l.trim()
        return t.startsWith('Bytes') || t.startsWith('字节')
      })
      if (bytesLine) {
        const parts = bytesLine.trim().split(/\s+/)
        return {
          rx: parseInt(parts[1].replace(/,/g, '')) || 0,
          tx: parseInt(parts[2].replace(/,/g, '')) || 0
        }
      }
    } catch { /* netstat not available */ }
    return { rx: 0, tx: 0 }
  }

  private getGpuInfo() {
    if (!this.gpuAvailable) {
      return { gpuPercent: null, vramUsed: null, vramTotal: null, gpuTemp: null }
    }
    try {
      const out = execSync(
        'nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits',
        { encoding: 'utf8', timeout: 3000 }
      )
      const parts = out.trim().split(', ')
      return {
        gpuPercent: parts[0] ? parseFloat(parts[0]) : null,
        vramUsed: parts[1] ? parseFloat(parts[1]) : null,
        vramTotal: parts[2] ? parseFloat(parts[2]) : null,
        gpuTemp: parts[3] ? parseFloat(parts[3]) : null
      }
    } catch {
      this.gpuAvailable = false
      return { gpuPercent: null, vramUsed: null, vramTotal: null, gpuTemp: null }
    }
  }

  // 260722 Red ── FPS 监控（通过 PresentMon 子进程）──

  private startFpsMonitor(presentMonPath: string) {
    const csvPath = join(os.tmpdir(), 'redball_presentmon.csv')
    const batPath = join(os.tmpdir(), 'redball_pm.bat')

    // 260722 Red 生成 bat 脚本：提权清理旧进程 → 启动 PresentMon（stdout 重定向到 CSV）
    const batContent = [
      '@echo off',
      `taskkill /f /im PresentMon.exe >nul 2>&1`,
      `del /f /q "${csvPath}" >nul 2>&1`,
      `"${presentMonPath}" --output_stdout --no_console_stats --stop_existing_session > "${csvPath}" 2>nul`
    ].join('\r\n')
    writeFileSync(batPath, batContent, 'utf8')

    this.csvPath = csvPath
    this.csvReadPos = 0
    this.csvColumns = []
    this.fpsFrames.clear()
    this.fpsStats = { fps: null, app: null }

    // 通过一次 UAC 提权运行 bat（清理 + 启动），PowerShell 不等待立即返回
    try {
      spawn('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-WindowStyle', 'Hidden',
        '-Command',
        `Start-Process cmd.exe -Verb RunAs -WindowStyle Hidden -ArgumentList '/c "${batPath}"'`
      ], { stdio: 'ignore', windowsHide: true })
    } catch { /* 提权启动失败，FPS 不可用 */ }
  }

  private stopFpsMonitor() {
    // 尝试非提权结束 PresentMon（若失败则下次启动时 bat 会自行清理）
    try {
      execSync('taskkill /f /im PresentMon.exe', { stdio: 'ignore', timeout: 3000 })
    } catch { /* 可能未运行或需提权，忽略 */ }
    this.fpsFrames.clear()
  }

  private readFpsCsv() {
    if (!this.csvPath) return
    try {
      if (!existsSync(this.csvPath)) return
      const st = statSync(this.csvPath)
      if (st.size <= this.csvReadPos) return

      const fd = openSync(this.csvPath, 'r')
      const bufLen = st.size - this.csvReadPos
      const buf = Buffer.alloc(bufLen)
      readSync(fd, buf, 0, bufLen, this.csvReadPos)
      closeSync(fd)
      this.csvReadPos = st.size

      const newText = buf.toString('utf8')
      const lines = newText.split('\n').filter(l => l.trim().length > 0)

      for (const line of lines) {
        // 第一次读到的行如果是表头就缓存列索引
        if (this.csvColumns.length === 0 && line.startsWith('Application')) {
          this.csvColumns = line.split(',')
          continue
        }
        if (this.csvColumns.length === 0) continue // 表头还没读到，跳过

        const vals = line.split(',')
        if (vals.length < 12) continue

        const app = vals[0]
        // MsBetweenPresents = 列索引 10
        const msBetweenPresents = parseFloat(vals[10])
        if (!isNaN(msBetweenPresents) && msBetweenPresents > 0) {
          if (!this.fpsFrames.has(app)) this.fpsFrames.set(app, [])
          const frames = this.fpsFrames.get(app)!
          frames.push(msBetweenPresents)
          if (frames.length > Monitor.MAX_FPS_FRAMES) frames.shift()
        }
      }

      // 找出 FPS 最高的进程（大概率是游戏）
      let bestFps = 0
      let bestApp = ''
      for (const [app, frameTimes] of this.fpsFrames) {
        if (frameTimes.length < 3) continue
        // 取最近的帧数据计算平均，排除极端值
        const recent = frameTimes.slice(-60)
        const avg = recent.reduce((a, b) => a + b, 0) / recent.length
        const fps = avg > 0 ? Math.round(1000 / avg) : 0
        if (fps > bestFps) {
          bestFps = fps
          bestApp = app
        }
      }

      this.fpsStats = bestFps > 0 ? { fps: bestFps, app: bestApp } : { fps: null, app: null }
    } catch { /* CSV 读取失败，FPS 不可用 */ }
  }

  private getStats(): SystemStats {
    this.tickCount++

    // 260722 Red 每 tick 读取 FPS 数据
    this.readFpsCsv()

    // 260719 Red 每 30 秒重置 gpuAvailable，sleep/wake 后能自动恢复
    if (this.tickCount % Monitor.GPU_RETRY_INTERVAL === 0) this.gpuAvailable = true

    // GPU: cache for 3 ticks to reduce blocking execSync
    if (this.tickCount % 3 === 1) this.gpuCache = this.getGpuInfo()

    // Network (deferred: first net sample taken on first tick, not at startup)
    const netSample = this.getNetSample()
    let netRx = 0
    let netTx = 0
    if (this.prevNet) {
      const rxDelta = netSample.rx - this.prevNet.rx
      const txDelta = netSample.tx - this.prevNet.tx
      netRx = rxDelta > 0 ? Math.round(rxDelta / 1024) : 0
      netTx = txDelta > 0 ? Math.round(txDelta / 1024) : 0
    }
    this.prevNet = netSample

    // CPU (from typeperf background process — already async)
    const cpuPercent = this.cpuUtil

    // Memory (fast, sync, no I/O)
    const totalMem = os.totalmem()
    const usedMem = totalMem - os.freemem()
    const memPercent = Math.round(100 * usedMem / totalMem)

    return {
      cpu: cpuPercent,
      memPercent,
      memUsed: parseFloat((usedMem / (1024 ** 3)).toFixed(1)),
      memTotal: parseFloat((totalMem / (1024 ** 3)).toFixed(1)),
      gpuPercent: this.gpuCache.gpuPercent,
      // 260721 Red nvidia-smi 返回 MiB，转 GB 匹配 fmtMem 的单位假设
      vramUsed: this.gpuCache.vramUsed !== null ? parseFloat((this.gpuCache.vramUsed / 1024).toFixed(1)) : null,
      vramTotal: this.gpuCache.vramTotal !== null ? parseFloat((this.gpuCache.vramTotal / 1024).toFixed(1)) : null,
      gpuTemp: this.gpuCache.gpuTemp,
      netRx,
      netTx,
      fps: this.fpsStats.fps,
      fpsApp: this.fpsStats.app
    }
  }
}
