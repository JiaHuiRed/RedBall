import { execSync, spawn, ChildProcess } from 'child_process'
import * as os from 'os'

interface NetSample {
  rx: number
  tx: number
}

// 260823 Red 单进程 CPU 占用：面板无负载但风扇转的场景（僵尸进程偷吃 CPU）
export interface ProcInfo {
  name: string
  percent: number
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
  topProcs: ProcInfo[]
}

export class Monitor {
  private prevNet: NetSample | null = null
  private gpuAvailable = true
  private timer: ReturnType<typeof setInterval> | null = null
  private cpuUtil = 0
  private cpuProcess: ChildProcess | null = null
  private gpuCache: { gpuPercent: number | null; vramUsed: number | null; vramTotal: number | null; gpuTemp: number | null } = { gpuPercent: null, vramUsed: null, vramTotal: null, gpuTemp: null }
  private tickCount = 0
  // 260823 Red 进程 CPU 扫描：常驻 PowerShell 每 3 秒输出全部进程的累计 CPU 秒，
  // 两帧相减 ÷ 采样间隔 ÷ 核数得到任务管理器口径的单进程百分比
  private procPs: ChildProcess | null = null
  private procSample: { data: Map<number, ProcInfo & { cpu: number }>; t: number } | null = null
  private prevProcSample: { data: Map<number, ProcInfo & { cpu: number }>; t: number } | null = null
  private procComputedAt = 0
  private topProcs: ProcInfo[] = []
  // 260719 Red 唤醒恢复：每 30 秒重置 gpuAvailable，避免 sleep/wake 后永久锁死
  private static readonly GPU_RETRY_INTERVAL = 30
 // 260802 Red 网速采样缓存：netstat -e 是阻塞调用，每 3 秒采样一次即可
 private netCache: NetSample = { rx: 0, tx: 0 }
 private static readonly NET_SAMPLE_INTERVAL = 3
 // 260807 Red 网速速率缓存：采样间隔内的 tick 复用最近一次速率，避免显示 0
 private netRate: { rx: number; tx: number } = { rx: 0, tx: 0 }
  start(callback: (stats: SystemStats) => void) {
    this.startCpuMonitor()
    this.startProcMonitor()
    this.timer = setInterval(() => callback(this.getStats()), 1000)
  }

  stop() {
    if (this.cpuProcess) {
      this.cpuProcess.kill()
      this.cpuProcess = null
    }
    if (this.procPs) {
      this.procPs.kill()
      this.procPs = null
    }
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private startCpuMonitor() {
    // 260807 Red 改用 % Processor Time：此前 % Processor Utility 可能超 100% 且与任务管理器读数不对齐
    try {
      const proc = spawn('typeperf', [
        '\\Processor Information(_Total)\\% Processor Time',
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

  // 260823 Red 进程 CPU 常驻采集：PowerShell 循环每 3 秒输出一行 `PID~名称~累计CPU秒|...`。
  // 用 [Console]::Out.WriteLine 直写，绕开 PowerShell 格式化管道 80 列换行的坑；
  // 输出在子进程内完成，主进程只做管道异步解析，不阻塞 getStats 主循环
  private startProcMonitor() {
    const psScript =
      'while($true){$s=@(Get-Process|Where-Object{$null -ne $_.CPU}|' +
      'ForEach-Object{"$($_.Id)~$($_.ProcessName)~$([Math]::Round($_.CPU,2))"});' +
      '[Console]::Out.WriteLine($s -join "|");Start-Sleep -Milliseconds 3000}'
    try {
      const proc = spawn('powershell.exe', ['-NoProfile', '-Command', psScript], {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true
      })

      let buffer = ''
      proc.stdout!.on('data', (data: Buffer) => {
        buffer += data.toString()
        let nl = buffer.indexOf('\n')
        while (nl >= 0) {
          const line = buffer.substring(0, nl).trim()
          if (line) this.parseProcLine(line)
          buffer = buffer.substring(nl + 1)
          nl = buffer.indexOf('\n')
        }
        if (buffer.length > 8192) buffer = ''
      })

      proc.on('error', () => { /* powershell not available */ })
      proc.on('exit', () => { this.procPs = null })
      this.procPs = proc
    } catch { /* powershell not available */ }
  }

  private parseProcLine(line: string) {
    const data = new Map<number, ProcInfo & { cpu: number }>()
    for (const item of line.split('|')) {
      const [pidStr, name, cpuStr] = item.split('~')
      const pid = parseInt(pidStr, 10)
      const cpu = parseFloat(cpuStr)
      if (pid > 0 && name && !isNaN(cpu)) {
        data.set(pid, { name, percent: 0, cpu })
      }
    }
    if (data.size > 0) this.procSample = { data, t: Date.now() }
  }

  // 260823 Red 两帧差值算单进程百分比：delta秒 / delta时间 / 核数 * 100，与任务管理器口径一致；
  // 进程退出或 CPU 秒回退（系统重置）时计入负数/忽略
  private computeTopProcs() {
    const cur = this.procSample
    if (!cur || cur.t === this.procComputedAt) return
    this.procComputedAt = cur.t
    if (this.prevProcSample) {
      const dt = (cur.t - this.prevProcSample.t) / 1000
      if (dt > 0 && dt < 20) {
        const cores = Math.max(1, os.cpus().length)
        const list: ProcInfo[] = []
        for (const [pid, c] of cur.data) {
          const p = this.prevProcSample.data.get(pid)
          if (!p) continue
          const dcpu = c.cpu - p.cpu
          if (dcpu <= 0) continue
          list.push({ name: c.name, percent: Math.round((dcpu / dt / cores) * 100) })
        }
        list.sort((a, b) => b.percent - a.percent)
        this.topProcs = list.slice(0, 3)
      }
    }
    this.prevProcSample = cur
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

  private getStats(): SystemStats {
    this.tickCount++

    // 260719 Red 每 30 秒重置 gpuAvailable，sleep/wake 后能自动恢复
    if (this.tickCount % Monitor.GPU_RETRY_INTERVAL === 0) this.gpuAvailable = true

    // GPU: cache for 3 ticks to reduce blocking execSync
    if (this.tickCount % 3 === 1) this.gpuCache = this.getGpuInfo()

   // Network (cached every 3 ticks to avoid blocking execSync on every tick)
   let netSample = this.netCache
   if (this.tickCount % Monitor.NET_SAMPLE_INTERVAL === 0) {
     netSample = this.getNetSample()
     this.netCache = netSample
     if (this.prevNet) {
       const rxDelta = netSample.rx - this.prevNet.rx
       const txDelta = netSample.tx - this.prevNet.tx
       // 260807 Red 除以采样间隔换算成每秒速率（此前 3 秒累计值直接当 1 秒显示，膨胀 3 倍）
       this.netRate.rx = rxDelta > 0 ? Math.round(rxDelta / 1024 / Monitor.NET_SAMPLE_INTERVAL) : 0
       this.netRate.tx = txDelta > 0 ? Math.round(txDelta / 1024 / Monitor.NET_SAMPLE_INTERVAL) : 0
     }
     this.prevNet = netSample
   }
   const netRx = this.netRate.rx
   const netTx = this.netRate.tx

    // CPU (from typeperf background process — already async)
    const cpuPercent = this.cpuUtil

    // 260823 Red 进程 CPU：仅在新样本到达时算一次，3 秒内各 tick 复用
    this.computeTopProcs()

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
      topProcs: this.topProcs
    }
  }
}
