/**
 * 纯逻辑行为验证。
 *
 * 运行：npm run verify
 *
 * 为什么存在：本项目没有测试框架（见 CLAUDE.md），而数据迁移和跨设备合并是
 * 出错代价最高、又最难靠肉眼复查的两块——迁移丢数据、合并静默吞字段，
 * 用户往往过很久才发现，且发现时数据已经没了。typecheck 只能保证类型对，
 * 保证不了逻辑对，所以这两处需要真的跑一遍。
 *
 * 为什么不引测试框架：这里只需要"跑一遍纯函数、断言结果"，Node 24 能直接
 * 执行 TypeScript（原生剥离类型），零依赖零配置。等将来真的需要 mock、快照、
 * 覆盖率的时候再引框架不迟。
 *
 * 只测纯函数：碰 chrome.* API 的代码不在这里测，那需要浏览器环境。
 */
import { convertEntry, migrateWordbook } from '../utils/learning/migrate.ts';
import { mergeWords, mergeLearningRecords } from '../utils/learning/syncMerge.ts';
import {
  createRecord, recordAnswer, deriveStatus, describeNextReview,
} from '../utils/learning/srsService.ts';
import { buildTodayQueue, canRender, estimateMinutes, DEFAULT_STUDY_CONFIG } from '../utils/learning/queue.ts';
import { isResumable } from '../utils/learning/session.ts';
import { formatPhonetic, pickExample, pickPhonetic, pickPos } from '../utils/learning/wordMeta.ts';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(detail ? `${name} —— ${detail}` : name);
  }
}

function section(title) {
  console.log(`\n\x1b[36m${title}\x1b[0m`);
}

const card = (over = {}) => ({
  due: '2099-01-01T00:00:00.000Z',
  last_review: '2026-08-01T00:00:00.000Z',
  stability: 5,
  difficulty: 3,
  reps: 1,
  state: 2,
  ...over,
});

const word = (over = {}) => ({
  id: 'w1',
  word: 'ubiquitous',
  meanings: [{ partOfSpeech: '形容词', definitions: ['普遍存在的'] }],
  examples: [],
  source: 'ai',
  addedAt: 1000,
  ...over,
});

// ────────────────────────────────────────────────────────────────────────────
section('迁移：语境例句是产品核心资产，一条都不能丢');

{
  const { word: w } = convertEntry({
    id: 'w1',
    text: 'ubiquitous',
    translations: { google: '普遍存在的', deepl: '普遍存在的' },
    timestamp: 1000,
    url: 'https://a.com',
    title: '某页面',
    ipa: '/juːˈbɪkwɪtəs/',
    contexts: [
      { sentence: 'It is ubiquitous.', url: 'https://a.com', title: '某页面', timestamp: 900 },
      { sentence: 'AI made this.', translation: '生成的', url: null, timestamp: 950, source: 'ai' },
    ],
  });
  check('两条例句都保留', w.examples.length === 2);
  check('真实语境标 context', w.examples[0].origin === 'context');
  check('来源页地址保留', w.examples[0].sourceUrl === 'https://a.com');
  check('AI 例句标 ai', w.examples[1].origin === 'ai');
  check('收藏时间保留', w.addedAt === 1000);
  check('收藏来源页保留', w.sourceUrl === 'https://a.com');
  check('未标英美的音标进 phonetic 而非猜成 phoneticUS',
    w.phonetic === '/juːˈbɪkwɪtəs/' && w.phoneticUS === undefined);
  check('多引擎相同译文已去重', w.meanings[0].definitions.length === 1);
}

section('迁移：复习进度映射');

{
  const { record } = convertEntry({
    id: 'w2',
    text: 'synergy',
    translations: { google: '协同' },
    timestamp: 1,
    srs: { recall: card({ reps: 4 }), recognition: card({ reps: 2 }) },
  });
  check('recall → spelling', !!record.byExercise.spelling);
  check('recognition → en2zh', !!record.byExercise.en2zh);
  check('没学过的题型不凭空造', record.byExercise.listening === undefined);
  check('studyCount 由 reps 汇总', record.studyCount === 6);
}

{
  const { record } = convertEntry({ id: 'w3', text: 'new', translations: {}, timestamp: 1 });
  check('从没学过的词不产生学习记录', record === null);
}

