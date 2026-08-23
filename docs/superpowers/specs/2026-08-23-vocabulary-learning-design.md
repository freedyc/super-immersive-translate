# 设计：单词学习闭环（学新词 → 练习 → 间隔复习 → 错词强化）

日期：2026-08-23
状态：待用户确认后分阶段实现

## 背景

现有单词本已经有 FSRS 调度和两种题型（拼写 recall / 识别 recognition），但缺少完整的学习闭环：
没有「今日任务」的概念，没有学新词流程，题型只有两种，没有错词强化，统计只有四个计数。

本设计把它补成完整闭环，但**不重建项目**——沿用现有的 React 19 + TypeScript + Tailwind 4 +
daisyUI 5 + Vite + `@crxjs/vite-plugin` + ts-fsrs 技术栈。

## 已确认的关键决策

| 决策点 | 结论 | 理由 |
|--------|------|------|
| 产品主线 | **语境驱动为主，词书后置** | 每个词都带 `contexts[]`（遇到它的真实原文）+ 来源页面，这是相对 Anki/百词斩的真正差异点。词书放第二阶段 |
| 词典数据 | **MVP 用现有 AI 生成起步**，数据层按可接 ECDICT 设计 | 先跑通闭环不被内容卡住；接入放第二阶段但现在就不留返工 |
| UI 库 | **保持 daisyUI，不引入 shadcn/ui** | 已有 daisyUI + 局部 MUI 两套，第三套必然视觉不一致 |
| 本地存储 | **保持 `chrome.storage.local`，不用 localStorage** | localStorage 在扩展页面不跨页面共享、清理站点数据会丢；且 GitHub 跨设备同步已建在 chrome.storage 上。数据访问层照样抽象成仓储接口 |

### 关于 ECDICT（第二阶段的数据来源）

