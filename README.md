# Qiu — 桌面悬浮球

> _A floating desktop monitor for CPU, memory, GPU, and network._

[![Version](https://badgen.net/badge/版本/0.0.4/blue)](CHANGELOG.md)

**Qiu** 是一个悬浮在桌面的系统监控小工具。不用切窗口、不用开任务管理器 —— 瞄一眼就知道电脑状态。

---

## ✨ 特色

- **CPU** — 实时占用百分比 + 进度条
- **内存** — 已用 / 总量 + 进度条
- **GPU** — NVIDIA 显卡占用（无独显自动隐藏）
- **显存** — VRAM 已用 / 总量
- **网速** — 下行 ▼ / 上行 ▲，自动 K/M 单位换算
- 毛玻璃半透明外观，融合桌面
- 鼠标拖拽移动、右键菜单关闭

---

## 🚀 开始使用

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建生产版本
npm run build
npm start
```

---

## ⌨️ 操作

| 操作 | 效果 |
|------|------|
| 左键拖拽 | 移动悬浮球 |
| 右键 | 弹出关闭菜单 |

---

## 📋 构建

双击 `build.bat` 打包为 Windows 安装包。

---

_构建者：小宋_