section('迁移：幂等 —— 重跑不能把用户新进度打回去');

{
  const entries = [{
    id: 'w4', text: 'test', translations: { g: 'x' }, timestamp: 1,
    srs: { recall: card({ reps: 1 }) },
  }];
  const userProgress = {
    wordId: 'w4', studyCount: 99, correctCount: 50, wrongCount: 1, streak: 7,
    byExercise: { spelling: { card: card({ reps: 99 }), correct: 50, wrong: 1 } },
  };
  const again = migrateWordbook(entries, [userProgress]);
  check('保留用户新进度而非旧数据', again.records[0].studyCount === 99);
  check('不重复计入迁移数', again.migratedWithProgress === 0);
}

{
  const dirty = migrateWordbook([
    null,
    { text: '' },
    { id: 'ok', text: 'fine', translations: {}, timestamp: 1 },
  ]);
  check('脏数据被跳过而不是让迁移崩掉', dirty.words.length === 1 && dirty.words[0].word === 'fine');
}

// ────────────────────────────────────────────────────────────────────────────
section('同步合并：词典数据');

{
  const local = [word({
    examples: [{ sentence: 'Local one.', sourceUrl: 'https://a.com', origin: 'context', timestamp: 1 }],
    addedAt: 2000,
  })];
  const remote = [word({
    id: 'remote-id',
    examples: [{ sentence: 'Remote one.', sourceUrl: 'https://b.com', origin: 'context', timestamp: 2 }],
    addedAt: 1000,
    tags: ['cet4'],
  })];
  const merged = mergeWords(local, remote);

  check('同一个词合并成一条', merged.length === 1);
  check('两端例句取并集，都不丢', merged[0].examples.length === 2);
  check('addedAt 取更早的（第一次遇见才有意义）', merged[0].addedAt === 1000);
  check('id 取远端优先（避免两台设备互推时 id 反复跳变）', merged[0].id === 'remote-id');
  check('远端独有的 tags 保留', merged[0].tags?.includes('cet4'));
}

{
  // 同一句话来自不同页面，是两条独立语境，不该被判成重复
  const a = [word({ examples: [{ sentence: 'Same text.', sourceUrl: 'https://a.com', origin: 'context', timestamp: 1 }] })];
  const b = [word({ examples: [{ sentence: 'Same text.', sourceUrl: 'https://b.com', origin: 'context', timestamp: 2 }] })];
  check('同句不同来源页视为两条', mergeWords(a, b)[0].examples.length === 2);

  const c = [word({ examples: [{ sentence: 'Same text.', sourceUrl: 'https://a.com', origin: 'context', timestamp: 1 }] })];
  check('同句同来源页才算重复', mergeWords(a, c)[0].examples.length === 1);
}

{
  const merged = mergeWords(
    [word({ meanings: [{ partOfSpeech: '形容词', definitions: ['普遍存在的'] }] })],
    [word({ meanings: [{ partOfSpeech: '形容词', definitions: ['无所不在的'] }] })],
  );
  check('同词性下的释义取并集', merged[0].meanings[0].definitions.length === 2);
}

{
  const merged = mergeWords([word({ source: 'ai' })], [word({ source: 'ecdict' })]);
  check('词典来源取更权威的一方（ecdict 优于 ai）', merged[0].source === 'ecdict');
}

section('同步合并：学习记录');

{
  const local = [{
    wordId: 'w1', studyCount: 10, correctCount: 8, wrongCount: 2, streak: 3,
    lastStudiedAt: 2000,
    byExercise: { spelling: { card: card({ last_review: '2026-08-10T00:00:00.000Z' }), correct: 8, wrong: 2 } },
  }];
  const remote = [{
    wordId: 'w1', studyCount: 4, correctCount: 4, wrongCount: 0, streak: 1,
    lastStudiedAt: 1000,
    byExercise: {
      spelling: { card: card({ last_review: '2026-08-05T00:00:00.000Z' }), correct: 4, wrong: 0 },
      en2zh: { card: card(), correct: 2, wrong: 0 },
    },
  }];
  const merged = mergeLearningRecords(local, remote)[0];

  check('计数取较大值（本地优先会抹掉另一台的练习量）', merged.studyCount === 10);
  check('两端各自独有的题型都保留', !!merged.byExercise.spelling && !!merged.byExercise.en2zh);
  check('同题型取 last_review 较新的整张卡',
    merged.byExercise.spelling.card.last_review === '2026-08-10T00:00:00.000Z');
  check('streak 跟随最后学过的一方', merged.streak === 3);
  check('firstStudiedAt 取更早', merged.lastStudiedAt === 2000);
}

