# 设计：单词本 FSRS 间隔重复复习系统

日期：2026-08-21
状态：已批准设计，待写实现计划

## 背景与目标

单词本（`wordbook/`）现有四个视图：单词列表、卡片学习（自由翻转浏览）、拼写测验（全部单词等权重随机抽题）、学习统计（纯计数）。核心问题：`known: boolean` 是一次性标记，一旦标为"已掌握"就再也不会被抽到复习，是间隔重复领域里经典的"虚假掌握感"陷阱。

市场调研（2026）确认：主流间隔重复算法已从 SM-2 全面转向 **FSRS**（同等记忆效果下比 SM-2 少 20-30% 复习次数），核心思路是根据每次答题的历史动态算出"这张卡下次该什么时候复习"，而不是人工一次性打标。本插件单词本的定位（用户从阅读/翻译中主动收集词汇）正好对应市场里"Anki 式个人词汇构建者"这个赛道，游戏化机制不是重点，复习调度算法才是。

目标：引入 FSRS 驱动的复习调度，同时新增例句上下文捕获、发音、popup 待复习提醒这几项市场验证过的便捷功能，并保证新增字段能被已经上线的 GitHub 同步（`mergeWordbook`）正确合并。

## 关键决策

| 决策点 | 结论 |
|--------|------|
| 调度算法 | 完整 FSRS，通过开源库 `ts-fsrs`（MIT，零依赖）实现，不手写公式 |
| 测验方向 | recall（看翻译拼单词）+ recognition（看单词选翻译）两个方向，各自独立一套 FSRS 状态 |
| 数据模型扩展性 | `srs` 是开放的"模式名 → FSRSCard"字典，非固定两字段；新增模式（如听力）只加 key，不改结构 |
| 例句上下文 | `contexts` 数组而非单字符串，每次收藏都追加一条，不覆盖；只在 `content/selection.js`（有页面上下文）捕获，`sandbox/sandbox.js` 不捕获 |
| 评分交互 | recall 答对后自报三档（困难/记得/简单），答错自动记"重来"；recognition 从选对/选错+停留时长自动推导四档 |
| 页面结构 | 新增「今日复习」统一视图（FSRS 驱动，到期词排队作答）；旧的"卡片学习""拼写测验"保留为自由浏览/练习模式，完全不接入 FSRS 调度 |
| 发音 | 复用现有 `utils/tts.js` 的 `window.ttsManager`，不新写 TTS 逻辑 |
| popup 提醒 | popup 顶部加待复习数量徽章，点击跳转单词本「今日复习」；数量现算，不存缓存字段 |
| GitHub 同步合并 | 建立通用字段类型合并约定（见下），`srs`/`contexts` 按各自类型规则合并，不再需要每个新字段单独设计合并逻辑 |
| 旧数据迁移 | 不写迁移脚本；`srs` 缺失按未初始化处理，用户在「今日复习」第一次答到该词时惰性创建 FSRS 卡；旧的 `known` 字段不再读写，但保留在旧数据里不做清理（无害） |
| 并发写入保护 | `wordbook/wordbook.js` 新增 `chrome.storage.onChanged` 监听，避免复习过程中后台自动同步把内存快照覆盖掉 |

## 架构

### 1. 数据模型

```js
// wordbook 条目（在现有 { id, text, translations, timestamp, url, title } 基础上新增）
{
  contexts: [
    { sentence: string, url: string, title: string, timestamp: number },
    // 每次收藏都追加一条；sandbox 收藏时该数组为空
  ],
  srs: {
    // key 是模式名，value 是 ts-fsrs 的 Card 类型原样存储（不额外包装字段名）
    recall: FSRSCard | undefined,       // 首次学习前该 key 不存在
    recognition: FSRSCard | undefined,
    // 未来新增模式（如 listening）直接加新 key
  }
}
```

`FSRSCard` 字段（来自 `ts-fsrs`）：`due`、`stability`、`difficulty`、`elapsed_days`、`scheduled_days`、`reps`、`lapses`、`state`（New/Learning/Review/Relearning）、`last_review`。`due`/`last_review` 是 Date 对象，写入 `chrome.storage.local` 前需要序列化成 ISO 字符串，读出来后反序列化。

### 2. `utils/srs.js`（新文件）—— FSRS 的唯一入口

封装 `ts-fsrs`，其他文件不直接 import `ts-fsrs`：

```js
export function createCard()                        // 包装 ts-fsrs 的 createEmptyCard()
export function scheduleNext(card, grade, now)       // 包装 fsrs.next()，grade: 'again'|'hard'|'good'|'easy'
export function isDue(card, now)                     // card.due <= now
export function serializeCard(card)                  // Date → ISO string，供写入 storage
export function deserializeCard(raw)                 // ISO string → Date，供读出后使用
```

### 3. `wordbook/wordbook.js` 改造

- 新增「今日复习」视图逻辑：
  - 启动时遍历 `wordbook`，收集每个词每个方向里 `due <= now` 或 `srs[mode]` 不存在（New）的 `(word, mode)` 组合，构成复习队列，随机顺序
  - 出题：`mode === 'recall'` 复用现有拼写测验交互；`mode === 'recognition'` 新增单词识别题（展示单词 + 发音按钮 + 4 选项，正确项 1 个 + 从其他词随机抽 3 个干扰项）
  - 答题后调用 `scheduleNext()` 更新对应 `srs[mode]`，`saveWordbook()`
  - 队列展示该词 `contexts` 最后一条的 `sentence`（如果有）
  - 队列清空后提供"学新词"按钮，把还没有 `srs.recall`/`srs.recognition` 的词转入队列
