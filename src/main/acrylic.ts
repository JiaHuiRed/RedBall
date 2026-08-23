import { BrowserWindow } from 'electron'

// ── 亚克力（毛玻璃）统一走 DWM FFI ──
// 260823 Red 放弃 Win11 原生 backgroundMaterial('acrylic')：Electron 无法自定义 tint，
// 颜色随系统主题走（浅色模式=浅灰白），面板实测灰蒙蒙；koffi FFI 可自定义深色 tint，Win10 已实测通过
// DWM SetWindowCompositionAttribute(WCA_ACCENT_POLICY=19) + ACCENT_ENABLE_ACRYLICBLURBEHIND=4，
// 经 koffi（N-API FFI）调用；加载失败回退纯半透明，不影响主流程

const WCA_ACCENT_POLICY = 19
const ACCENT_ENABLE_ACRYLICBLURBEHIND = 4
// 深蓝 tint（ABGR：A=0xE0 高不透明，B=0x22 G=0x14 R=0x0E），与面板渐变同色系
const GRADIENT_COLOR = 0xe022140e

let applyDwmAcrylic: ((hwnd: Buffer) => boolean) | null = null

function initKoffi(): void {
  try {
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const AccentPolicy = koffi.struct('AccentPolicy', {
      AccentState: 'uint32',
      AccentFlags: 'uint32',
      GradientColor: 'uint32',
      AnimationId: 'uint32'
    })
    const WcaData = koffi.struct('WcaData', {
      dwAttribute: 'uint32',
      pvData: 'pointer',
      cbData: 'size_t'
    })
    const setWca = user32.func('SetWindowCompositionAttribute', 'bool', ['pointer', 'pointer'])
    applyDwmAcrylic = (hwnd: Buffer): boolean => {
      const policy = {
        AccentState: ACCENT_ENABLE_ACRYLICBLURBEHIND,
        AccentFlags: 0,
        GradientColor: GRADIENT_COLOR,
        AnimationId: 0
      }
      const data = {
        dwAttribute: WCA_ACCENT_POLICY,
        pvData: koffi.address(policy),
        cbData: koffi.sizeof(AccentPolicy)
      }
      return setWca(hwnd, koffi.address(data))
    }
  } catch (e) {
    // 260823 Red koffi 初始化失败时输出原因（此前静默吞掉，回退纯半透明无从排查）
    console.error('[acrylic] initKoffi failed:', e)
    applyDwmAcrylic = null
  }
}

export function applyAcrylic(win: BrowserWindow): void {
  if (!applyDwmAcrylic) initKoffi()
  try {
    const ok = applyDwmAcrylic?.(win.getNativeWindowHandle())
    // 260823 Red 输出 FFI 结果（成功/失败/false），成功与否不再靠猜
    console.log('[acrylic] applyAcrylic ok =', ok)
  } catch (e) {
    // FFI 失败保持纯半透明兜底
    console.error('[acrylic] applyAcrylic failed:', e)
  }
}