{
  // 求和会在多次同步后重复累加，这里确认用的是取大值
  const rec = (n) => [{
    wordId: 'w1', studyCount: n, correctCount: n, wrongCount: 0, streak: 0,
    byExercise: { spelling: { card: card(), correct: n, wrong: 0 } },
  }];
  const once = mergeLearningRecords(rec(5), rec(5));
  const twice = mergeLearningRecords(once, rec(5));
  check('反复同步不会把计数越滚越大', twice[0].studyCount === 5);
  check('题型内的计数同样不累加', twice[0].byExercise.spelling.correct === 5);
}

{
  const local = [{
    wordId: 'w1', studyCount: 1, correctCount: 1, wrongCount: 0, streak: 0,
    lastStudiedAt: 2000, note: '本地笔记', byExercise: {},
  }];
  const remote = [{
    wordId: 'w1', studyCount: 1, correctCount: 1, wrongCount: 0, streak: 0,
    lastStudiedAt: 1000, note: '远端笔记', byExercise: {},
  }];
  const merged = mergeLearningRecords(local, remote)[0];
  check('两端笔记都不丢（手写内容丢了不可恢复）',
    merged.note.includes('本地笔记') && merged.note.includes('远端笔记'));

  const same = mergeLearningRecords(local, [{ ...remote[0], note: '本地笔记' }])[0];
  check('相同笔记不重复拼接', same.note === '本地笔记');
}

{
  const favLocal = [{ wordId: 'w1', studyCount: 0, correctCount: 0, wrongCount: 0, streak: 0, byExercise: {} }];
  const favRemote = [{ wordId: 'w1', studyCount: 0, correctCount: 0, wrongCount: 0, streak: 0, favorite: true, byExercise: {} }];
  check('任一端收藏即保留收藏', mergeLearningRecords(favLocal, favRemote)[0].favorite === true);
}

// ────────────────────────────────────────────────────────────────────────────
section('调度服务');

{
  const r0 = createRecord('w1');
  check('新记录状态为 new', deriveStatus(r0) === 'new');

  const r1 = recordAnswer(r0, 'spelling', 'good');
  check('答对后 streak 增加', r1.streak === 1);
  check('答对计入 correctCount', r1.correctCount === 1);

  const r2 = recordAnswer(r1, 'spelling', 'again');
  check('答错清零 streak', r2.streak === 0);
  check('答错计入 wrongCount', r2.wrongCount === 1);

  const r3 = recordAnswer(r1, 'spelling', 'hard');
  check('hard 算答对而不是答错（否则正确率会偏低）', r3.wrongCount === 0);
}

{
  const suspended = { ...createRecord('w1'), suspended: true, byExercise: { spelling: { card: card(), correct: 1, wrong: 0 } } };
  check('暂停状态优先级最高', deriveStatus(suspended) === 'suspended');
}

{
  const now = new Date('2026-08-20T00:00:00.000Z');
  check('今天到期说成「今天复习」',
    describeNextReview(new Date('2026-08-20T10:00:00.000Z'), now) === '今天复习');
  check('明天到期说成「明天复习」',
    describeNextReview(new Date('2026-08-21T10:00:00.000Z'), now) === '明天复习');
  check('没安排时不假装有时间', describeNextReview(null, now) === '尚未安排');
}

section('今日队列');

{
  const noMeaning = word({ id: 'nm', word: 'x', meanings: [] });
  check('没有释义的词出不了选择题', canRender(noMeaning, 'en2zh') === false);
  check('TTS 不可用时出不了听力题',
    canRender(word(), 'listening', { ttsAvailable: false }) === false);
  check('有释义时选择题可用', canRender(word(), 'en2zh') === true);
}

