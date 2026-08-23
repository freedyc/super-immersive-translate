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
// 占位符是真值，会让 applyMeta 的 `!pickPos(word)` 和划词面板的补全判断恒假，
// 真实词性从此再也写不进来。显示成「未知」只是表象，卡死补全才是要命的。
section('迁移：不能往数据里写伪造的占位符');
{
  const base = { id: 'p1', text: 'placeholder', translations: { google: '占位' }, timestamp: 0 };

  const { word: noPos } = convertEntry(base);
  check('旧数据没有词性时留空，不填「未知」',
    noPos.meanings[0].partOfSpeech === '',
    `得到「${noPos.meanings[0].partOfSpeech}」`);

  const { word: withPos } = convertEntry({ ...base, pos: '名词' });
  check('旧数据有词性时照常保留', withPos.meanings[0].partOfSpeech === '名词');

  // pickPos 对空词性必须返回空串——补全逻辑全靠这个判断决定要不要去查
  check('空词性在 pickPos 下是假值，补全判断才能成立', pickPos(noPos) === '');
  check('有词性时 pickPos 如实返回', pickPos(withPos) === '名词');
}

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

// ── 本地音标 ────────────────────────────────────────────────────────────────
// 音标此前唯一来源是 AI 生成，而默认配置（engine: google，AI key 全空）下
// pickEngine 兜底试本地 Ollama、连不上被静默吞掉——划词面板和我的词库永远空着。
// 本地词典让它不再依赖任何引擎，所以数据本身的正确性要有断言兜着。
section('本地音标词典');
{
  const { readFileSync, existsSync } = await import('node:fs');

  check('数据文件随构建产物一起分发', existsSync('public/data/phonetics/a.json'));
  check('CMUdict 许可随数据一起保留', existsSync('public/data/phonetics/LICENSE'));

  const shard = (letter) =>
    JSON.parse(readFileSync(`public/data/phonetics/${letter}.json`, 'utf8'));

  // 重音标记必须落在**音节**开头。只按「尽量多划给后一个音节」切会切出
  // ˌsɛɹəˈndɪpɪti、tɹænˈzleɪt 这种——nd、zl 不是合法的英语音节起始
  const cases = [
    ['c', 'computer', 'kəmˈpjutɚ'],
    ['s', 'serendipity', 'ˌsɛɹənˈdɪpɪti'],
    ['t', 'translate', 'tɹænzˈleɪt'],
    ['i', 'international', 'ˌɪntɚˈnæʃənəl'],
    ['p', 'pronunciation', 'pɹoʊˌnʌnsiˈeɪʃən'],
    ['e', 'extraordinary', 'ˌɛkstɹəˈɔɹdəˌnɛɹi'],
  ];
  for (const [letter, word, expected] of cases) {
    const got = shard(letter)[word];
    check(`${word} 的音节切分与重音正确`, got === expected, `得到 ${got}`);
  }

  const t = shard('t');
  check('单音节词不标重音（标了只是噪音）', t.thought === 'θɔt');
  const a = shard('a');
  check('非重读 AH 弱化成 ə 而不是 ʌ', a.about === 'əˈbaʊt');
  check('非重读 ER 弱化成 ɚ', shard('w').water === 'ˈwɔtɚ');

  check('覆盖量级在 11 万词以上',
    Object.keys(shard('s')).length + Object.keys(shard('c')).length > 20000);

  // 音标里不该混进 ARPAbet 残留（转换失败时最容易漏出来的形态）
  const sample = Object.values(shard('a')).slice(0, 2000);
  check('没有未转换的 ARPAbet 残留', !sample.some((v) => /[A-Z0-9]/.test(v)));

  // 跑真正的查询模块，只把 chrome.runtime/fetch 换成本地读文件。
  // 词形派生（runs / running / walked）没有断言的话，改坏了不会有任何迹象
  globalThis.chrome = { runtime: { getURL: (u) => u } };
  globalThis.fetch = async (u) => {
    try {
      return { ok: true, json: async () => JSON.parse(readFileSync(`public/${u}`, 'utf8')) };
    } catch { return { ok: false, json: async () => ({}) }; }
  };
  const { lookupPhonetic } = await import('../utils/phonetics.js');

  check('直接命中', await lookupPhonetic('computer') === 'kəmˈpjutɚ');
  check('大小写不敏感', await lookupPhonetic('Computer') === 'kəmˈpjutɚ');
  check('查不到返回空串，不是 undefined', await lookupPhonetic('zzqxnotaword') === '');
  check('词组没有单一读音，返回空串', await lookupPhonetic('hello world') === '');

  // 下面这些词典里没有收，只能靠词形派生。用 CMUdict 已经收了的词（runs/walked）
  // 测派生等于什么都没测——那些是直接命中，派生函数根本没被调用
  check('派生 -ing（onboard → onboarding）',
    await lookupPhonetic('onboarding') === 'ˈɑnˌbɔɹdɪŋ');
  check('派生 -ed：前为 d 则加 ɪd（onboard → onboarded）',
    (await lookupPhonetic('onboarded')).endsWith('dɪd'));
  check('派生 -s：前为浊音加 z（api → apis）',
    (await lookupPhonetic('apis')).endsWith('z'));
  check('派生 -ing 且词干结尾哑 e 被去掉（curate → curating）',
    (await lookupPhonetic('curating')).endsWith('ɪŋ'));
  check('派生 -ing 且词干结尾哑 e（archive → archiving）',
    (await lookupPhonetic('archiving')).endsWith('ɪŋ'));
}

