# 隐私政策 · Super Immersive Translate（超级翻译）

**最后更新：2026-08-24 · 适用版本：2.1.0**

这份政策描述本扩展**实际**会做什么。它是逐条对照源码写的，不是模板。
源码公开在 <https://github.com/freedyc/super-immersive-translate>，任何一条都可以自行核对。

---

## 一句话概括

本扩展**没有服务器**。开发者收不到你的任何数据。所有内容默认只存在你自己的浏览器里；
只有当你主动使用翻译、朗读、OCR 或跨设备同步时，相应文本才会发给你选定的第三方服务。

---

## 一、存在你本地的数据

以下内容保存在浏览器本地（`chrome.storage` 与 IndexedDB），不会自动上传到任何地方：

| 数据 | 内容 | 存储位置 |
|---|---|---|
| 翻译历史 | 划词翻译的原文、译文、来源页面网址与标题 | `chrome.storage.local` |
| 单词本 | 收藏的单词、释义、例句、音标、学习进度 | `chrome.storage.local` |
| 剪贴板历史 | 你在网页上复制的文字、来源页面网址与标题 | `chrome.storage.local` |
| 剪贴板图片 | 你主动保存的图片及其缩略图 | IndexedDB |
| 设置 | 引擎选择、目标语言、样式、API Key 等 | `chrome.storage.sync` |
| 加密口令 | 剪贴板同步的加密口令 | `chrome.storage.local`（**刻意不进 sync**） |

**关于剪贴板捕获**：默认开启，可在设置中关闭。以下内容**不会**被记录：

- 密码框（`type="password"`）内的内容
- 一次性验证码输入框（`autocomplete="one-time-code"`）
- 字段名/ID 中含 password、otp、cvv、secret、token、api-key 等字样的输入
- 由页面脚本合成（非你本人操作）的复制事件

**关于 `chrome.storage.sync`**：这是 Chrome 自带的账号同步机制，其中的设置会经由
Google 账号在你自己的设备间同步。**API Key 保存在其中**，因此它们会经过 Google 的服务器。
剪贴板同步的加密口令刻意**不放在这里**——否则等于把密文交给 GitHub、把钥匙交给 Google。

---

## 二、会发送到第三方的数据

只在你使用对应功能时发生。发给谁取决于**你自己在设置里的选择**。

### 翻译

被翻译的文本会发送给你选定的引擎：

| 引擎 | 目的地 | 是否需要你的 Key |
|---|---|---|
| Google 翻译 | `translate.googleapis.com` | 否 |
| MyMemory | `api.mymemory.translated.net` | 否 |
| Lingva | `lingva.ml` | 否 |
| LibreTranslate | `libretranslate.com` | 否 |
| DeepL | `api-free.deepl.com` | 是 |
| OpenAI | `api.openai.com` | 是 |
| Gemini | `generativelanguage.googleapis.com` | 是 |
| Claude | `api.anthropic.com` | 是 |
| DeepSeek | `api.deepseek.com` | 是 |
| 自定义 API | 你自己填写的地址 | 由你决定 |
| **Ollama** | 你本机的 `localhost:11434` | **不出本机** |
| **WebLLM** | 在你的浏览器内运行 | **不出本机**（首次会从 `huggingface.co` 下载模型权重） |

发送的只有待翻译文本本身，不含你的浏览记录、身份或其他页面内容。

### 朗读

朗读的文本会发送给你选定的朗读引擎：

- **浏览器内置语音**：不出本机
- **Google 翻译语音**：`translate.google.com`
- **有道词典发音**：`dict.youdao.com`
- **OpenAI TTS**：`api.openai.com`（需你的 Key）

### 图片 OCR（沙盒工作台的「图片」标签）

你上传的图片会发送到第三方服务 **`api.ocr.space`**，使用的是该服务的**公开演示 key**。
这意味着图片会离开你的设备。界面上对此有明确提示。不使用该功能则不会发生。

### GitHub 跨设备同步（默认关闭）

开启后，翻译历史与单词本会写入**你自己**的 GitHub Gist 或仓库，使用**你自己**提供的
Personal Access Token。数据只在你的浏览器与你的 GitHub 账号之间流动。

**剪贴板同步是端到端加密的**：内容在本机用 AES-256-GCM 加密后才上传，密钥由你设置的
口令经 PBKDF2（60 万次迭代）派生。GitHub 上只有密文。**没有设置口令时不会上传**——
本扩展不会退化成明文同步。口令只存在你本地，开发者与 GitHub 都无法获取；
**口令遗失则数据无法恢复**。

---

## 三、我们不做的事

- 不设服务器，不收集、不接收、不存储你的任何数据
- 不做分析统计、不埋点、不使用任何 tracking SDK
- 不出售、不共享数据给任何第三方
- 不读取与上述功能无关的页面内容
- 不收集个人身份信息、位置、设备指纹

---

## 四、权限说明

| 权限 | 用途 |
|---|---|
| `storage` / `unlimitedStorage` | 保存设置、翻译历史、单词本、剪贴板；内置词典约 4.8MB 需要放宽配额 |
| `<all_urls>`（host permission） | 在你打开的网页上执行划词翻译与整页翻译，并向你选定的翻译服务发起请求。**仅在你触发时工作**，不会在后台扫描页面 |
| `activeTab` | 通过快捷键或菜单对当前标签页操作 |
| `contextMenus` | 提供右键菜单（翻译此页 / 翻译选中文本 / 保存图片到剪贴板） |
| `sidePanel` | 在侧边栏打开快捷翻译 |
| `alarms` | 定时触发 GitHub 同步（仅在你开启同步时） |

---

## 五、删除你的数据

- 设置页 →「数据」→ 恢复默认设置
- 各页面（历史 / 单词本 / 剪贴板）均提供「清空」
- 卸载扩展会一并删除全部本地数据
- GitHub 上的同步文件需你自行在 GitHub 删除

---

## 六、第三方数据集

本扩展内置以下开源数据，随扩展分发，不涉及任何网络请求：

- **CMU Pronouncing Dictionary**（音标，BSD 二条款）
- **WordNet 3.1**（词性，Princeton WordNet License）

---

## 七、变更与联系

政策变更会更新本页顶部的日期，并在版本发布说明中注明。

问题或投诉请提交 issue：
<https://github.com/freedyc/super-immersive-translate/issues>