{
  const words = Array.from({ length: 20 }, (_, i) => word({ id: `w${i}`, word: `word${i}` }));
  const queue = buildTodayQueue(words, new Map(), {
    dailyNewLimit: 3,
    dailyReviewLimit: 0,
    enabledExercises: ['en2zh', 'spelling'],
  });
  check('新词上限按单词计而非按题目计', queue.newWordCount === 3);
  check('3 个词 × 2 题型 = 6 道题', queue.items.length === 6);
  check('全是新词时复习数为 0', queue.reviewWordCount === 0);
  check('预计时长至少 1 分钟', estimateMinutes(queue) >= 1);
}

{
  const words = [word({ id: 'w1' })];
  const records = new Map([['w1', { ...createRecord('w1'), suspended: true }]]);
  const queue = buildTodayQueue(words, records, {
    dailyNewLimit: 10, dailyReviewLimit: 0, enabledExercises: ['en2zh'],
  });
  check('暂停的词不进队列', queue.items.length === 0);
}

// ── 单一存储 ────────────────────────────────────────────────────────────────
// 「我的词库没有音标」的根因：划词面板写旧的 wordbook 表，词库页读新的 words 表，
// 事后补的音标补进了旧表。写入路径必须只有一条。
section('存储：不能再有第二条写入路径');
{
  const { readFileSync } = await import('node:fs');
  // 允许读旧表的只有两处：迁移，和 github-sync 里未迁移设备的兼容路径
  const ALLOWED = ['utils/github-sync.js', 'wordbook/lib/useLearning.ts', 'utils/learning/repository.ts'];
  const SUSPECTS = [
    'content/selection.js', 'utils/example-sentence.js',
    'sandbox/tabs/TextTab.tsx', 'popup/App.tsx',
  ];
  for (const f of SUSPECTS) {
    const src = readFileSync(f, 'utf8');
    check(`${f} 不再读写旧的 wordbook 表`,
      !/storage\.local\.(get|set)\([^)]*['"`]wordbook['"`]/.test(src)
      && !/\{\s*wordbook\s*[=:]/.test(src));
  }
  check('允许名单里的文件确实存在', ALLOWED.every((f) => {
    try { readFileSync(f, 'utf8'); return true; } catch { return false; }
  }));
}

// ── 单词展示口径 ────────────────────────────────────────────────────────────
section('音标/词性：六处渲染必须同一个口径');
{
  const w = (extra) => ({ id: 'x', word: 'test', meanings: [], examples: [], source: 'ai', addedAt: 0, ...extra });

  check('英美标注过的音标优先于未标注的',
    pickPhonetic(w({ phonetic: '/a/', phoneticUS: '/b/' })) === '/b/');
  check('没有英美标注时用中性的 phonetic',
    pickPhonetic(w({ phonetic: '/a/' })) === '/a/');
  check('一条都没有时返回空串（不是 undefined，渲染要能直接判真假）',
    pickPhonetic(w({})) === '');

  check('裸音标补上斜杠', formatPhonetic('tɛst') === '/tɛst/');
  check('已经有斜杠的不重复包', formatPhonetic('/tɛst/') === '/tɛst/');
  check('方括号形式原样保留', formatPhonetic('[tɛst]') === '[tɛst]');
  check('空串仍是空串', formatPhonetic('   ') === '');

  check('词性取第一条有标注的',
    pickPos(w({ meanings: [{ partOfSpeech: '', definitions: ['x'] },
                           { partOfSpeech: '名词', definitions: ['y'] }] })) === '名词');
  check('没有词性时返回空串，不编一个', pickPos(w({})) === '');

  const ctx = { sentence: 'real', origin: 'context', timestamp: 2 };
  const ai = { sentence: 'made up', origin: 'ai', timestamp: 3 };
  check('真实语境例句优先于 AI 生成（这是本产品的差异点）',
    pickExample(w({ examples: [ai, ctx] })).sentence === 'real');
  check('只有 AI 例句时取最新一条',
    pickExample(w({ examples: [{ ...ai, sentence: 'old' }, ai] })).sentence === 'made up');
  check('没有例句时返回 null', pickExample(w({})) === null);
}

// ── daisyUI 版本卫生 ────────────────────────────────────────────────────────
// 这个项目没有 linter，daisyUI 4 → 5 删掉的类写上去不会报错，只会静默失效：
// 页面照常渲染，只是布局不对。RangeField 的数值就这样右对齐失效了很久没人发现。
section('daisyUI：不再存在的类不能出现在源码里');
{
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join, extname } = await import('node:path');

  // daisyUI 5 里已删除的类。value 说明为什么它的消失是有后果的
  const REMOVED = {
    'form-control': '容器不再是 flex-col',
    'label-text': '不再有字号/颜色',
    'label-text-alt': '不再右对齐（.label 从 space-between 变成 inline-flex）',
    'input-bordered': 'input 默认就带边框',
    'select-bordered': 'select 默认就带边框',
    'textarea-bordered': 'textarea 默认就带边框',
  };
  const ROOTS = ['popup', 'options', 'sandbox', 'history', 'wordbook', 'pdf', 'content', 'utils'];
  const EXTS = new Set(['.tsx', '.jsx', '.html', '.js', '.css']);

  const walk = (dir, out = []) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (EXTS.has(extname(full))) out.push(full);
    }
    return out;
  };

  const files = ROOTS.flatMap((r) => walk(r));
  for (const [cls, why] of Object.entries(REMOVED)) {
    // 只看 class/className 属性里的整词，注释里提到类名是允许的
    const re = new RegExp(`class(?:Name)?=(["'\`])[^"'\`]*\\b${cls}\\b`);
    const hits = files.filter((f) => re.test(readFileSync(f, 'utf8')));
    check(`没有用 ${cls}（${why}）`, hits.length === 0,
      hits.length ? `出现在：${hits.join(', ')}` : '');
  }
}