- 列表视图的"已掌握/学习中"徽章改为从 `srs.recall`（没有则视为未学习）派生，不再读/写 `known`
- 新增 `chrome.storage.onChanged` 监听（`area === 'local' && changes.wordbook`）：检测到不是本页面自己触发的写入时，重新从 storage 读取 `wordbook` 并重渲染当前视图
- `import '../utils/tts.js'`，复习题里的发音按钮调用 `window.ttsManager.speak(word.text, lang)`

### 4. `content/selection.js` 例句捕获

保存单词的地方（约第 220 行 `word` 对象构造处），在 `window.getSelection()` 仍然有效时：
1. 取 `sel.getRangeAt(0)` 的公共祖先节点，向上找最近的块级元素（`P`/`DIV`/`LI` 等）
2. 取该元素 `textContent`，按 `[。！？.!?]` 分句
3. 找到包含选中文字偏移量的那一句，截断到合理长度（如 200 字）
4. 连同 `url`/`title`/`timestamp` 一起 push 进 `contexts` 数组

`sandbox/sandbox.js` 的保存路径不做这个捕获（没有页面 DOM 上下文），`contexts` 留空数组。

### 5. `utils/github-sync.js` 的 `mergeWordbook` 改造 —— 通用字段类型合并约定

不再为每个新字段单独设计合并规则，而是按字段的**结构类型**分三类处理：

- **标量字段**（`id`/`text`/`timestamp`/`url`/`title`）：本地优先（现有规则不变）
- **字典型字段**（`translations`、`srs`）：按 key 遍历合并，每个 key 内部再按值类型判断——`translations` 的值是字符串，本地覆盖远端同 key；`srs` 的值是 FSRSCard，同一个模式 key 取 `last_review` 较新的那一整张卡（不拆开卡内部字段合并，因为 FSRS 的 difficulty/stability 等字段彼此关联）。**某个 key 只在一边存在时**（比如某个词只在设备 A 上做过 recall、设备 B 从没练过这个方向），直接取存在的那一边，不算冲突
- **数组型字段**（`contexts`）：并集 + 去重（按 `sentence + url` 判重），两边独立收集的例句都保留，不做"新覆盖旧"

`known` 字段：合并逻辑里不再读取/写入，如果旧数据里还有就原样透传（不主动清理，避免破坏未升级设备的向后兼容）。

### 6. popup 待复习提醒

`popup/popup.js` 启动时 `chrome.storage.local.get('wordbook')`，本地遍历算一次到期数（不存缓存计数）。`popup/popup.html` 顶部导航区加一个徽章按钮，到期数为 0 时整个按钮隐藏（不显示"0"这种无意义状态），大于 0 时显示数字，点击 `chrome.tabs.create({ url: 'wordbook/index.html?view=review' })`；`wordbook.js` 启动时读这个查询参数，如果是 `review` 直接切到「今日复习」视图。

## 单元边界

- **`utils/srs.js`**：FSRS 算法的唯一入口，不知道 wordbook 的数据结构长什么样，只认 `Card` 类型
- **`wordbook/wordbook.js`**：复习会话编排 + UI 渲染，不直接碰 `ts-fsrs`，只调 `utils/srs.js` 暴露的函数
- **`content/selection.js` 的例句捕获**：纯粹"从当前 DOM 选区提取一句话"，不知道这句话以后会被怎么用
- **`utils/github-sync.js` 的合并逻辑**：只认字段的结构类型（标量/字典/数组），不需要为具体业务字段名写特例

## 不在范围内

- FSRS 参数个性化优化（需要用户几千次复习历史才有意义，本次用库自带的默认权重）
- 监听/朗读模式等除 recall/recognition 外的新测验模式（数据结构已支持后续扩展，本次不实现）
- 单词本以外的间隔重复（比如整句收藏、语法点收藏）
- 离线 TTS 音标显示

## 验收标准

1. `npm run build` 成功，新增 `ts-fsrs` 依赖正确打包
2. 新收藏的单词首次进入「今日复习」时能正确初始化 FSRS 卡（`state: New`）
3. recall 方向答对选"简单"后，下次 `due` 明显晚于答"困难"的情况（间隔随评分拉开）
4. recognition 方向的干扰项不会跟正确答案重复
5. 关闭「今日复习」页面后台开着，等自动同步周期触发一次，回到页面数据不丢（`chrome.storage.onChanged` 生效）
6. 两台设备各自复习同一个词的不同方向（一台做了 recall、一台做了 recognition）后同步，合并结果两个方向的调度状态都保留，不是其中一个覆盖另一个
7. 两台设备各自给同一个词收藏了不同的例句上下文，同步后 `contexts` 里两条都在，不是二选一
8. popup 待复习数字准确反映到期词数量，点击能正确跳转并打开「今日复习」

## 风险

- `ts-fsrs` 库本身的正确性依赖社区维护质量，属于外部依赖，需要在实现时钉死版本号（避免未来 major 版本行为变化影响已有用户的调度状态）
- 例句提取（第 4 节）是启发式的（找最近块级祖先 + 简单分句），遇到复杂页面结构（表格、代码块等）可能提取出不理想的句子，属于可接受的降级，不影响核心复习功能
- `srs` 字典合并policy（同一模式取 `last_review` 较新整卡）意味着较旧那台设备这次复习的调度效果会被丢弃——这是设计上接受的取舍（复杂度 vs 精度），跟历史记录/单词本合并策略里"合并去重不做覆盖式同步"的整体哲学是一致的妥协
