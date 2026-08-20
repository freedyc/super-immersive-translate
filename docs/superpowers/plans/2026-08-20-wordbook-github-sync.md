# 单词本 GitHub 跨设备同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给单词本（`wordbook`）加上 GitHub 跨设备同步能力，复用刚上线的翻译历史 GitHub 同步基础设施（认证、同步载体、自动/手动触发），只新增单词本特有的合并逻辑和一个"是否同步单词本"的开关。

**Architecture:** 把 `utils/github-sync.js` 里写死给 `translationHistory` 用的 Gist/仓库读写抽成按文件名参数化的通用函数，历史记录和单词本各自的合并策略保持独立（历史按 `id` 去重、单词本按 `text.toLowerCase()` 去重），`background/background.js` 的一次同步周期依次跑历史同步再跑单词本同步（同一个防抖闹钟触发）。

**Tech Stack:** 同现有项目——Manifest V3 Chrome 扩展，Vite + `@crxjs/vite-plugin`，原生 `chrome.storage`/`fetch`，GitHub REST API v3（Gist API + Contents API）。

**Spec:** `docs/superpowers/specs/2026-08-20-wordbook-github-sync-design.md`

## Global Constraints

- Manifest V3 插件，无测试框架/无 linter/无 typecheck。验证方式统一为：`npm run build` → 手动加载/刷新 `dist/`（真实浏览器交互与真实 GitHub Token 验证按既有约定推迟给控制者/人类事后补做，不阻塞任务完成）。
- 单词本合并去重按 `text.toLowerCase()`，**不是**按 `id`；`id` 只做稳定标识，旧条目回填直接用 `crypto.randomUUID()`（同步），**不需要**像历史记录那样用确定性哈希——原因写在设计文档里："这类竞态在单词本这里不成立"。
- `utils/github-sync.js` 现有导出（`pullRemoteHistory`、`pushRemoteHistory`、`mergeHistories`、`syncNow`）是 `background/background.js` 依赖的唯一接口，重构底层读写时这四个导出的函数名/参数/返回值形状必须保持不变。
- 同步载体（Gist/仓库）、认证方式、自动/手动触发这些 UI 和调度逻辑已经完整实现，本计划不新增这类基础设施，只复用。
- UI 文案与代码注释使用中文。Git 提交信息使用本仓库既有的 conventional commit 前缀（`feat:`/`fix:`/`refactor:`/`docs:`/`perf:`）。

---

## Task 1: `utils/defaults.js` 新增单词本同步开关

**Files:**
- Modify: `utils/defaults.js`

**Interfaces:**
- Produces: `DEFAULTS.githubSyncWordbook`（`boolean`，默认 `true`），后续任务通过 `pick('githubSyncWordbook')` 读取

- [ ] **Step 1: 加设置项**

`utils/defaults.js` 第 33-36 行原本是：

```js
  githubSyncMode: 'manual', // 'auto' | 'manual'
  githubSyncIntervalMinutes: 30,

  // selection translation
```

改成：

```js
  githubSyncMode: 'manual', // 'auto' | 'manual'
  githubSyncIntervalMinutes: 30,
  githubSyncWordbook: true, // 单词本是否跟着一起同步，默认开，受 githubSyncEnabled 总开关约束

  // selection translation
```

- [ ] **Step 2: 构建验证**

Run: `npm run build`
Expected: 构建无报错。

- [ ] **Step 3: Commit**

```bash
git add utils/defaults.js
git commit -m "feat(wordbook): add githubSyncWordbook setting"
```

---

## Task 2: `utils/github-sync.js` 底层读写通用化（纯重构，行为不变）

**Files:**
- Modify: `utils/github-sync.js`

**Interfaces:**
- Consumes: 无新依赖
- Produces：新增内部（未导出）函数 `pullRemoteFile(gistFilename, repoPath)` / `pushRemoteFile(gistFilename, repoPath, mergeFn, list)`，供 Task 3 的单词本同步复用；`pullRemoteHistory()`、`pushRemoteHistory(list)`、`mergeHistories(local, remote)`、`syncNow()` 这四个现有导出的函数名/行为保持不变，`background/background.js` 不需要跟着改

这一步是纯重构：把原本写死给 `translationHistory` 用的 Gist/仓库读写，改成按文件名/路径参数化，`pullRemoteHistory`/`pushRemoteHistory` 基于新的通用函数重新实现，对外行为完全不变。

