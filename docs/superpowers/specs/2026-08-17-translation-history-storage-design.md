# 设计：翻译历史存储统一 + 可配置上限 + GitHub 跨设备同步

日期：2026-08-17
状态：已批准设计，待写实现计划

## 背景与目标

翻译历史（`translationHistory`，存于 `chrome.storage.local`）目前有两处独立的写入逻辑：

- `content/selection.js:376-388` 的 `saveToHistory()` —— 划词翻译面板写入，上限硬编码 500 条，条目带 `url`/`title`
- `sandbox/sandbox.js:277-289` 的 `saveToHistory()` —— 快捷翻译（sandbox）写入，上限硬编码 1000 条，条目不带 `url`/`title`

两处上限不一致、逻辑重复。目标：

1. **统一**成一份共享保存逻辑
2. 保存上限改为**默认不限制、用户可在设置里自定义数值**
3. 支持**跨设备同步**（借助用户自己的 GitHub 账号，不引入自建后端）

## 关键决策

| 决策点 | 结论 |
|--------|------|
| 本地存储上限 | 默认 `0`（不限制）；新增 `unlimitedStorage` 权限去掉 chrome.storage.local 的 10MB 硬顶；用户可在设置里填自定义上限 |
| 隐私提示 | 数据分区加说明文案：历史默认仅存本机，开启 GitHub 同步才会离开本机 |
| 同步载体 | Secret Gist 与用户指定仓库文件，两种都支持，用户选 |
| 同步认证 | Personal Access Token 粘贴（P0，默认）与 GitHub OAuth Device Flow 登录（P1），两种都支持 |
| 同步触发 | 自动（写入后防抖 + 用户设定周期）与手动「立即同步」按钮，两种都支持 |
| 多端合并策略 | 按条目 `id` 去重合并（union），不做覆盖式同步 |
| 远端数据是否受本地上限约束 | 不受约束——远端保留全量历史，只有本地展示/存储受用户设置的 `historyMaxItems` 限制 |
| 本地写入异常兜底 | 有 `unlimitedStorage` 后极少触发；仍保留一层裁剪最早记录 + 提示的兜底 |

## 架构

### 1. 本地存储统一（`utils/history.js`，新文件）

仿 `utils/defaults.js` 的单一入口模式：

```js
export async function saveHistoryEntry({ text, translation, engine, url, title }) {
  const { historyMaxItems = 0 } = await chrome.storage.sync.get(pick('historyMaxItems'));
  const { translationHistory = [] } = await chrome.storage.local.get('translationHistory');
  translationHistory.unshift({
    id: crypto.randomUUID(),
    text, translation, engine, url, title,
    timestamp: Date.now(),
  });
  if (historyMaxItems > 0 && translationHistory.length > historyMaxItems) {
    translationHistory.length = historyMaxItems;
  }
  try {
    await chrome.storage.local.set({ translationHistory });
  } catch (e) {
    // 极端情况（磁盘写满等）：裁掉最早 15%，重试一次，并留痕供 UI 提示
    translationHistory.splice(-Math.ceil(translationHistory.length * 0.15));
    await chrome.storage.local.set({ translationHistory, historyTrimNotice: Date.now() });
  }
  chrome.runtime.sendMessage({ action: 'historyChanged' }).catch(() => {});
}
```

- `content/selection.js` 的 `saveToHistory()`（376-388 行）改为调用它，传 `url: location.href, title: document.title`
- `sandbox/sandbox.js` 的 `saveToHistory()`（277-289 行）改为调用它，不传 `url`/`title`
- 末尾的 `historyChanged` 消息用于驱动后台的防抖同步（见第 3 节），无监听者时静默失败，正常场景无副作用

### 2. 设置项（`utils/defaults.js` 的 `DEFAULTS` 新增）

```js
// history
historyMaxItems: 0, // 0 = 不限制

// GitHub sync
githubSyncEnabled: false,
githubSyncAuthMethod: 'pat',        // 'pat' | 'oauth'
githubToken: '',                     // PAT，用户粘贴
githubOAuthAccessToken: '',          // Device Flow 登录后写入
githubSyncTargetType: 'gist',        // 'gist' | 'repo'
githubGistId: '',                    // 首次同步自动创建后回填
githubRepoOwner: '',
githubRepoName: '',
githubRepoBranch: 'main',
githubRepoPath: 'translation-history.json',
githubSyncMode: 'auto',              // 'auto' | 'manual'
githubSyncIntervalMinutes: 30,
```

