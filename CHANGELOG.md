# RedBall 更新日志

## 0.0.16（2026-08-13）

### 🐛 修复

- **置顶失效：窗口偷偷跑到其他窗口后面** — 置顶自愈守护用 `isAlwaysOnTop()` 判断是否需要重设，但 Electron 该 API 返回内部缓存标志而非实时窗口状态，窗口被系统踢出 topmost 带（UAC/全屏切换等）后缓存仍是 true，守护永不触发。改为 `userTopmost` 意图标志记录用户开关，只要未手动关闭置顶，每 10 秒无条件重设 `setAlwaysOnTop(true)` 拉回最前。改于 `index.ts`。
- **右键菜单从未弹出（置顶/开机自启/关闭是死代码）** — 面板整块设为 `-webkit-app-region: drag`，drag 区域吞掉所有鼠标事件，右键弹的是 Windows 系统菜单，自定义菜单从加入起就无法显示。移除 drag 区域，窗口拖动改 renderer 自实现（增量 `move-window` IPC）；托盘菜单补"置顶"开关（checkbox 带勾选），窗口菜单"置顶"项同步勾选状态。改于 `index.ts`、`preload/index.ts`、`app.ts`、`styles.css`。

---

## 0.0.15（2026-08-08）

### ✨ 新增

- **亚克力毛玻璃背景** — 面板底色由暗淡的半透明渐变改为真亚克力毛玻璃：Win11 走 Electron 原生 `setBackgroundMaterial('acrylic')`，Win10 走 FFI（koffi）调 DWM `SetWindowCompositionAttribute` 启用 `ACCENT_ENABLE_ACRYLICBLURBEHIND`。两平台均兼容。新增 `acrylic.ts`，接入于 `index.ts`。

### 🎨 界面

- **背景透明度下调** — 面板背景 alpha 由 0.48/0.52 降至 0.28/0.32，让 DWM 亚克力模糊透出，观感更通透。改于 `styles.css`。

### 🛠 其他

- **koffi 依赖接入** — 新增 `koffi`（N-API FFI，无需编译）支撑 Win10 亚克力调用；主进程构建配置加 `externalizeDepsPlugin()`，打包配置加 `asarUnpack` 使 koffi 原生二进制免打包进 asar。改于 `electron.vite.config.ts`、`package.json`。

---

## 0.0.14（2026-08-07）

### ✨ 新增

- **单实例锁** — `app.requestSingleInstanceLock()`，自启与手动启动同时发生时只保留一个实例，避免双份采集进程互抢窗口位置。改于 `index.ts`。

### 🐛 修复

- **网速显示膨胀 3 倍且闪烁** — 采样改为每 3 秒后，`rxDelta/txDelta` 是 3 秒累计值，未除以采样间隔就当 1 秒速率显示（数值膨胀 3 倍）；且非采样 tick 差值恒为 0（显示跳 0）。改为除以 `NET_SAMPLE_INTERVAL` 换算每秒速率，并缓存最近速率供间隔内 tick 复用。修于 `monitor.ts`。
- **CPU 读数与任务管理器不对齐** — 计数器由 `% Processor Utility` 换为 `% Processor Time`，消除读数可能超 100% 且与任务管理器不一致的问题。修于 `monitor.ts`。

### 🎨 界面

- **网速单位补全** — 显示从 `12.5M` 改为 `12.5MB/s`，避免误读成 Mb。改于 `app.ts`。

### 🛠 其他

- **窗口位置保存防抖** — 拖动过程每像素写盘改为 300ms 防抖，减少无效磁盘 IO。改于 `index.ts`。

---

## 0.0.13（2026-08-02）

### ✨ 新增

- **任务栏隐藏** — 窗口不出现在任务栏，通过托盘图标显示/隐藏，保持桌面悬浮纯净。改于 `index.ts`。
 - **网速采样缓存** — `netstat -e` 是阻塞调用，改为每 3 秒采样一次并缓存，减少主线程阻塞。改于 `monitor.ts`。

### 🎨 界面

- **去掉透明窗口** — `transparent: false`，避免 Windows DWM 低性能透明合成路径。改于 `index.ts`。
- **渲染层类型加固** — 新增 `WindowWithElectron` 类型，明确 electronAPI 桥接。改于 `app.ts`。

### 🛠 其他

- **AppUserModelId 时机修正** — 必须在创建窗口之前设置，否则 Windows 任务栏图标显示 Electron 默认图标。改于 `index.ts`。

---

## 0.0.12（2026-07-26）

### 🔥 移除

- **FPS 监控功能** — 由于 PresentMon 需要管理员权限启动 ETW Trace Session，UAC 提权流程在全屏游戏场景下无法稳定工作（弹窗不可见/被忽略），导致 FPS 始终不可用。移除所有 FPS 相关代码（监听、CSV 解析、UI 显示）及 PresentMon 依赖。精简 `monitor.ts`、`index.html`、`app.ts`。