// ── 会话存档 ────────────────────────────────────────────────────────────────
section('会话存档：什么样的存档才该恢复');
{
  const today = new Date();
  const base = {
    date: today.toDateString(),
    phase: 'review',
    queue: [{ wordId: 'a', exercise: 'en2zh' }, { wordId: 'b', exercise: 'spelling' },
            { wordId: 'c', exercise: 'en2zh' }],
    index: 1,
    correct: 1,
    total: 1,
    missedIds: [],
  };

  check('答了一题、还没答完的存档可以恢复', isResumable(base, today));
  check('null 不可恢复', !isResumable(null, today));
  check('一题没答的存档不算进度', !isResumable({ ...base, index: 0 }, today));
  check('答完的存档不该再恢复', !isResumable({ ...base, index: 3 }, today));
  check('下标越界的存档不可恢复', !isResumable({ ...base, index: 99 }, today));
  check('下标不是整数的存档不可恢复', !isResumable({ ...base, index: 1.5 }, today));
  check('未知阶段的存档不可恢复', !isResumable({ ...base, phase: 'x' }, today));
  check('学新词阶段同样可恢复', isResumable({ ...base, phase: 'learn' }, today));

  const yesterday = new Date(today.getTime() - 24 * 3600 * 1000);
  check('跨天的存档作废（今天该复习的词已经不一样了）',
    !isResumable({ ...base, date: yesterday.toDateString() }, today));
}

// ── 学习设置默认值 ──────────────────────────────────────────────────────────
// DEFAULTS.studyConfig 和 DEFAULT_STUDY_CONFIG 是两份独立的字面量（一份给
// chrome.storage.sync 的读取默认值，一份给纯函数层），两边漂移会让「没改过设置」
// 的用户和「改过又改回来」的用户看到不同的队列。
{
  const { DEFAULTS } = await import('../utils/defaults.js');
  const d = DEFAULTS.studyConfig;
  check('DEFAULTS.studyConfig 存在', !!d);
  check('新词上限与 DEFAULT_STUDY_CONFIG 一致',
    d.dailyNewLimit === DEFAULT_STUDY_CONFIG.dailyNewLimit);
  check('复习上限与 DEFAULT_STUDY_CONFIG 一致',
    d.dailyReviewLimit === DEFAULT_STUDY_CONFIG.dailyReviewLimit);
  check('启用题型与 DEFAULT_STUDY_CONFIG 一致',
    JSON.stringify([...d.enabledExercises].sort())
    === JSON.stringify([...DEFAULT_STUDY_CONFIG.enabledExercises].sort()));
}

// ────────────────────────────────────────────────────────────────────────────
console.log('');
if (fail === 0) {
  console.log(`\x1b[32m✓ 全部通过：${pass} 项\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m✗ ${fail} 项失败 / 共 ${pass + fail} 项\x1b[0m`);
  failures.forEach((f) => console.log(`  · ${f}`));
  process.exit(1);
}
