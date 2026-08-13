# RedBall 项目记忆

## 置顶自愈（260812）

- **现象**：哥哥反馈 RedBall 时不时自己跑到其他窗口后面，不是新开窗口遮挡
- **根因**：Windows 置顶是"topmost 带"语义——所有置顶窗口共享一条带，后置顶的排前面；输入法候选窗/微信悬浮小窗/其他置顶工具/UAC 等任何置顶元素出现都会把 RedBall 挤下去，且**不会自动回来**
- **修复（已被 260813 版取代，见下）**：`src/main/index.ts` 加了 `startTopmostGuard()`（每 10 秒检测可见且 `isAlwaysOnTop()` 时重设 `setAlwaysOnTop(true)` 拉回最前，手动取消置顶时跳过）；`showWindow()` 补一次置顶（修 Windows 上 hide→show 丢置顶的 Electron 已知问题）；`before-quit` 清理定时器
- **副作用**：另一个置顶窗口若想盖住 RedBall（几乎不会发生），10 秒内会被拉回

## 置顶失效二次修复（260813）

- **现象**：8/12 的守护没生效，窗口还是偷偷跑到后面（哥哥反馈"还是会偷偷跑到后面去"）
- **根因**：守护跳过条件用 `isAlwaysOnTop()` 判断——Electron 该 API 返回**内部缓存标志**（非实时查 WS_EX_TOPMOST），系统把窗口踢出 topmost 带（UAC/全屏切换等）后缓存仍是 true，守护永远不触发，窗口永久躺后面
- **修复**：新增 `userTopmost` 意图标志（toggle-always-on-top 时翻转，创建窗口默认 true），守护只要 `userTopmost` 为 true 就**无条件**每 10 秒重设 `setAlwaysOnTop(true)`；`showWindow()` 补置顶同样用该标志。**教训：判断置顶状态别信 `isAlwaysOnTop()` 返回值**
- **状态**：8/13 已重新打包（dist\win-unpacked），待哥哥验证

## 打包（260808 实战教训）

- **打包命令**：`npm run dist`（= electron-vite build && electron-builder），target 已改为 `["dir"]`，只产出 `dist\win-unpacked\`，不打 portable/nsis（哥哥只用 unpacked 版）
- **必须设代理**：electron-builder 下载 electron 二进制走 Node，不认系统代理，GitHub 被墙会 ETIMEDOUT 卡死。跑之前先 `set HTTPS_PROXY=http://127.0.0.1:7897`（哥哥的 Clash 端口）
- **@electron/get 缓存目录**：`%LOCALAPPDATA%\electron\Cache\<url-sha256>\`（不是 `electron-builder\Cache\electron\`），zip 放错目录等于没缓存
- **孤儿锁**：杀掉卡死的 electron-builder 进程后，`%TEMP%\eb-dl-*.lock.lock` 会残留，新进程要等 10 分钟 stale 才接管。杀进程后记得删锁
- **杀软**：portable 打包时 7za 压缩会被杀软实时删 dll（elevate.exe/vk_swiftshader.dll/vulkan-1.dll），改 dir target 后不涉及 7za 压缩，已绕开
- 解压是流式的：electron zip 先解到 `dist\win-unpacked.tmp` 再 rename，中途看文件数要看 tmp 目录
- electron 本地版本 42.8.0，electron-builder 26.15.3

## 当前进度（260808 晚）

- **v0.0.15 已推送**（3f278b0，commit 前缀 `[YuQi]`）：亚克力毛玻璃改造完成，Win10 实测通过，Win11 待哥哥验证
- GitHub Desktop stash 仍在：`stash@{0}: On master: !!GitHub_Desktop<master>`（哥哥本地未提交修改 599f99d + 3a4fab2），未动


## 亚克力/毛玻璃改造（260808 完成）

- **目标**：面板底色从暗淡渐变改为亚克力毛玻璃，兼容 Win10 + Win11 两台机器
- **实现**：`src/main/acrylic.ts`（新建）——Win11（build>=22000）走 `win.setBackgroundMaterial('acrylic')`；Win10 走 koffi FFI 调 user32.dll `SetWindowCompositionAttribute`（WCA_ACCENT_POLICY=19，ACCENT_ENABLE_ACRYLICBLURBEHIND=4，GradientColor=0xe022140e ABGR）
- **关键配置**：BrowserWindow `transparent: !isWin11()` + `backgroundMaterial: isWin11() ? 'acrylic' : 'none'`；`electron.vite.config.ts` main 加 `externalizeDepsPlugin()`（koffi 必须 external）；package.json `asarUnpack: ["**/node_modules/koffi/**","**/node_modules/@koromix/**"]`；styles.css 背景 alpha 降到 0.28/0.32、border 0.10
- **koffi 3.1.4**：N-API prebuilt 无需编译，装 dependencies，无 TS 类型（代码里动态 require + any）
- **效果已验证**：哥哥本机 Win10 实测通过（"效果比之前好不少"）
- **大坑：npm install --registry=npmmirror 会把 electron 从 42.8.0 降级到 42.6.0**（重解析 lockfile），electron-builder 要 42.6.0 zip 而缓存只有 42.8.0 → 下载卡死（症状：日志停在 `downloaded electron progress=100%`，win-unpacked 只有 20 个 electron 框架文件无 RedBall.exe）。**装完依赖必须 `node -e "console.log(require('node_modules/electron/package.json').version)"` 核对 42.8.0**，被降级就 `npm install electron@42.8.0 --save-dev --registry=npmmirror` 装回 + 手动 `node node_modules/electron/install.js`（postinstall 会被 allowScripts 挡）
- 打包卡死排查流程：杀进程树（taskkill /F /T）→ 删 `%TEMP%\eb-dl-*.lock*` → 核对 electron 版本与缓存 zip 匹配 → 重跑

## 右键菜单死代码（260813 哥哥发现）

- **现象**：哥哥反馈托盘右键只有"显示/退出"，窗口右键只有系统菜单（最大化/最小化/关闭），从未见过"置顶"按钮
- **根因**：`#app` 整个面板是 `-webkit-app-region: drag`，**drag 区域会吞掉所有鼠标事件（含右键 contextmenu）**，renderer 的自定义菜单（置顶/开机自启/关闭）从加进那天起就是死代码，永远弹不出来；Windows 对 drag 区域右键弹的是系统窗口菜单
- **修复**：① CSS 移除 `-webkit-app-region: drag`，窗口拖动改 renderer 自实现（mousedown/mousemove 增量调 `move-window` IPC，`move-window` 早已预留）；② 托盘菜单加"置顶"checkbox 项（`toggleTopmost()` 统一翻转 `userTopmost` + 重建托盘菜单刷新勾选）；③ renderer 菜单"置顶"项加勾选状态（新增 `get-always-on-top` sync IPC）
- **教训**：Electron 无边框窗口要用自定义右键菜单，**绝不能把整个面板设成 drag 区域**；拖动需求优先 renderer 自实现
- **状态**：8/13 已重新打包，待哥哥验证右键菜单 + 拖动 + 置顶三件事