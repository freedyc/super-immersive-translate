# Immersive Translate Plugin

沉浸式双语网页翻译 Chrome 插件，参考沉浸式翻译设计。

## 功能

- 🌐 网页双语对照翻译（原文 + 译文并排显示）
- 🔄 多翻译引擎支持（Google 翻译、DeepL、自定义 API）
- ⌨️ 快捷键 `Alt+T` 一键翻译
- 🎯 智能段落识别，跳过代码块、图片等
- 🌙 自动适配暗色模式
- 📱 SPA 动态内容支持（MutationObserver）
- 🖱️ 右键菜单翻译

## 安装

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目文件夹

> 注意：图标需要手动生成 PNG。可以用 `icons/icon.svg` 通过任意工具导出 16x16、48x48、128x128 的 PNG，分别命名为 `icon16.png`、`icon48.png`、`icon128.png` 放在 `icons/` 目录下。

## 使用

- 点击浏览器工具栏图标，打开设置面板
- 开关切换翻译
- 选择翻译引擎和目标语言
- 使用 `Alt+T` 快捷键快速切换

## 项目结构

```
├── manifest.json          # 扩展配置 (Manifest V3)
├── popup/                 # 弹出面板
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── content/               # 内容脚本
│   ├── content.js         # 核心翻译逻辑
│   └── content.css        # 双语样式
├── background/
│   └── background.js      # 后台服务 (快捷键/右键菜单)
├── utils/
│   └── translator.js      # 翻译引擎封装
└── icons/
    └── icon.svg           # 图标源文件
```

## 翻译引擎

| 引擎 | 说明 | 需要 Key |
|------|------|---------|
| Google 翻译 | 免费，无需配置 | ❌ |
| DeepL | 高质量翻译 | ✅ |
| 自定义 API | 接入任意翻译服务 | 可选 |
