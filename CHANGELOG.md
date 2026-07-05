# Qiu 更新日志

## 0.0.3（2026-07-04）

### 🐛 修复

- **CPU 读数始终 0%** — `typeperf` 管道输出分块到达 CSV 行时，`"\n"` 分割和 `lastIndexOf('","')` 无法匹配跨 chunk 数据；改用缓冲区 `indexOf('","')` 全局扫描 + `idx+3` 跳过字段开引号。修于 `monitor.ts`。
- **任务栏不显示** — `skipTaskbar: true` 导致窗口最小化后无处找回；改为 `false`，窗口出现在任务栏。修于 `index.ts`。

### 🎨 界面

- **macOS 风格顶部栏** — 用红/黄/绿三色装饰灯替换了旧青色 orb 图标，保持纯色圆点无功能符号，QIU 标题保留。改于 `index.html`、`styles.css`。
- **程序图标** — 生成青色圆点 PNG 图标，添加到窗口和任务栏。`scripts/gen-icon.js`、`resources/icon.png`。

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
