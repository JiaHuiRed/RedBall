import { BrowserWindow } from 'electron'
import { release } from 'os'

// ── 分平台亚克力（毛玻璃） ──
// Win11 22H2+：Electron 原生 backgroundMaterial('acrylic')
// Win10：DWM SetWindowCompositionAttribute(WCA_ACCENT_POLICY=19) + ACCENT_ENABLE_ACRYLICBLURBEHIND=4，
//        经 koffi（N-API FFI）调用；加载失败回退纯半透明，不影响主流程

// Win11 build 号 >= 22000
export function isWin11(): boolean {
  const build = Number(release().split('.')[2])
  return build >= 22000
}

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
  } catch {
    applyDwmAcrylic = null
  }
}

export function applyAcrylic(win: BrowserWindow): void {
  if (isWin11()) {
    win.setBackgroundMaterial('acrylic')
    return
  }
  if (!applyDwmAcrylic) initKoffi()
  try {
    applyDwmAcrylic?.(win.getNativeWindowHandle())
  } catch {
    // FFI 失败保持纯半透明兜底
  }
}
