# 设计：单词本 GitHub 跨设备同步

日期：2026-08-20
状态：已批准设计，待写实现计划

## 背景与目标

翻译历史（`translationHistory`）已经支持通过用户自己的 GitHub 账号（Secret Gist 或指定仓库）做跨设备同步（见 `docs/superpowers/specs/2026-08-17-translation-history-storage-design.md`）。单词本（`wordbook`，存于 `chrome.storage.local`）目前没有任何跨设备能力，只能靠「导出全部数据」手动导入导出。

目标：给单词本加上同样的 GitHub 跨设备同步能力，**最大程度复用**已经做好并跑过完整实现+审查流程的翻译历史同步基础设施（认证、同步载体、自动/手动触发），只新设计单词本特有的部分。

排查确认：`chrome.storage.local` 里除了 `translationHistory` 和 `wordbook`，没有其他用户数据（`githubSyncStatus`/`historyTrimNotice` 是内部状态，不算）；设置类数据已经通过 `chrome.storage.sync` 走 Chrome 原生同步，不在本设计范围内。

## 关键决策

| 决策点 | 结论 |
|--------|------|
| 同步载体 | 复用翻译历史用的同一个 Gist/仓库，单词本另存一个文件 `wordbook.json` |
| 认证 | 复用同一个 Token/同一套认证 UI，不新增 |
| 合并去重 key | 按 `text.toLowerCase()`，不是按 `id`（原因见下） |
| id 字段 | 新增 `id: crypto.randomUUID()`（新条目生成、旧条目回填），但**只做稳定标识，不参与去重判断** |
| 旧条目 id 回填方式 | 直接用随机 UUID，**不需要**像历史记录那样用确定性哈希（原因见下） |
| translations 合并 | 按引擎分别合并 map（`{ ...remote, ...local }`），不是整体覆盖 |
| known 状态合并 | `local.known || remote.known`，一旦任一端标记已掌握，合并后保持已掌握 |
| 同步内容开关 | 总开关 `githubSyncEnabled` 不变语义（历史记录始终跟着走）；新增 `githubSyncWordbook`（默认开）单独控制单词本 |
| 删除/清空的已知限制 | 沿用翻译历史的 v1 决定：合并去重策略下，删除的单词可能被下次同步从其他设备恢复，加文案提示，不做 tombstone |
| 同步触发/调度 | 复用同一套防抖闹钟（`history-sync-debounce`），历史和单词本的变更都触发同一次同步周期，不新增闹钟 |

### 为什么 id 回填不需要确定性哈希（跟历史记录的关键区别）

历史记录同步在实现过程中踩过一个坑：合并去重是**按 `id`** 判断的，如果旧记录（上线前保存、没有 `id`）在两次独立读取里各自用 `crypto.randomUUID()` 回填，会产生两个不同的 id，被 `mergeHistories` 误判成两条不同记录，造成永久重复（最终改成基于内容的确定性哈希才根治）。

单词本的合并去重是**按 `text.toLowerCase()`**，`id` 只是附带的稳定标识、完全不参与去重判断。哪怕两次独立回填给同一个单词生成了两个不同的随机 UUID，`mergeWordbook` 依然会按 text 把它们合并成一条（`id` 字段取本地那个）。这个类别的 bug 在这里不成立，所以可以放心用更简单的随机 UUID，不需要重复历史记录那套确定性哈希的复杂度。

## 架构

### 1. 数据模型

```js
// wordbook 条目（新增 id 字段，其余字段结构不变）
{
  id: string,              // crypto.randomUUID()，新条目创建时生成，旧条目首次同步时回填
  text: string,
  translations: { [engine]: string },
  known: boolean,
  timestamp: number,
}
```

写入点不变（`content/selection.js` 的划词保存单词、`sandbox/sandbox.js` 的快捷翻译保存单词），只在构造新条目对象时加一行 `id: crypto.randomUUID()`。

### 2. `utils/github-sync.js` 改造：底层读写通用化

把原本写死给 `translationHistory` 用的 Gist/仓库读写，抽成按文件名参数化：

- `pullRemoteFile(filename)` —— Gist 分支走 `GET /gists/{id}`（一次请求拿到所有文件，取 `files[filename]`）；仓库分支走 `GET /repos/.../contents/{filename}`（每个文件独立一次请求）
- `pushRemoteFile(filename, content)` —— Gist 分支 PATCH 时只带这一个文件（不影响 Gist 里的其他文件）；仓库分支走对应 `contents/{filename}` 的 PUT，sha 获取/409 重试逻辑保持不变（对每个文件独立处理）

`pullRemoteHistory`/`pushRemoteHistory`（历史记录专用）改为基于这两个通用函数实现，文件名固定 `translation-history.json`，行为不变。

新增 `pullRemoteWordbook`/`pushRemoteWordbook`，文件名固定 `wordbook.json`，同样基于通用函数实现。

### 3. 单词本同步逻辑：`mergeWordbook` + `syncWordbookNow`

结构照抄 `mergeHistories`/`syncNow` 的既有模式（两次读取本地数据防止网络等待期间的新写入被覆盖、in-flight guard 复用同一个模块级标记，不新增第二把锁）：