[skywind3000/ECDICT](https://github.com/skywind3000/ECDICT)（MIT）覆盖了 `phonetic`、中英释义、
词性、Collins 星级/Oxford 3000（难度）、BNC/COCA 词频、词形变化，**且 tag 字段自带
CET4/CET6/考研/托福/雅思/GRE 分类——词书可以直接从中派生，不需要另找词表**。

它没有的：例句（现有产品的 AI 生成 + 真实语境更好）、同义反义（需 WordNet）、
英美双音标分离、音频文件、词根词缀、记忆技巧。

两个注意事项：
- **体积**：全量 76 万词过大。裁剪成"带考试标签的词"约 2–3 万条即可。`manifest.json` 已有
  `unlimitedStorage` 权限，放 IndexedDB 没有配额问题。
- **许可**：仓库标 MIT，但数据本身聚合自多个来源。免费分发风险不大，**商业化前需核实来源许可链**。

## 需求分析中发现的问题（已在本设计中修正）

1. **`learningStatus` 不能是存储的权威态**。`mastered`/`reviewing`/`difficult` 全部可从 FSRS 卡片派生，
   存两份必然不一致。本项目已经踩过这个坑：旧的 `known: boolean` 就是被 FSRS 派生的掌握度取代的，
   至今还留在数据里当兼容包袱。**只有 `suspended` 是真正需要存储的用户意图。**
2. **「今日复习数量」的口径**。现有实现每个词按题型各有一张 FSRS 卡，4 种题型意味着一个词最多 4 张卡，
   「待复习 40」可能只是 10 个单词。**对用户展示单词数，内部调度按卡。**
3. **`mastered` 不作为独立状态**。既然"已掌握仍需低频抽查"，它与 `reviewing` 的差别只是间隔长短。
   做成 UI 标签（stability ≥ 阈值），不进状态机。
4. **页面数从 16 收敛到 9**。扩展里的单词本是次级入口，用户不会像独立 App 那样长时间停留。
   合并：词书列表+详情合一、单词搜索并入列表页（已有搜索框）、单词详情做成抽屉而非独立页、
   错词本做成列表页的筛选态而非独立页。
5. **英美双音的降级**。浏览器 TTS 的英音/美音取决于用户系统装了哪些语音包，不保证存在。
   需要在无对应语音包时明确降级（本会话修过一个相关 bug：`getVoices()` 异步导致首次发音音色不对）。
6. **口语跟读不做**。浏览器只能做到"录了音"，给不出有意义的发音评分，做出来是伪功能。

## 信息架构

```
单词本（wordbook/）
├─ 今日学习          ← 唯一首页，唯一主按钮「开始今日学习」
│   ├─ 学新词流程     （沉浸式：隐藏侧边导航，只留进度 + 退出）
│   └─ 复习流程       （沉浸式）
├─ 我的词库
│   ├─ 列表 + 搜索 + 筛选（错词本 = 筛选态）
│   └─ 单词详情（抽屉，非独立页；核心释义优先，其余折叠）
├─ 统计
└─ 设置
（词书：第二阶段才出现）
```

## 核心用户流程

| 步骤 | 用户看到 | 操作 | 系统反馈 |
|------|---------|------|---------|
| 打开 | 今日新学 N、待复习 M、预计 X 分钟、连续 D 天、词库进度 | 「开始今日学习」 | 进入沉浸式流程 |
| 学新词 | 单词 + 音标 + 发音，**释义默认隐藏** | 先回忆 → 「查看释义」 | 展开释义 + 例句 |
| 评估 | 四档熟悉度 | 不认识/有点印象/认识/已掌握 | 写入 FSRS，下一词 |
| 练习 | 题目（四种题型轮转） | 作答 | **即时**反馈：对错 + 你的答案 + 正确答案 + 发音 + 简短解析 |
| 复习 | 到期的词 | 同上 | 答错→缩短间隔；连对→拉长间隔 |
| 结束 | 本次数量、正确率、下次复习时间 | 「完成」 | 回首页，进度已更新 |
| 中途退出 | — | 关闭/切页 | **自动保存**，首页显示「继续学习」 |

**错误反馈用温和态**：不用 `error` 红色警告，用中性/琥珀色 + 「再看一眼」这类文案。

## 分期

### MVP（现有代码约 60% 可复用）
- 今日学习首页（唯一主按钮 + 继续学习）
- 学新词流程（释义先隐藏 → 四档熟悉度）
- 四种题型：英→中选择、中→英选择、听音选词、看释义拼写
- 即时答题反馈 + 温和错误态
- 复习流程（复用现有 FSRS）
- 我的词库（列表+搜索+筛选，错词本作为筛选态）
- 单词详情抽屉（渐进展开）
- 统计页
- 设置：每日新词上限、每日复习上限、题型开关
- 完整的空/加载/错误态
- **数据迁移**：旧 `WordEntry` → 新模型，`contexts[]` 直接成为 `examples`（这是现有资产，不能丢）

### 第二阶段
- 接入 ECDICT（裁剪版 + IndexedDB + 查询层）
- 词书（从 ECDICT 的 tag 字段派生）
- 例句填空、单词释义配对
- 英美双音（含无语音包降级）
- 键盘快捷键 + 移动端手势
- 首次引导（可跳过）

### 第三阶段
- 字母重组、相似词辨析
- 同义反义（WordNet）、词根词缀、记忆技巧
- 学习趋势图表、听力/拼写/词义分项表现

### 暂不实现
- **口语跟读**（无法给出有意义的发音评分，伪功能）
- **看图选词**（需图片资产，且抽象词无法配图）
- **过度游戏化**（成就/徽章/排行，与视觉风格要求冲突）

## 数据模型

**核心决策：词典数据与学习记录分表。**

```ts
/** 词典数据：只读，来源可以是 AI 生成 / ECDICT / 未来的服务端 */
interface Word {
  id: string;
  word: string;
  phoneticUK?: string;
  phoneticUS?: string;
  audioUK?: string;
  audioUS?: string;
  /** 一个单词支持多词性、每个词性多释义 */
  meanings: Meaning[];
  examples: Example[];
  phrases?: string[];
  synonyms?: string[];
  antonyms?: string[];
  wordForms?: Record<string, string>;
  roots?: string;
  memoryTip?: string;
  difficulty?: number;
  frequency?: number;
  tags?: string[];          // cet4 / cet6 / ky / toefl / ielts / gre
  image?: string;
  source: 'ai' | 'ecdict' | 'user';
}

interface Meaning {
  partOfSpeech: string;
  definitions: string[];    // 不是单个 string——一个词性可以有多条释义
}

interface Example {
  sentence: string;
  translation?: string;
  tokens?: Token[];         // 词性/语法角色标注（现有能力）
  sourceUrl?: string;       // 来自阅读语境的例句才有
  sourceTitle?: string;
  origin: 'context' | 'ai';
}

/** 学习记录：与 Word 分离，换词典源不影响它 */
interface LearningRecord {
  wordId: string;
  firstStudiedAt?: number;
  lastStudiedAt?: number;
  studyCount: number;
  correctCount: number;
  wrongCount: number;
  streak: number;
  /** 每种题型各自的 FSRS 卡片与统计 */
  byExercise: Partial<Record<ExerciseType, ExerciseRecord>>;
  favorite?: boolean;
  note?: string;
  /** 唯一需要存储的状态：用户主动暂停 */
  suspended?: boolean;
}

type ExerciseType =
  | 'en2zh'      // 看英文选中文
  | 'zh2en'      // 看中文选英文
  | 'listening'  // 听发音选单词
  | 'spelling';  // 看释义拼写

interface ExerciseRecord {
  card: SerializedCard;   // FSRS 卡片
  correct: number;
  wrong: number;
}

/** 展示态：派生，不存储 */
type LearningStatus = 'new' | 'learning' | 'reviewing' | 'difficult' | 'mastered' | 'suspended';
```

## FSRS 服务接口

封装成独立服务，**UI 组件不直接依赖 ts-fsrs**：

```ts
interface SrsService {
  scheduleReview(record: ExerciseRecord | undefined, grade: Grade, now?: Date): ExerciseRecord;
  getDue(records: LearningRecord[], now?: Date): DueItem[];
  buildTodayQueue(config: StudyConfig, records: LearningRecord[], now?: Date): StudyQueue;
  deriveStatus(record: LearningRecord | undefined): LearningStatus;
  estimateMinutes(queue: StudyQueue): number;
}
```

对用户只暴露「今天复习 / 明天复习 / 需要加强 / 已掌握」，
不暴露 Stability / Difficulty / Retrievability，但内部模型保留这些字段。

## 路由 / 状态 / 存储 / 数据访问层

- **路由**：沿用现有的 URL 查询参数方案（`?view=`），不引入 react-router——扩展页面层级浅，
  引路由库不划算。学习流程用内部状态机，不占路由。
- **状态**：会话状态（当前队列、进度）放 `StudySessionProvider`；持久数据继续走
  `useWordbook` 那套 `chrome.storage.onChanged` 模式（**必须保留**：后台 GitHub 同步会在页面打开时
  写入，不监听就会被内存旧快照覆盖）。
- **数据访问层**：
  ```ts
  interface WordSource {                     // 词典数据，可换实现
    lookup(word: string): Promise<Word | null>;
    search(query: string, limit: number): Promise<Word[]>;
  }
  interface LearningRepository {             // 学习记录
    getAll(): Promise<LearningRecord[]>;
    get(wordId: string): Promise<LearningRecord | null>;
    save(record: LearningRecord): Promise<void>;
    saveMany(records: LearningRecord[]): Promise<void>;
  }
  ```
  MVP 实现：`AiWordSource`（现有 example-sentence 能力）+ `ChromeStorageLearningRepository`。
  第二阶段加 `EcdictWordSource`（IndexedDB），不动其余代码。

## 设计令牌

复用 daisyUI 5 的语义色（`--color-primary` / `success` / `warning` / `error` / `base-*`），
**不另起一套颜色**。需要新增的只有：

- 答题反馈：正确 = `success`，错误 = **`warning` 而非 `error`**（温和原则）
- 动效时长：卡片翻转 600ms（现有）、反馈出现 150ms、页面切换 200ms
- 内容最大宽度：学习流程 `max-w-lg`，列表 `max-w-5xl`（避免超宽屏铺满）
- 移动端底部操作区：`pb-[env(safe-area-inset-bottom)]`

## 验收标准

1. `npm run typecheck` 与 `npm run build` 均通过
2. 从零单词状态到完成一轮学习，全程无死路（每个空态都有明确下一步）
3. 学习中途关闭页面，重开后能「继续学习」且进度不丢
4. 旧数据（`WordEntry` 含 `contexts`/`srs`）迁移后例句和复习进度不丢失
5. 键盘可完成整个学习流程；发音按钮有播放中/失败状态
6. 浅色/深色模式下语义色一致

## 风险

- **迁移风险最高**：旧 `WordEntry` 的 `srs: {recall, recognition}` 要映射到新的四种题型。
  `recall`→`spelling`、`recognition`→`en2zh` 是自然映射，另两种题型从零开始。迁移必须幂等且可回滚。
- **题型可用性**：无译文的词出不了选择题、无音频/TTS 不可用时出不了听力题。
  队列构建时必须跳过不可用题型，而不是渲染出一道无法作答的题（本会话修过同类问题）。
- **真实交互未经验证**：浏览器自动化工具在本项目一直连不上，所有 UI 验证依赖手动加载 `dist/`。
