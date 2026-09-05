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

// ── 真实 topmost 位检查与强制插回 ──
// 260905 Red 游戏全屏占前台时，Windows 会剥掉所有其他窗口的 WS_EX_TOPMOST 并拒绝
// 重新加回；游戏退出台前才可能恢复。Electron 的 setAlwaysOnTop() 拿内部缓存做比对，
// 被踢出带后缓存仍是 true → 调用被短路，守护重设无效（实测 15s 位纹丝不动）。
// 守护必须用 FFI 查真实 Win32 位，缺位才补——这样也避免每 10s 无谓的 z 序重插。
const GWL_EXSTYLE = -20
const WS_EX_TOPMOST = 0x0008
const HWND_TOPMOST = -1n
// NOMOVE(0x2) | NOSIZE(0x1) | NOACTIVATE(0x10)：不改位置尺寸、不抢焦点
const SWP_FLAGS = 0x0013

let ffiGetExStyle: ((hwnd: bigint) => number) | null = null
let ffiSetTopmost: ((hwnd: bigint) => boolean) | null = null

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
      pvData: 'void *', // 260905 Red koffi 3.x 不认 'pointer' 类型名，必须写 'void *'（此前 initKoffi 整个抛错连坐 topmost FFI）
      cbData: 'size_t'
    })
    // 260905 Red 同上：函数参数表里的 'pointer' 全部改 'void *'
    const setWca = user32.func('SetWindowCompositionAttribute', 'bool', ['void *', 'void *'])
    // 260905 Red topmost 直查/强插的 FFI 绑定
    const getWindowLong = user32.func('GetWindowLongW', 'int32', ['intptr', 'int32'])
    const setWindowPos = user32.func('SetWindowPos', 'bool', ['intptr', 'intptr', 'int32', 'int32', 'int32', 'int32', 'uint32'])
    ffiGetExStyle = (hwnd) => getWindowLong(hwnd, GWL_EXSTYLE)
    ffiSetTopmost = (hwnd) => setWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_FLAGS)
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

// ── 确保窗口真实处于置顶带 ──
// 260905 Red 查真实 Win32 topmost 位，缺位才插回；FFI 不可用时退化为
// 关-开两次 setAlwaysOnTop，强制绕开 Electron 的缓存短路
export function ensureRealTopmost(win: BrowserWindow): void {
  try {
    const hwnd = win.getNativeWindowHandle().readBigInt64LE(0)
    if (ffiGetExStyle && ffiSetTopmost) {
      const style = ffiGetExStyle(hwnd)
      if ((style & WS_EX_TOPMOST) === 0) {
        // 260905 Red 调试日志：确认守护真实触发与 FFI 插回结果
        const ok = ffiSetTopmost(hwnd)
        console.log('[topmost] bit missing, re-add ok =', ok)
      }
      return
    }
  } catch (e) { /* FFI 不可用或失败，退化处理 */ console.error('[topmost] ffi failed, fallback:', e) }
  // 260905 Red FFI 不可用：关-开两次 setAlwaysOnTop，强制绕开 Electron 的缓存短路
  win.setAlwaysOnTop(false)
  win.setAlwaysOnTop(true)
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