```js
export function mergeWordbook(local, remote) {
  const byText = new Map();
  // remote 在前、local 在后：同一个 key 第二次出现时（一定是 local，或者
  // local 内部的重复项）该次的字段优先，从而实现"本地优先"。
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
    });
  });
  return Array.from(byText.values()).sort((a, b) => b.timestamp - a.timestamp);
}
```

（`prior` 是同一个 key 里先出现的那条，`entry` 是后出现的那条；`translations`/`id` 取值都以后出现的 `entry` 为准，因为 `local` 数组排在 `remote` 之后，所以后出现的必然是本地这一份——这就是"本地同引擎覆盖远端、id 优先取本地"这条约定的实现方式。`known`/`timestamp` 用 `prior`/`entry` 哪个都一样，因为 `||` 和 `Math.min` 本身就是顺序无关的。）

`syncWordbookNow()`：读本地 `wordbook` → 缺 `id` 的条目回填随机 UUID → 拉远端 `wordbook.json` → `mergeWordbook` → （不裁剪，单词本没有类似 `historyMaxItems` 的上限设置，全量保留）→ 写回本地 → 推送到远端。

### 4. 调度整合

`background/background.js`：

- 单词本保存后广播新消息 `wordbookChanged`（跟现有 `historyChanged`平级、结构一致）
- `onMessage` 里 `historyChanged`/`wordbookChanged` 两个分支都创建同一个 `history-sync-debounce` 闹钟（同一个名字，天然去重，触发的是"该同步了"这一件事，不是分数据类型各起一个闹钟）
- `chrome.alarms.onAlarm` 触发时，统一调用的 `syncNow()` 内部依次执行：
  1. `syncHistoryNow()`（原有逻辑）
  2. 若 `githubSyncWordbook` 为真，执行 `syncWordbookNow()`
- 手动「立即同步」按钮发出的 `triggerHistorySync` 消息不改名（避免破坏现有 UI 绑定），内部含义扩展为"立即同步全部已启用的内容"

### 5. 设置与 UI

`utils/defaults.js` 新增：
```js
githubSyncWordbook: true, // 单词本是否跟着同步，默认开；受总开关 githubSyncEnabled 约束
```

`options/options.html` 的「GitHub 跨设备同步」卡片，在启用开关下面加一行「同步单词本」复选框，跟随总开关一起显隐（复用现有 `updateGithubSyncUI` 的显隐逻辑，多控制这一个元素）。

`wordbook/index.html`（单词本页面），在合适位置加一句文案：「开启 GitHub 同步后，删除的单词可能会在下次同步时从其他设备恢复」（跟历史页已有的同类提示一致的风格和位置逻辑）。

### 6. 错误处理

复用同一份 `githubSyncStatus`（`{ lastSyncAt, lastError }`），历史或单词本任一环节失败都写入这份公共状态，设置页统一展示"上次同步成功/失败"，不做分数据类型的状态 UI。

## 单元边界

- **`utils/github-sync.js` 的通用读写层**（`pullRemoteFile`/`pushRemoteFile`）：只负责"按文件名读写远端一个文件"，不知道内容是历史还是单词本
- **历史同步逻辑**（`mergeHistories`/`syncHistoryNow`，沿用现有代码结构做重命名/收敛）与**单词本同步逻辑**（`mergeWordbook`/`syncWordbookNow`，新增）：各自独立的合并策略，互不感知对方的数据结构
- **`background/background.js` 的调度层**：只负责"什么时候该同步"，不关心同步的是历史还是单词本，也不关心合并细节
- **`options/options.js` 的同步设置 UI**：只多读写一个 `githubSyncWordbook` 布尔值，不直接碰同步逻辑

## 不在范围内

- 单词本条目的其他字段（如果未来加了新字段）的合并策略，本设计只覆盖当前已有的 `text`/`translations`/`known`/`timestamp`
- 删除同步（tombstone），沿用历史记录已经做过的 v1 决定：接受"删除可能被同步恢复"这个限制
- OAuth Device Flow（P1，历史记录设计里已经标注为独立后续项，本次不涉及）

## 验收标准

1. `npm run build` 成功
2. 新保存的单词条目带 `id` 字段
3. 关闭「同步单词本」时，单词本变更不触发任何网络请求，历史记录同步不受影响
4. 开启同步后：两台设备各自新增不同单词，同步后互相能看到对方新增的单词
5. 两台设备给同一个单词分别用了不同引擎翻译，同步后 `translations` 是两边的合并（不是互相覆盖）
6. 一台设备把某个单词标记为「已掌握」，同步后另一台设备也变成已掌握（且不会被没标记的一端合并掉）
7. Gist 场景下，一次同步周期只拉一次 Gist（能在网络面板里确认历史和单词本共用同一次 `GET /gists/{id}` 请求），不是两次独立请求
8. token 失效等错误时，`githubSyncStatus` 能正确反映失败原因，不区分是历史还是单词本导致的

## 风险

- `mergeWordbook` 的 `translations` map 合并是"本地覆盖远端同引擎的翻译"，如果两端对同一个单词同一个引擎有不同翻译内容（理论上少见，同一引擎对同一单词翻译结果应该一致，除非引擎本身不确定性输出或用户手动改过），会丢失非本地那一份，可接受
- Gist 单文件更新（PATCH 只带一个文件）理论上不会影响另一个文件，但如果远端 Gist 被外部工具用不支持"部分文件更新"语义的方式操作过，可能有极端情况下的数据覆盖风险，超出本设计控制范围
