# 工作助手

> 一个像原生 APP 一样运行的个人工作助手 PWA，支持添加到 iPhone 主屏幕。

## ✨ 功能

| 模块 | 说明 |
|------|------|
| ✅ 待办事项 | 优先级管理、截止日期、完成状态 |
| 📅 日程安排 | 按日查看、时间排序、备注 |
| 📝 笔记 | 卡片式布局、全文搜索 |
| 🍅 番茄钟 | 专注/短休息/长休息、统计记录 |
| ⚙️ 数据管理 | 导出/导入 JSON、离线使用 |

## 🚀 使用方式

1. 用 Safari 打开部署地址
2. 点击底部分享按钮 → **添加到主屏幕**
3. 像原生 APP 一样使用！

## 📦 技术栈

- 纯前端：HTML + CSS + JavaScript
- PWA：Service Worker + Manifest
- 数据存储：localStorage（完全本地，无需账号）

## 🛠️ 本地开发

```bash
cd work-assistant
# 直接打开 index.html 或用任意本地服务器
python3 -m http.server 8080
```

## 📄 License

MIT
