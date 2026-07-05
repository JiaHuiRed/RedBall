import { execSync, spawn, ChildProcess } from 'child_process'
import * as os from 'os'

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
  netRx: number
  netTx: number
}

export class Monitor {
  private prevNet: NetSample | null = null
  private gpuAvailable = true
  private timer: ReturnType<typeof setInterval> | null = null
  private cpuUtil = 0
  private cpuProcess: ChildProcess | null = null

  start(callback: (stats: SystemStats) => void) {
    this.startCpuMonitor()
    this.prevNet = this.getNetSample()
    this.timer = setInterval(() => callback(this.getStats()), 1000)
  }

  stop() {
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
      return { gpuPercent: null, vramUsed: null, vramTotal: null }
    }
    try {
      const out = execSync(
        'nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits',
        { encoding: 'utf8', timeout: 3000 }
      )
      const parts = out.trim().split(', ')
      return {
        gpuPercent: parts[0] ? parseFloat(parts[0]) : null,
        vramUsed: parts[1] ? parseFloat(parts[1]) : null,
        vramTotal: parts[2] ? parseFloat(parts[2]) : null
      }
    } catch {
      this.gpuAvailable = false
      return { gpuPercent: null, vramUsed: null, vramTotal: null }
    }
  }

  private getStats(): SystemStats {
    // CPU (from typeperf background process)
    const cpuPercent = this.cpuUtil

    // Memory
    const totalMem = os.totalmem()
    const usedMem = totalMem - os.freemem()
    const memPercent = Math.round(100 * usedMem / totalMem)

    // GPU
    const gpu = this.getGpuInfo()

    // Network
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

    return {
      cpu: cpuPercent,
      memPercent,
      memUsed: parseFloat((usedMem / (1024 ** 3)).toFixed(1)),
      memTotal: parseFloat((totalMem / (1024 ** 3)).toFixed(1)),
      gpuPercent: gpu.gpuPercent,
      vramUsed: gpu.vramUsed,
      vramTotal: gpu.vramTotal,
      netRx,
      netTx
    }
  }
}