`options/options.js`「数据」分区新增：
- 历史保存上限输入框（写 `historyMaxItems`）+ 隐私说明文案
- 新增「历史同步」子分区：认证方式切换（Token 粘贴 / GitHub 登录）、载体切换（Gist / 仓库，仓库时显示 owner/repo/branch/path 四个输入）、同步模式（自动周期分钟数 / 手动）、「立即同步」按钮、最近同步时间与状态展示

### 3. GitHub 同步（`utils/github-sync.js`，新文件 + `background/background.js` 编排）

**`utils/github-sync.js`** 只负责网络与合并，纯函数式，不管调度：

- `pullRemoteHistory()` —— 按 `githubSyncTargetType` 走 Gist（`GET /gists/{id}`）或 Repo Contents（`GET /repos/{owner}/{repo}/contents/{path}?ref={branch}`，base64 解码）；目标不存在（gist id 为空、或 repo 404）时返回空数组
- `pushRemoteHistory(list)` —— 全量覆盖式写回（写的是**合并后的全量数据**，不是增量）：
  - Gist：`githubGistId` 为空则 `POST /gists`（secret gist）创建并回填 id；否则 `PATCH /gists/{id}`
  - Repo：先 `GET` 拿当前 `sha`（文件不存在则不带 sha，走创建语义），**每次尝试（含首次）**都把待写入列表与刚拉到的 `remoteList` 再 `mergeHistories` 一次后才 `PUT /repos/{owner}/{repo}/contents/{path}`；`sha` 冲突（409）时重试一次（重试会重新 `GET` 最新内容与 `sha`，同样先 merge 再写），仍失败则记录错误、等下一轮（**注意（分支整体审查后修正）**：首次尝试如果跳过合并直接覆盖推送，并发同步时会互相冲掉对方新增的记录，且大概率不会触发 409，"冲突重试再合并"这层保护也就形同虚设——所以合并必须发生在每次尝试，不能只发生在重试时）
- `mergeHistories(local, remote)` —— 按 `id` 去重 union，按 `timestamp` 降序排序，返回合并后全量列表（不做本地上限裁剪，裁剪只发生在写入本地 `chrome.storage.local` 之前）
- `syncNow()`：`pullRemoteHistory()` → `mergeHistories(local, remote)` → 按 `historyMaxItems` 裁出本地要存的子集写 `chrome.storage.local`，同时把**未裁剪的合并全量**通过 `pushRemoteHistory()` 写回远端 → 更新 `chrome.storage.local` 里的 `githubSyncStatus: { lastSyncAt, lastError }`（本地专用状态，不参与同步）

**调度**在 `background/background.js`：
- `manifest.json` 的 `permissions` 新增 `"alarms"`
- 监听 `historyChanged` 消息：若 `githubSyncEnabled`，用 `chrome.alarms.create('history-sync-debounce', { delayInMinutes: 1 })` 重置一个一次性防抖闹钟（同一 name 会覆盖前一个，起到防抖效果）
- 若 `githubSyncMode === 'auto'`：另起一个周期闹钟 `chrome.alarms.create('history-sync-periodic', { periodInMinutes: githubSyncIntervalMinutes })`，设置变更时（`chrome.storage.onChanged`）重建
- `chrome.alarms.onAlarm` 统一调用 `syncNow()`
- 监听 `triggerHistorySync` 消息（options/history 页「立即同步」按钮发出）→ 立即调用 `syncNow()`，不受 mode 限制

不需要额外声明 GitHub API 的 host 权限——`manifest.json:7` 现有的 `"host_permissions": ["<all_urls>"]` 已覆盖后台/扩展页面对 `api.github.com` 的 fetch。

### 4. 认证

- **P0：PAT 粘贴**——设置页给出创建 token 的链接与所需 scope 说明（Gist 目标要 `gist` scope；仓库目标要 `repo` 或 `public_repo`），用户粘贴后写入 `githubToken`，请求头 `Authorization: Bearer {token}`
- **P1：OAuth Device Flow**——需要项目维护者（你）先在 GitHub 注册一个 OAuth App 拿到 `client_id`（无需 client_secret，Device Flow 是公开客户端流程），写死为代码里的常量。流程：设置页点「GitHub 登录」→ `POST https://github.com/login/device/code` 拿 `user_code`/`verification_uri` → 展示给用户并打开该链接 → 轮询 `POST https://github.com/login/oauth/access_token` 直到用户完成授权 → 拿到 token 写入 `githubOAuthAccessToken`
  - **前置条件**：这一步依赖你手动去 GitHub 注册 OAuth App，不是我能代劳的部分；App 一旦创建后长期需要维持有效（被封禁/删除会导致所有用户 OAuth 登录失效，PAT 用户不受影响）。建议先落地 P0，P1 单独排期