- [ ] **Step 1: 用整份新内容替换 `utils/github-sync.js` 的对应部分**

把文件开头到 `export async function pushRemoteHistory(list) { ... }` 结束（也就是 `GIST_FILENAME` 常量定义、`pullFromGist`/`createGist`/`pushToGist`/`pullFromRepo`/`pushToRepo`/`pullRemoteHistory`/`pushRemoteHistory` 这一整段，不包括后面的 `computeLegacyId`/`backfillIds`/`mergeHistories`/`syncNow`）替换成：

```js
// GitHub 同步：只负责"读远端 / 写远端 / 合并"，不做调度决策（调度在 background）。
import { pick } from './defaults.js';

const API_BASE = 'https://api.github.com';
const HISTORY_GIST_FILENAME = 'translation-history.json';

async function getAuthHeaders() {
  const { githubSyncAuthMethod, githubToken, githubOAuthAccessToken } = await chrome.storage.sync.get(
    pick('githubSyncAuthMethod', 'githubToken', 'githubOAuthAccessToken')
  );
  const token = githubSyncAuthMethod === 'oauth' ? githubOAuthAccessToken : githubToken;
  if (!token) throw new Error('未配置 GitHub Token');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function pullFromGist(headers, gistId, filename) {
  if (!gistId) return { list: [] };
  const res = await fetch(`${API_BASE}/gists/${gistId}`, { headers });
  if (res.status === 404) return { list: [] };
  if (!res.ok) throw new Error(`读取 Gist 失败: HTTP ${res.status}`);
  const data = await res.json();
  const file = data.files?.[filename];
  const list = file?.content ? JSON.parse(file.content) : [];
  return { list };
}

async function createGist(headers, filename, content) {
  const res = await fetch(`${API_BASE}/gists`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      description: 'Super Immersive Translate - 数据同步',
      public: false,
      files: { [filename]: { content } },
    }),
  });
  if (!res.ok) throw new Error(`创建 Gist 失败: HTTP ${res.status}`);
  const data = await res.json();
  return data.id;
}

async function pushToGist(headers, gistId, filename, list) {
  const content = JSON.stringify(list);
  if (!gistId) {
    return createGist(headers, filename, content);
  }
  const res = await fetch(`${API_BASE}/gists/${gistId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ files: { [filename]: { content } } }),
  });
  if (res.status === 404) {
    // 远端 gist 被用户手动删除：视为空远端，创建一个新 gist 顶替，调用方会把新 id 回填到设置里。
    return createGist(headers, filename, content);
  }
  if (!res.ok) throw new Error(`更新 Gist 失败: HTTP ${res.status}`);
  return gistId;
}

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function fromBase64(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function pullFromRepo(headers, { owner, repo, branch, path }) {
  if (!owner || !repo) return { list: [], sha: '' };
  const res = await fetch(
    `${API_BASE}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
    { headers }
  );
  if (res.status === 404) return { list: [], sha: '' };
  if (!res.ok) throw new Error(`读取仓库文件失败: HTTP ${res.status}`);
  const data = await res.json();
  const list = data.content ? JSON.parse(fromBase64(data.content)) : [];
  return { list, sha: data.sha };
}

async function pushToRepo(headers, target, list, mergeFn, attempt = 0) {
  const { list: remoteList, sha } = await pullFromRepo(headers, target);
  // 每次尝试都要与刚拉到的远端最新内容合并（而不仅在重试时），否则并发同步会互相覆盖，
  // 且大概率不会命中 409（因为用的就是最新 sha），下面的冲突重试保护也就形同虚设。
  const toWrite = mergeFn(list, remoteList);
  const body = {
    message: 'Update translation history',
    content: toBase64(JSON.stringify(toWrite)),
    branch: target.branch,
  };
  if (sha) body.sha = sha;
  const res = await fetch(
    `${API_BASE}/repos/${target.owner}/${target.repo}/contents/${encodeURIComponent(target.path)}`,
    { method: 'PUT', headers, body: JSON.stringify(body) }
  );
  if (res.status === 409 && attempt === 0) {
    return pushToRepo(headers, target, list, mergeFn, attempt + 1);
  }
  if (!res.ok) throw new Error(`写入仓库文件失败: HTTP ${res.status}`);
}

// filename 用于 Gist 场景（同一个 Gist 里多个文件按文件名区分）；
// repoPath 用于仓库场景（Contents API 按路径读写，跟 Gist 文件名分开传是因为
// 历史记录的仓库路径是用户在设置里自定义的 githubRepoPath，不一定等于 Gist 文件名）。
async function pullRemoteFile(gistFilename, repoPath) {
  const settings = await chrome.storage.sync.get(pick(
    'githubSyncTargetType', 'githubGistId',
    'githubRepoOwner', 'githubRepoName', 'githubRepoBranch'
  ));
  const headers = await getAuthHeaders();
  if (settings.githubSyncTargetType === 'repo') {
    const { list } = await pullFromRepo(headers, {
      owner: settings.githubRepoOwner,
      repo: settings.githubRepoName,
      branch: settings.githubRepoBranch,
      path: repoPath,
    });
    return list;
  }
  const { list } = await pullFromGist(headers, settings.githubGistId, gistFilename);
  return list;
}

async function pushRemoteFile(gistFilename, repoPath, mergeFn, list) {
  const settings = await chrome.storage.sync.get(pick(
    'githubSyncTargetType', 'githubGistId',
    'githubRepoOwner', 'githubRepoName', 'githubRepoBranch'
  ));
  const headers = await getAuthHeaders();
  if (settings.githubSyncTargetType === 'repo') {
    await pushToRepo(headers, {
      owner: settings.githubRepoOwner,
      repo: settings.githubRepoName,
      branch: settings.githubRepoBranch,
      path: repoPath,
    }, list, mergeFn);
    return;
  }
  const gistId = await pushToGist(headers, settings.githubGistId, gistFilename, list);
  if (gistId !== settings.githubGistId) {
    await chrome.storage.sync.set({ githubGistId: gistId });
  }
}

export async function pullRemoteHistory() {
  const { githubRepoPath } = await chrome.storage.sync.get(pick('githubRepoPath'));
  return pullRemoteFile(HISTORY_GIST_FILENAME, githubRepoPath);
}

export async function pushRemoteHistory(list) {
  const { githubRepoPath } = await chrome.storage.sync.get(pick('githubRepoPath'));
  return pushRemoteFile(HISTORY_GIST_FILENAME, githubRepoPath, mergeHistories, list);
}
```

文件后半部分（`computeLegacyId`、`backfillIds`、`mergeHistories`、`syncInFlight`、`syncNow`）先保持原样不动，Task 3 再改。

- [ ] **Step 2: 构建验证**

Run: `npm run build`
Expected: 构建无报错。`mergeHistories`/`syncNow` 还没变，`pushRemoteHistory` 引用的 `mergeHistories` 是模块顶层具名函数声明（会被提升），跨函数引用顺序不受文本先后位置影响，不会报 `mergeHistories is not defined`。

- [ ] **Step 3: 走查确认行为未变**

对照重构前后：
- `pullRemoteHistory()`：以前直接读 `githubGistId`/`githubRepoOwner` 等设置分发到 `pullFromGist`/`pullFromRepo`；现在改成读 `githubRepoPath` 后调用 `pullRemoteFile(HISTORY_GIST_FILENAME, githubRepoPath)`，`pullRemoteFile` 内部读同样那组设置、分发到同样的 `pullFromGist`/`pullFromRepo`——两条路径最终执行的 fetch 调用、URL、参数完全一致。
- `pushRemoteHistory(list)` 同理，多了一层 `pushRemoteFile` 转发，最终执行的 `pushToGist`/`pushToRepo` 调用参数不变（`pushToRepo` 新增的 `mergeFn` 参数在这里固定传 `mergeHistories`，跟重构前 `pushToRepo` 内部硬编码调用 `mergeHistories` 是同一个函数、同一个调用点，只是从"写死在函数体内"变成"外部传入"）。

不需要额外验证步骤，这一步是行为保持不变的重构，功能验证在 Task 3/后续任务里通过实际同步流程覆盖。

- [ ] **Step 4: Commit**

```bash
git add utils/github-sync.js
git commit -m "refactor(sync): generalize gist/repo read-write to be filename-parameterized"
```

---

## Task 3: 单词本合并逻辑 + `syncWordbookNow` + 调度整合

**Files:**
- Modify: `utils/github-sync.js`

**Interfaces:**
- Consumes: Task 2 的 `pullRemoteFile`/`pushRemoteFile`（未导出，模块内部函数）
- Produces:
  - `mergeWordbook(local, remote): Array<WordbookEntry>`（导出，供后续可能的单元验证/其他调用方使用）
  - `syncNow(): Promise<{ ok: boolean, error?: string }>`（导出，签名不变，内部现在同时跑历史和单词本）
  - `WordbookEntry` 形状：`{ id, text, translations, known, timestamp, url?, title? }`

- [ ] **Step 1: 加单词本相关常量、合并函数、回填函数、远端读写函数**

在 `mergeHistories` 函数定义（现有代码，`export function mergeHistories(local, remote) { ... }`）**之后**追加：

```js

const WORDBOOK_GIST_FILENAME = 'wordbook.json';
const WORDBOOK_REPO_PATH = 'wordbook.json';

export function mergeWordbook(local, remote) {
  const byText = new Map();
  // remote 在前、local 在后：同一个 key 第二次出现时（一定是 local）该次的字段优先，
  // 从而实现"本地同引擎覆盖远端、id 优先取本地"的约定；known/timestamp 用哪边都一样
  // （|| 和 Math.min 本身顺序无关）。
  [...remote, ...local].forEach((entry) => {
    const key = entry.text.toLowerCase();
    const prior = byText.get(key);
    if (!prior) {
      byText.set(key, entry);
      return;
    }
    byText.set(key, {
      id: entry.id || prior.id,
      text: prior.text,
      translations: { ...prior.translations, ...entry.translations },
      known: prior.known || entry.known,
      timestamp: Math.min(prior.timestamp, entry.timestamp),
      url: entry.url || prior.url,
      title: entry.title || prior.title,
    });
  });
  return Array.from(byText.values()).sort((a, b) => b.timestamp - a.timestamp);
}

// 单词本按 text 去重，id 不参与去重判断，所以旧条目回填 id 不需要像历史记录那样用
// 确定性哈希——哪怕两次独立读取给同一个单词生成了两个不同的随机 id，mergeWordbook
// 依然会按 text 把它们合并成一条（id 字段取本地那个），不会重现历史记录同步踩过的坑。
function backfillWordbookIds(rawList) {
  return rawList.map((e) => (e.id ? e : { ...e, id: crypto.randomUUID() }));
}

async function pullRemoteWordbook() {
  return pullRemoteFile(WORDBOOK_GIST_FILENAME, WORDBOOK_REPO_PATH);
}

async function pushRemoteWordbook(list) {
  return pushRemoteFile(WORDBOOK_GIST_FILENAME, WORDBOOK_REPO_PATH, mergeWordbook, list);
}
```

- [ ] **Step 2: 把现有 `syncNow()` 的历史同步逻辑拆成 `syncHistoryNow()`，新增 `syncWordbookNow()`，重写 `syncNow()` 做编排**

现有的（Task 2 之后仍然原样保留的）这一段：

```js
let syncInFlight = false;

export async function syncNow() {
  if (syncInFlight) {
    // 已经有一次同步在跑，本次直接跳过（不算错误）；下一轮闹钟很快会补上。
    return { ok: true, error: null };
  }
  syncInFlight = true;
  try {
    const { translationHistory: rawLocal = [] } = await chrome.storage.local.get('translationHistory');
    const local = await backfillIds(rawLocal);
    const { historyMaxItems = 0 } = await chrome.storage.sync.get(pick('historyMaxItems'));

    const remote = await pullRemoteHistory();
    const merged = mergeHistories(local, remote);

    // pullRemoteHistory() 期间（网络请求，可能几秒）本地可能又通过 saveHistoryEntry 写入了新记录。
    // 写回本地前重新读一次最新快照并再合并一次，避免用"读取时的旧快照"覆盖掉这段时间内的新写入，
    // 同时把这份最新数据一并推送到远端，避免新记录永远没被同步出去。
    const { translationHistory: latestRawLocal = [] } = await chrome.storage.local.get('translationHistory');
    const latestLocal = await backfillIds(latestRawLocal);
    const finalMerged = mergeHistories(latestLocal, merged);

    const localSlice = historyMaxItems > 0 ? finalMerged.slice(0, historyMaxItems) : finalMerged;

    await chrome.storage.local.set({ translationHistory: localSlice });
    await pushRemoteHistory(finalMerged);
    await chrome.storage.local.set({ githubSyncStatus: { lastSyncAt: Date.now(), lastError: null } });
    return { ok: true, error: null };
  } catch (err) {
    await chrome.storage.local.set({ githubSyncStatus: { lastSyncAt: Date.now(), lastError: err.message } });
    return { ok: false, error: err.message };
  } finally {
    syncInFlight = false;
  }
}
```

整体替换成：

```js
async function syncHistoryNow() {
  const { translationHistory: rawLocal = [] } = await chrome.storage.local.get('translationHistory');
  const local = await backfillIds(rawLocal);
  const { historyMaxItems = 0 } = await chrome.storage.sync.get(pick('historyMaxItems'));

  const remote = await pullRemoteHistory();
  const merged = mergeHistories(local, remote);

  // pullRemoteHistory() 期间（网络请求，可能几秒）本地可能又通过 saveHistoryEntry 写入了新记录。
  // 写回本地前重新读一次最新快照并再合并一次，避免用"读取时的旧快照"覆盖掉这段时间内的新写入，
  // 同时把这份最新数据一并推送到远端，避免新记录永远没被同步出去。
  const { translationHistory: latestRawLocal = [] } = await chrome.storage.local.get('translationHistory');
  const latestLocal = await backfillIds(latestRawLocal);
  const finalMerged = mergeHistories(latestLocal, merged);

  const localSlice = historyMaxItems > 0 ? finalMerged.slice(0, historyMaxItems) : finalMerged;

  await chrome.storage.local.set({ translationHistory: localSlice });
  await pushRemoteHistory(finalMerged);
}

async function syncWordbookNow() {
  const { wordbook: rawLocal = [] } = await chrome.storage.local.get('wordbook');
  const local = backfillWordbookIds(rawLocal);

  const remote = await pullRemoteWordbook();
  const merged = mergeWordbook(local, remote);

  // 同样防竞态：网络请求期间本地可能又存了新单词，写回前重新读一次再合并一次。
  const { wordbook: latestRawLocal = [] } = await chrome.storage.local.get('wordbook');
  const latestLocal = backfillWordbookIds(latestRawLocal);
  const finalMerged = mergeWordbook(latestLocal, merged);

  // 单词本没有类似 historyMaxItems 的上限设置，全量保留，不裁剪。
  await chrome.storage.local.set({ wordbook: finalMerged });
  await pushRemoteWordbook(finalMerged);
}

let syncInFlight = false;

export async function syncNow() {
  if (syncInFlight) {
    // 已经有一次同步在跑，本次直接跳过（不算错误）；下一轮闹钟很快会补上。
    return { ok: true, error: null };
  }
  syncInFlight = true;
  try {
    await syncHistoryNow();

    const { githubSyncWordbook } = await chrome.storage.sync.get(pick('githubSyncWordbook'));
    if (githubSyncWordbook) {
      await syncWordbookNow();
    }

    await chrome.storage.local.set({ githubSyncStatus: { lastSyncAt: Date.now(), lastError: null } });
    return { ok: true, error: null };
  } catch (err) {
    await chrome.storage.local.set({ githubSyncStatus: { lastSyncAt: Date.now(), lastError: err.message } });
    return { ok: false, error: err.message };
  } finally {
    syncInFlight = false;
  }
}
```

（历史同步失败会直接抛到外层 catch，单词本这次就不跑了，等下一轮闹钟一起重试——这是设计文档里"共享一份 `githubSyncStatus`、不做分状态 UI"决定的自然结果，不需要额外处理。）

- [ ] **Step 3: 构建 + 手动走查**

Run: `npm run build`

`mergeWordbook`/`syncWordbookNow` 是 ES module 内部函数，背景页 Console 默认访问不到模块作用域变量，所以这一步用直接读源码走查代替交互式调用，走查以下几点：

- 两条 `text` 相同、大小写不同（比如 `Apple` 和 `apple`）的本地+远端条目合并后，`byText` 只会有一条——因为分组用的 `key` 是 `entry.text.toLowerCase()`，确认大小写不敏感
- 本地有 `translations: { deepl: 'x' }`、远端有 `translations: { google: 'y' }`（同一个单词，不同引擎），合并后的 `translations` 应该同时有 `deepl` 和 `google` 两个键（`{ ...prior.translations, ...entry.translations }`，两边都保留）
- 本地 `known: true`、远端 `known: false`（或反过来），合并后 `known` 都应该是 `true`（`prior.known || entry.known`）
- `syncWordbookNow()` 里两次 `chrome.storage.local.get('wordbook')` 之间，如果假设第二次读取多了一条新单词，`mergeWordbook(latestLocal, merged)` 应该把这条新单词也保留在 `finalMerged` 里（结构上跟 `syncHistoryNow()` 的防竞态逻辑完全一致，照抄自那套已经验证过的模式）

- [ ] **Step 4: Commit**

```bash
git add utils/github-sync.js
git commit -m "feat(wordbook): add mergeWordbook and syncWordbookNow, wire into syncNow"
```

---

## Task 4: `content/selection.js` 保存单词时加 id + 广播 `wordbookChanged`

**Files:**
- Modify: `content/selection.js:220-237`

**Interfaces:**
- Produces: 保存的 `wordbook` 条目带 `id` 字段；广播 `chrome.runtime.sendMessage({ action: 'wordbookChanged' })`

- [ ] **Step 1: 改保存逻辑**

第 220-237 行原本是：

```js
      const word = {
        text: sourceText,
        translations,
        url: window.location.href,
        title: document.title,
        timestamp: Date.now()
      };

      // Save to storage
      const { wordbook = [] } = await chrome.storage.local.get('wordbook');
      // Avoid duplicates
      const exists = wordbook.findIndex(w => w.text.toLowerCase() === sourceText.toLowerCase());
      if (exists >= 0) {
        wordbook[exists] = { ...wordbook[exists], ...word };
      } else {
        wordbook.unshift(word);
      }
      await chrome.storage.local.set({ wordbook });
```

改成：

```js
      const word = {
        id: crypto.randomUUID(),
        text: sourceText,
        translations,
        url: window.location.href,
        title: document.title,
        timestamp: Date.now()
      };

      // Save to storage
      const { wordbook = [] } = await chrome.storage.local.get('wordbook');
      // Avoid duplicates
      const exists = wordbook.findIndex(w => w.text.toLowerCase() === sourceText.toLowerCase());
      if (exists >= 0) {
        word.id = wordbook[exists].id || word.id; // 更新已有条目时保留原 id，不必要地重新生成
        wordbook[exists] = { ...wordbook[exists], ...word };
      } else {
        wordbook.unshift(word);
      }
      await chrome.storage.local.set({ wordbook });
      chrome.runtime.sendMessage({ action: 'wordbookChanged' }).catch(() => {});
```

- [ ] **Step 2: 构建 + 静态核对**

Run: `npm run build`
Expected: 无报错。核对：`word.id` 在两条分支（新建/更新已有）下都有值；`wordbookChanged` 消息发送用了 `.catch(() => {})`，跟 `utils/history.js` 里 `saveHistoryEntry` 的既有写法一致，不会因为没有监听者而抛出未处理的 rejection。

- [ ] **Step 3: Commit**

```bash
git add content/selection.js
git commit -m "feat(wordbook): assign id and broadcast wordbookChanged on save"
```

---

## Task 5: `sandbox/sandbox.js` 保存单词时加 id + 广播 `wordbookChanged`

**Files:**
- Modify: `sandbox/sandbox.js:260-272`

**Interfaces:**
- Produces: 保存的 `wordbook` 条目带 `id` 字段；广播 `chrome.runtime.sendMessage({ action: 'wordbookChanged' })`

- [ ] **Step 1: 改保存逻辑**

第 260-272 行原本是：

```js
  // Save to Wordbook
  saveWordBtn.addEventListener('click', async () => {
    if (!currentSaveData) return;
    const { wordbook = [] } = await chrome.storage.local.get('wordbook');
    if (!wordbook.some(w => w.text === currentSaveData.source)) {
      wordbook.unshift({
        text: currentSaveData.source,
        translations: { [currentSaveData.engine]: currentSaveData.target },
        known: false,
        timestamp: Date.now()
      });
      await chrome.storage.local.set({ wordbook });
    }
```

改成：

```js
  // Save to Wordbook
  saveWordBtn.addEventListener('click', async () => {
    if (!currentSaveData) return;
    const { wordbook = [] } = await chrome.storage.local.get('wordbook');
    if (!wordbook.some(w => w.text === currentSaveData.source)) {
      wordbook.unshift({
        id: crypto.randomUUID(),
        text: currentSaveData.source,
        translations: { [currentSaveData.engine]: currentSaveData.target },
        known: false,
        timestamp: Date.now()
      });
      await chrome.storage.local.set({ wordbook });
      chrome.runtime.sendMessage({ action: 'wordbookChanged' }).catch(() => {});
    }
```

- [ ] **Step 2: 构建 + 静态核对**

Run: `npm run build`
Expected: 无报错。这里只有"新建"一条分支（`if (!wordbook.some(...))` 已经排除了重复文本的情况），不需要像 selection.js 那样处理"更新已有条目保留 id"的分支。

- [ ] **Step 3: Commit**

```bash
git add sandbox/sandbox.js
git commit -m "feat(wordbook): assign id and broadcast wordbookChanged on save"
```

---

## Task 6: `background/background.js` 接入 `wordbookChanged` 消息

**Files:**
- Modify: `background/background.js`

**Interfaces:**
- Consumes: `wordbookChanged` 消息（Task 4、Task 5 已在发送）；`DEFAULTS.githubSyncWordbook`（Task 1）

- [ ] **Step 1: 加消息分支**

在现有 `onMessage` 监听器的 `historyChanged` 分支之后追加一个 `wordbookChanged` 分支。现有的 `historyChanged` 分支长这样（供定位，不需要改动它）：

```js
  if (msg.action === 'historyChanged') {
    chrome.storage.sync.get(pick('githubSyncEnabled', 'githubSyncMode')).then(({ githubSyncEnabled, githubSyncMode }) => {
      // 只有「启用同步」且同步方式是「自动」时，写入后才排一次防抖同步；
      // 手动模式下用户翻译后不应该被静默联网同步。
      if (githubSyncEnabled && githubSyncMode === 'auto') {
        chrome.alarms.create('history-sync-debounce', { delayInMinutes: 1 });
      }
    });
  }
```

在这个 `if` 块结束的 `}` 之后（还在 `onMessage` 监听器函数体内）追加：

```js
  if (msg.action === 'wordbookChanged') {
    chrome.storage.sync.get(pick('githubSyncEnabled', 'githubSyncMode', 'githubSyncWordbook')).then(
      ({ githubSyncEnabled, githubSyncMode, githubSyncWordbook }) => {
        // 同样只在「启用同步」+「自动」+「单词本同步开关也开着」时才排队；
        // 单词本同步被单独关掉时，光是存单词不应该触发联网同步。
        if (githubSyncEnabled && githubSyncMode === 'auto' && githubSyncWordbook) {
          chrome.alarms.create('history-sync-debounce', { delayInMinutes: 1 });
        }
      }
    );
  }
```

（复用同一个 `history-sync-debounce` 闹钟名字，不新增闹钟——历史和单词本变更触发的是同一次"该同步了"，`chrome.alarms.onAlarm` 触发后调用的 `syncNow()` 内部会依次处理两者。）

- [ ] **Step 2: 构建 + 静态核对**

Run: `npm run build`
Expected: 无报错。核对：新分支跟 `historyChanged`/`triggerHistorySync` 分支在同一个 `onMessage` 监听器里并列存在，互不干扰，且这个新分支不调用 `sendResponse`/不 `return true`（跟 `historyChanged` 一样是 fire-and-forget，不需要异步响应）。

- [ ] **Step 3: Commit**

```bash
git add background/background.js
git commit -m "feat(wordbook): trigger debounced sync on wordbookChanged"
```

---

## Task 7: options 页面「同步单词本」开关

**Files:**
- Modify: `options/options.html`
- Modify: `options/options.js`

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS.githubSyncWordbook`（Task 1）

- [ ] **Step 1: `options.html` 加复选框**

在「GitHub 跨设备同步」卡片里，Token 输入块和「同步载体」块之间插入。定位锚点（当前文件状态）：

```html
                <a href="https://github.com/settings/tokens/new?scopes=gist&description=Super%20Immersive%20Translate" target="_blank" rel="noopener" class="text-xs link link-primary w-fit">
                  去 GitHub 创建 Token（需要 gist 权限）
                </a>
              </div>

              <div class="flex flex-col gap-1">
                <label class="text-sm text-base-content/70">同步载体</label>
```

改成：

```html
                <a href="https://github.com/settings/tokens/new?scopes=gist&description=Super%20Immersive%20Translate" target="_blank" rel="noopener" class="text-xs link link-primary w-fit">
                  去 GitHub 创建 Token（需要 gist 权限）
                </a>
              </div>

              <label class="label cursor-pointer justify-start gap-3 px-0">
                <input type="checkbox" id="githubSyncWordbook" class="checkbox checkbox-primary checkbox-sm" />
                <span class="label-text text-sm">同步单词本</span>
              </label>

              <div class="flex flex-col gap-1">
                <label class="text-sm text-base-content/70">同步载体</label>
```

- [ ] **Step 2: `options.js` load 部分**

在第 104-105 行（`updateGithubSyncUI(settings.githubSyncEnabled);` / `refreshSyncStatus();`）之后追加：

```js
  updateGithubSyncUI(settings.githubSyncEnabled);
  refreshSyncStatus();
  $('githubSyncWordbook').checked = settings.githubSyncWordbook;
```

- [ ] **Step 3: `options.js` 监听器**

在第 416 行 `$('githubToken').addEventListener('input', debounce(saveAll, 500));` 之后追加：

```js
  $('githubToken').addEventListener('input', debounce(saveAll, 500));

  $('githubSyncWordbook').addEventListener('change', saveAll);
```

- [ ] **Step 4: `saveAll()` 写回**

第 487-488 行（`newSettings` 对象里）：

```js
      githubSyncEnabled: $('githubSyncEnabled').checked,
      githubToken: $('githubToken').value,
```

改成：

```js
      githubSyncEnabled: $('githubSyncEnabled').checked,
      githubToken: $('githubToken').value,
      githubSyncWordbook: $('githubSyncWordbook').checked,
```

- [ ] **Step 5: 构建 + 手动验证**

Run: `npm run build`，刷新插件，打开 options「数据」标签。

Expected: 「GitHub 跨设备同步」卡片里，Token 输入框下面能看到「同步单词本」复选框，默认勾选（对应 `githubSyncWordbook: true` 的默认值）。取消勾选，切到其他标签再切回来，确认状态保持（说明写入了 storage）。

在 options 页 DevTools Console 执行：

```js
chrome.storage.sync.get('githubSyncWordbook', console.log)
```

Expected: 反映刚才勾选/取消勾选的状态。

- [ ] **Step 6: Commit**

```bash
git add options/options.html options/options.js
git commit -m "feat(options): add sync-wordbook toggle in GitHub sync settings"
```

---

## Task 8: 单词本页面加同步提示文案

**Files:**
- Modify: `wordbook/index.html`

**Interfaces:**
- 无（纯文案，无逻辑）

- [ ] **Step 1: 加提示文案**

定位锚点（当前文件状态，`</header>` 结束标签和「Views container」注释之间）：

```html
      </header>

      <!-- Views container -->
      <main class="flex-1 p-6">
```

改成：

```html
      </header>

      <p class="text-xs text-base-content/40 text-center py-1">提示：开启 GitHub 同步后，删除的单词可能会在下次同步时从其他设备恢复</p>

      <!-- Views container -->
      <main class="flex-1 p-6">
```

（跟 `history/index.html:30` 已有的同类提示文案是同一个风格：`text-xs text-base-content/40 text-center py-1`。）

- [ ] **Step 2: 构建 + 手动验证**

Run: `npm run build`，刷新插件，打开单词本页面，确认顶部导航栏下方能看到这句提示文字，样式跟历史页面的提示一致（灰色小字、居中）。

- [ ] **Step 3: Commit**

```bash
git add wordbook/index.html
git commit -m "docs(wordbook): add note about sync merge affecting deletes"
```

---

## Spec Coverage Check

| 设计文档要点 | 覆盖任务 |
|---|---|
| 复用同一个 Gist/仓库，单词本另存 `wordbook.json` | Task 2（通用读写）、Task 3（`pullRemoteWordbook`/`pushRemoteWordbook`） |
| id 字段 + 随机 UUID 回填（不用确定性哈希） | Task 3（`backfillWordbookIds`）、Task 4/5（新条目生成 id） |
| `mergeWordbook` 按 text 去重、translations 合并、known 用 OR、timestamp 取 min | Task 3 |
| `githubSyncWordbook` 设置项，默认开，受总开关约束 | Task 1（默认值）、Task 6（调度侧判断）、Task 7（UI） |
| 删除/清空的已知限制 + 文案提示 | Task 8 |
| 同步触发/调度复用同一个防抖闹钟 | Task 6 |
| 错误处理复用同一份 `githubSyncStatus` | Task 3（`syncNow` 编排，历史失败时单词本这轮不跑，共享 catch） |

## 不在本计划范围内（同设计文档）

- 单词本条目未来新增字段的合并策略
- 删除同步（tombstone）
- OAuth Device Flow（历史记录设计已经标注为独立后续项，本次同样不涉及）