---

## 0.0.11（2026-07-26）

### 🐛 修复

- **FPS 始终显示 `--`** — 根本原因：PresentMon 需管理员权限创建 ETW Trace Session，原有 bat+UAC 提权方式依赖用户手动点"确定"，游戏全屏时 UAC 弹窗被遮挡或忽略，PresentMon 未启动。重构为三层启动策略：(1) 直接 spawn PresentMon（无需管理员时可用）；(2) 创建 Windows 计划任务 `RedBallPresentMon`（一次 UAC，以后开机静默以 SYSTEM 权限启动）；(3) 回退 bat+UAC 立即启动。`monitor.ts`。
- **CSV 列索引硬编码导致错位** — `readFpsCsv()` 写死 `vals[10]` 作为 `MsBetweenPresents`，但 PresentMon 2.3.1 默认 v2 metrics 格式该列不在索引 10；改为动态从表头查找 `MsBetweenPresents` 列位置。`monitor.ts`。

### ✨ 新增

- **PresentMon 计划任务管理** — `checkTaskExists()` 检测任务状态、`createScheduledTask()` 自动注册开机启动任务，实现静默后台运行。`monitor.ts`。
- **直接 spawn PresentMon 模式** — 若当前用户无需管理员即可捕获 ETW，直接启动子进程并将 stdout pipe 到 CSV，避免 UAC 弹窗。`monitor.ts`。

---

## 0.0.10（2026-07-22）

### ✨ 新增

- **FPS 实时监控** — 集成 PresentMon 2.3.1，通过 ETW 捕获 GPU 帧 Present 事件，实时计算各进程 FPS 并取最高值显示。`monitor.ts`。
- **PresentMon 提权启动器** — 生成 `.bat` 脚本经 cmd 提权启动，一次 UAC 完成清理旧进程 + 启动新实例。`--stop_existing_session` 处理 ETW session 残留。`monitor.ts`。

### 🐛 修复

- **PresentMon --output_file 独占锁导致 FPS 不可读** — PresentMon 以独占写锁打开 CSV，Node.js/任何进程无法读取；改用 `--output_stdout` + cmd `>` 重定向（共享读模式），实现实时 CSV 增量解析。`monitor.ts`。

---

## 0.0.9（2026-07-21）

### 🐛 修复

- **图标默认 Electron 万花筒/透明** — 之前用 `createFromPath()`/`createFromBuffer()` 读文件，受 ASAR 路径、Windows 图标缓存和 PNG 解码差异影响不可靠；改为 raw RGBA 像素生成（`createDotIcon()`），主窗口 32×32 红点+白瞳孔、托盘 16×16，无文件 IO、无缓存依赖。重写于 `index.ts`。
- **VRAM 显示单位错误** — `nvidia-smi` 返回值为 MiB（如 16303 MiB ≈ 16 GB），前端当作 GB 显示导致数值错误；`getStats()` 中 `vramUsed/vramTotal` 除以 1024 转为 GB 单位。修于 `monitor.ts`。

### 🎨 界面

- **毛玻璃风格 + 紧凑布局** — 背景透明度降至 0.5、blur 28px、渐变底色 + 上沿高光、进度条渐变色微光晕、标签中文化（显存→VRAM、内存→MEM）带箭头▲▼、bar-track 加宽至 32px。改于 `styles.css`、`index.html`。

---

### 🐛 修复

- **睡眠唤醒后 GPU/显存显示 `--`** — `gpuAvailable` 一旦被 `nvidia-smi` 失败锁死就永不恢复；改为每 30 秒重置，sleep/wake 后自动重新检测。修于 `monitor.ts`。
- **托盘图标不可见** — `iconPath` 用 `__dirname` 相对路径，打包后指向 ASAR 内部导致图标为空；改为 `app.isPackaged` 判断，生产环境用 `process.resourcesPath`。修于 `index.ts`。

### ✨ 新增

- **窗口位置记忆** — 窗口坐标保存到 `userData/window-position.json`，下次启动自动恢复上次位置。改于 `index.ts`。

---

## 0.0.7（2026-07-11）

### 🐛 修复

- **GPU 温度显示 undefined°C** — `monitor.ts` 的 `getGpuInfo()` 和 `getStats()` 未返回 `gpuTemp` 字段，renderer 用 `!== null` 判断无法兜住 `undefined`；改为双等号 `!= null` 同时兜住 null 和 undefined，monitor 层补上 `gpuTemp` 查询与传递。修于 `monitor.ts`、`app.ts`。
- **启动变慢（卡 2 秒）** — `start()` 中 `getNetSample()`（`execSync('netstat -e')`）阻塞主线程；移走阻塞调用，GPU 改为每 3 tick 查一次并缓存。修于 `monitor.ts`。