### 5. 错误处理

- Token 失效/权限不足（401/403）→ 写 `githubSyncStatus.lastError`，设置页高亮提示，不自动禁用同步，下一轮仍会重试（用户改完 token 自然恢复）
- 网络失败/超时 → 静默捕获记录 `lastError`，等下一轮
- Gist 被用户手动删除（远端 404 且本地记着旧 `githubGistId`）→ 视为空远端，重新创建一个新 gist 并回填新 id
- 仓库文件不存在（首次同步）→ 按创建语义写入，不报错
- 写冲突（repo 409）→ 重新拉取合并重试一次，仍失败记录 `lastError` 等下一轮

## 单元边界

- **`utils/history.js`**：本地历史的唯一写入口，职责是"存一条 + 应用上限 + 广播变更"，不知道 GitHub 同步的存在
- **`utils/github-sync.js`**：纯粹的"读远端 / 写远端 / 合并"，不做调度决策，可独立测试
- **`background/background.js` 的同步编排**：只负责"什么时候调用 `syncNow()`"（防抖/周期/手动三种触发），不关心合并细节
- **`options/options.js` 同步设置 UI**：只读写设置项 + 触发手动同步消息，不直接碰 GitHub API

## 分阶段实现（每阶段可独立 `npm run build` + 加载 dist 验收）

1. **本地统一 + 可配置上限**：`unlimitedStorage` 权限、`utils/history.js`、两处 `saveToHistory` 改造、`historyMaxItems` 设置项与 UI、隐私说明文案
2. **GitHub 同步基础设施（PAT + Gist，手动同步）**：`utils/github-sync.js`（Gist 分支）、`alarms` 权限、「立即同步」按钮闭环，先只支持手动触发验证正确性
3. **自动同步**：防抖闹钟 + 周期闹钟 + 设置变更时重建闹钟
4. **仓库目标支持**：`utils/github-sync.js` 的 Repo 分支（sha 获取/冲突重试）+ 对应设置 UI
5. **OAuth Device Flow（P1，需先手动注册 GitHub OAuth App）**：登录 UI + 轮询逻辑

## 不在范围内

- 自建同步后端服务
- 端到端加密远端历史内容（远端明文存于用户自己的 GitHub 账号下，等同于当前信任 chrome.storage.sync/Google 的信任模型延伸到 GitHub）
- Gist/仓库以外的同步载体（如 Dropbox、WebDAV 等）
- 多 GitHub 账号 / 多同步目标并行

## 验收标准

1. `npm run build` 成功，`content/selection.js` 与 `sandbox/sandbox.js` 均通过 `utils/history.js` 写历史，行为一致
2. 设置里把上限改成任意值（含 0=不限制）后，新增历史条目按该值裁剪
3. 关闭 GitHub 同步时，历史数据不发生任何网络请求
4. 开启同步（PAT + Gist，手动模式）：两台设备各自新增历史条目后，分别点「立即同步」，两边都能看到对方新增的记录，且列表按时间新到旧排序
5. 自动模式下，本地保存一条新历史后，约 1 分钟内后台完成一次防抖同步（可用网络面板/日志确认）
6. 仓库目标下，两台设备并发写入不丢数据（合并去重后条目数 = 二者 union）
7. token 失效时，设置页有明确的错误提示，不阻塞本地翻译/历史保存功能

## 风险

- Device Flow 依赖长期维护的 GitHub OAuth App，是本设计里唯一需要项目维护者做"代码之外"的手动前置操作的部分
- `chrome.alarms` 的 `delayInMinutes` 存在平台最小间隔限制（历史上部分 Chrome 版本对一次性短闹钟有约 30 秒下限），防抖窗口按 1 分钟设计以留余量
- 远端历史明文可读，是否需要加密取决于用户对自己 GitHub 账号私密性的信任，本期不做加密