// ── 本地词性 ────────────────────────────────────────────────────────────────
// 与音标同一个病根：词性此前也只能由 AI 生成，默认配置下永远是空的。
section('本地词性词典');
{
  const { readFileSync, existsSync } = await import('node:fs');
  check('数据文件随构建产物一起分发', existsSync('public/data/pos/a.json'));
  check('WordNet 许可随数据一起保留', existsSync('public/data/pos/LICENSE'));

  const { lookupPos } = await import('../utils/pos.js');
  const { formatPos } = await import('../utils/learning/wordMeta.ts');

  check('名词', await lookupPos('computer') === 'n');
  check('形容词', await lookupPos('beautiful') === 'j');
  check('副词', await lookupPos('quickly') === 'r');

  // 多词性的词按义项数排序：run 有 41 个动词义项、16 个名词义项，
  // 动词才是主用法。不排序的话展示出来的第一个词性是随机的
  check('多词性按义项数排序，动词在前', await lookupPos('run') === 'vn');

  // 封闭词类必须压过 WordNet：a 在 WordNet 里是名词（指字母 a），
  // 但用户划到它时想看到的是冠词
  check('冠词优先于 WordNet 的「字母 a」义', (await lookupPos('a')).startsWith('a'));
  check('介词', (await lookupPos('of')).startsWith('i'));
  check('连词', (await lookupPos('and')).startsWith('c'));
  check('代词', (await lookupPos('this')).startsWith('p'));

  check('查不到返回空串', await lookupPos('zzqxnotaword') === '');
  check('词组返回空串', await lookupPos('hello world') === '');

  // 派生：词典没单独收录，但词性可以确定推出
  check('-ly 从形容词推出副词', await lookupPos('speedily') !== '');

  check('代号排版成中文', formatPos('vn') === '动词 · 名词');
  check('未知代号被丢弃，不显示成乱码', formatPos('vXn') === '动词 · 名词');
  check('空代号得到空串', formatPos('') === '');
  // light 是形/名/动/副四类，全列出来徽章比单词本身还长
  check('最多显示三类', formatPos('jnvr').split(' · ').length === 3);
}

// ── 浮层隔离 ────────────────────────────────────────────────────────────────
// 浮层（划词面板、进度条、输入气泡、字幕兜底）活在 Shadow DOM 里，宿主页 CSS
// 影响不到；双语译文和字幕译文必须跟宿主内容一起排版，只能留在宿主 DOM。
// 这条边界一旦模糊，浮层就会在带激进 CSS 重置的站点上散架。
section('内容脚本：浮层进影子树，随文内容留宿主 DOM');
{
  const { readFileSync } = await import('node:fs');

  // 只有这些类可以出现在注入宿主页面的样式表里——它们都必须跟正文一起流动
  const HOST_DOM_ONLY = new Set([
    'sit-translation', 'sit-original', 'sit-wrapper',
    'sit-hover-highlight', 'sit-subtitle-translation',
  ]);
  for (const f of ['content/content.css', 'content/subtitle.css']) {
    const classes = [...new Set(
      [...readFileSync(f, 'utf8').matchAll(/\.(sit-[a-z-]+)/g)].map((m) => m[1]),
    )];
    const stray = classes.filter((c) => !HOST_DOM_ONLY.has(c));
    check(`${f} 只含必须留在宿主 DOM 的类`, stray.length === 0,
      stray.length ? `浮层样式应移到 overlay.css：${stray.join(', ')}` : '');
  }

  // 副作用导入会被 crxjs 注入到宿主页面，浮层样式必须走 ?inline 进影子树
  for (const f of ['content/selection.js', 'content/content.js',
                   'content/input-translate.js', 'content/subtitle.js']) {
    const src = readFileSync(f, 'utf8');
    const sideEffect = [...src.matchAll(/^import\s+['"]\.\/([a-z-]+\.css)['"]/gm)]
      .map((m) => m[1])
      .filter((name) => name !== 'content.css' && name !== 'subtitle.css');
    check(`${f} 没有把浮层样式副作用导入（会漏进宿主页）`, sideEffect.length === 0,
      sideEffect.join(', '));
  }

  // 事件穿出影子树时 target 会重定向成 host，closest 找不到面板，
  // 「点面板内部」会被判成「点了外面」——面板每点一下就关
  const sel = readFileSync('content/selection.js', 'utf8');
  check('划词面板的外部点击判断用 composedPath，不用 target.closest',
    !/target\.closest\(\s*['"]\.['"]\s*\+\s*(PANEL|ICON)_CLASS/.test(sel));
  check('划词浮层挂在影子根上，不挂 document.body',
    !/document\.body\.appendChild/.test(sel));
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