### 🎨 界面

- **布局调整** — 网速从第一行移到第二行（GPU 温度与内存之间），窗口宽度从 560px 缩至 320px，进度条宽度从 34px 缩至 28px，间距紧凑化。改于 `index.html`、`styles.css`、`index.ts`。
- **新图标** — 生成全新深色红球瞳孔发光图标，替换旧青色圆点。`resources/icon.png`、`resources/icon-256.png`。

---

## 0.0.6（2026-07-08）

### ✨ 新增

- **系统托盘** — 右键菜单"关闭"改为最小化到托盘，双击托盘图标恢复窗口，托盘右键菜单提供"显示/退出"。改于 `index.ts`、`index.html`、`app.ts`。
- **开机自启动** — 右键菜单新增"开机自启"开关，勾选状态绿色对号标识，基于 `app.setLoginItemSettings` 实现。改于 `index.ts`、`preload/index.ts`、`app.ts`、`index.html`、`styles.css`。

---
## 0.0.5（2026-07-08）

### 🐛 修复

- **GPU 颜色条不变色** — `styles.css` 选择器为 `.gpu .bar-fill`，但 HTML 中 GPU 外层仅有 `metric` 无 `gpu` class，导致温度阈值样式永远不生效。给 GPU metric 补上 `gpu` class，温度 ≥55°C 变橙色、≥70°C 变红色。改于 `index.html`。

### 🎨 界面

- **移除 CPU 温度显示** — Windows 无可靠内置命令读取 CPU 核心温度，按需求直接移除第二行 CPU 温度栏，界面保留 GPU 温度 + 内存条。改于 `index.html`。

---
## 0.0.4（2026-07-05）

### 🐛 修复

- **CPU 读数始终 0%** — `typeperf` 管道输出分块到达 CSV 行时，`"\n"` 分割和 `lastIndexOf('","')` 无法匹配跨 chunk 数据；改用缓冲区 `indexOf('","')` 全局扫描 + `idx+3` 跳过字段开引号。修于 `monitor.ts`。
- **任务栏不显示** — `skipTaskbar: true` 导致窗口最小化后无处找回；改为 `false`，窗口出现在任务栏。修于 `index.ts`。

### 🎨 界面

- **macOS 风格顶部栏** — 用红/黄/绿三色装饰灯替换了旧青色 orb 图标，纯色圆点无功能符号。改于 `index.html`、`styles.css`。
- **程序图标** — 生成青色圆点 PNG 图标，添加到窗口和任务栏。`resources/icon.png`。

### 🛠 构建

- **打包清理** — `build.bat` 打包前删除 `dist` 目录，防止旧版本 exe 残留。改于 `build.bat`。

---
## 0.0.3（2026-07-04）

### 🐛 修复

- **CSS 不加载** — CSP 中 `style-src` 缺少 `'self'`，阻止了 `<link rel="stylesheet">` 加载外部样式表，导致布局完全塌陷。在 `index.html` 中添加 `'self'` 后恢复。

---
## 0.0.2（2026-07-04）

### 🐛 修复

- **CSS 不加载** — CSP 中 `style-src` 缺少 `'self'`，阻止了 `<link rel="stylesheet">` 加载外部样式表，导致布局完全塌陷。在 `index.html` 中添加 `'self'` 后恢复。

### 🛠 构建

- **便携版打包** — 从安装包改为 portable 单文件 exe，双击 build.bat 一步完成安装依赖→构建→打包。
- **build.bat 更新** — 添加 `ELECTRON_MIRROR` 国内镜像加速，`npm install && electron-vite build && electron-builder`

### 🎨 界面

- **气泡风格重设计** — 圆角 30px 毛玻璃容器、青色发光小球头部、彩色圆点指示器、8px 加厚渐变进度条、cubic-bezier 过渡动画。

---
## 0.0.1（2026-07-04）

### ✨ 新功能

- **CPU 监控** — 实时百分比 + 彩色进度条
- **内存监控** — 已用 / 总量显示
- **GPU 监控** — NVIDIA 显卡占用与显存（无独显自动隐藏）
- **网速监控** — 下行 / 上行，每秒刷新
- **桌面悬浮** — 毛玻璃半透明、置顶、无边框窗口
- **拖拽移动** — 左键拖拽任意位置
- **右键菜单** — 关闭退出

### 🛠 构建

- **electron-builder 打包** — 双击 build.bat 生成便携 exe

### 🎨 界面

- **气泡风格** — 大圆角 28px、毛玻璃暗色底、更紧凑布局
- **视觉优化** — 背景更实、加阴影和光泽线，开屏一眼可见
