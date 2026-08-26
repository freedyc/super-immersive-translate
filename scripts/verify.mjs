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

// ── 朗读引擎 ────────────────────────────────────────────────────────────────
section('朗读引擎：能力声明与分段');
{
  const { TTS_ENGINES, getEngine, supportsLang, buildRequest, chunkText, isChinese } =
    await import('../utils/tts-engines.js');

  check('浏览器语音是默认，排在第一个', TTS_ENGINES[0].id === 'browser');
  check('至少两个免费且无需 Key 的引擎',
    TTS_ENGINES.filter((e) => !e.needsKey).length >= 2);
  check('免费引擎里有支持中文的',
    TTS_ENGINES.some((e) => !e.needsKey && e.langs === 'all' && e.id !== 'browser'));

  // 有道的中文请求会返回 500——不是音质问题，是根本没有。
  // 这条声明是 speak() 里语言降级的依据，写错了用户点一次失败一次
  check('有道声明为仅英文', getEngine('youdao').langs === 'en');
  check('中文交给有道会被判为不支持', supportsLang('youdao', 'zh-CN') === false);
  check('英文交给有道是支持的', supportsLang('youdao', 'en-US') === true);
  check('Google 中英文都支持', supportsLang('google', 'zh-CN') && supportsLang('google', 'en-US'));
  check('中文语种判断认得 zh-CN / zh-TW',
    isChinese('zh-CN') && isChinese('zh-TW') && !isChinese('en-US'));

  // 未知引擎不能让调用方拿到 undefined 再崩在 .maxChars 上
  check('未知引擎回退到默认引擎', getEngine('nope').id === 'browser');

  const g = buildRequest('google', 'hello world', 'zh-CN');
  check('Google 请求带 client=tw-ob（这是免鉴权的那个端点）',
    g.url.includes('client=tw-ob'));
  check('Google 请求把语种带上', g.url.includes('tl=zh-CN'));
  check('文本经过 URL 编码', buildRequest('google', 'a b&c', 'en').url.includes('a+b%26c'));
  check('有道美式是 type=2', buildRequest('youdao', 'test', 'en', {}).url.includes('type=2'));
  check('有道英式是 type=1',
    buildRequest('youdao', 'test', 'en', { youdaoAccent: 'uk' }).url.includes('type=1'));
  check('浏览器语音不构造网络请求', buildRequest('browser', 'x', 'en') === null);

  // Google 单次上限约 200 字符，超了返回 400。分段没做对的表现是长句直接不出声
  const en = 'The quick brown fox jumps over the lazy dog. '.repeat(8);
  const chunks = chunkText(en, 180);
  check('长英文被分段', chunks.length > 1);
  check('每段都不超过上限', chunks.every((c) => c.length <= 180));
  // 这条必须用构造输入：拿重复句子测「是否在句末切」会被蒙混过去——
  // 那种文本里最后一个空格正好紧跟句号，句末分支和词边界分支结果一样，
  // 把句末逻辑整个删掉断言照样通过
  {
    const head = `${'x'.repeat(100)}. `;      // 句号在下标 100
    const tail = 'yyyy '.repeat(20);          // 后面还有很多词边界
    const [first] = chunkText(head + tail, 180);
    check('在句末切且标点归前一段（不是退到词边界）',
      first === `${'x'.repeat(100)}.`, `得到 ${JSON.stringify(first.slice(-8))}`);
  }
  {
    // 句末位置太靠前时不该采纳，否则会切出一堆很短的片段，连读起来一顿一顿
    const early = `ok. ${'z'.repeat(200)}`;
    const [first] = chunkText(early, 180);
    check('句末位置过于靠前时退到词边界', first !== 'ok.');
  }
  check('分段后内容不丢字',
    chunks.join(' ').replace(/\s+/g, '') === en.trim().replace(/\s+/g, ''));

  // 中文没有空格，退不到词边界，但仍然要能切出来而不是死循环
  const zh = '这是一段很长的中文文本，用来测试分段是否正确。'.repeat(10);
  const zhChunks = chunkText(zh, 180);
  check('长中文也能分段', zhChunks.length > 1 && zhChunks.every((c) => c.length <= 180));

  check('短文本不分段', chunkText('hello', 180).length === 1);
  check('空文本得到空数组', chunkText('   ', 180).length === 0);
}

section('朗读：设置改了要立刻生效');
{
  // 真跑一遍 TTSManager，只把 chrome / window 的相关部分换成假的。
  // 这个 bug（单词本页从不 init()，喇叭永远用默认设置）静态检查看不出来
  const listeners = [];
  const store = {
    ttsEngineEn: 'google', ttsEngineZh: 'google',
    ttsBrowserRate: '1.0', ttsBrowserPitch: '1.0',
  };
  const spoken = [];

  globalThis.chrome = {
    storage: {
      sync: { get: async (defaults) => ({ ...defaults, ...store }) },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
    runtime: {
      getURL: (u) => u,
      // 网络引擎：不真发请求，只记下用的是哪个引擎
      sendMessage: async (msg) => {
        spoken.push(msg.engine);
        return { dataUrl: 'data:audio/mpeg;base64,AAAA' };
      },
    },
  };
  globalThis.window = {
    speechSynthesis: {
      cancel() {}, speaking: false, getVoices: () => [],
      // 退回浏览器语音时也要记一笔，否则「设置没生效」表现成 shim 崩溃，
      // 断言根本跑不到
      speak(u) { spoken.push('browser'); queueMicrotask(() => u.onend?.()); },
    },
  };
  globalThis.Audio = class {
    constructor() { this.paused = true; this.currentTime = 0; }
    play() { queueMicrotask(() => this.onended?.()); return Promise.resolve(); }
  };
  globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };

  await import('../utils/tts.js');
  // 用模块建好的那个单例——设置变更监听绑的就是它
  const tts = globalThis.window.ttsManager;

  // 从不调用 init()，直接 speak()——这正是单词本页的用法
  await tts.speak('hello', 'en-US');
  check('speak() 自己保证设置已就绪（调用方不必先 init）',
    spoken[0] === 'google', `实际用了 ${spoken[0]}`);

  // 用户在选项页改了引擎
  store.ttsEngineEn = 'youdao';
  check('注册了设置变更监听', listeners.length > 0);
  listeners.forEach((fn) => fn({ ttsEngineEn: { newValue: 'youdao' } }, 'sync'));
  await tts.ready;
  await tts.speak('hello', 'en-US');
  check('改完设置后立刻用新引擎，不是旧的',
    spoken[1] === 'youdao', `实际用了 ${spoken[1]}`);

  // 与朗读无关的设置变更不该白读一次存储
  const before = listeners.length;
  listeners.forEach((fn) => fn({ targetLang: { newValue: 'ja' } }, 'sync'));
  check('无关设置变更被忽略', before === listeners.length);
}

section('朗读：中英文分开配置');
{
  const { resolveTts } = await import('../utils/tts-engines.js');
  const { TTS_SAMPLES, SAMPLE_LANGS } = await import('../utils/tts-samples.js');

  const perLang = {
    ttsEngineEn: 'youdao', ttsEngineZh: 'google',
    ttsBrowserVoiceEn: 'Alex', ttsBrowserVoiceZh: 'Tingting',
  };
  check('英文取英文那套', resolveTts(perLang, 'en-US').engine === 'youdao');
  check('中文取中文那套', resolveTts(perLang, 'zh-CN').engine === 'google');
  check('英文音色不串到中文', resolveTts(perLang, 'zh-CN').voiceURI === 'Tingting');

  // 升级上来的用户不该被重置成默认，也不必写一次存储做迁移
  const legacy = { ttsEngine: 'google', ttsBrowserVoiceURI: 'Alex' };
  check('旧的单一引擎设置被两个语种继承',
    resolveTts(legacy, 'en-US').engine === 'google'
    && resolveTts(legacy, 'zh-CN').engine === 'google');
  check('旧音色与语种对得上时继承', resolveTts(legacy, 'en-US').voiceURI === 'Alex');

  // 分语种之前的真 bug：设了中文音色，英文也会用中文嗓子念。
  // 回退逻辑不能把这个毛病继承过来
  const legacyZhVoice = { ttsBrowserVoiceURI: 'Microsoft Huihui - Chinese (Simplified, PRC)' };
  check('旧的中文音色不回退给英文（否则英文会用中文嗓子念）',
    resolveTts(legacyZhVoice, 'en-US').voiceURI === '');
  check('旧的中文音色仍回退给中文',
    resolveTts(legacyZhVoice, 'zh-CN').voiceURI !== '');

  check('没有任何设置时默认浏览器语音', resolveTts({}, 'en-US').engine === 'browser');
  check('新设置优先于旧设置',
    resolveTts({ ...legacy, ttsEngineEn: 'browser' }, 'en-US').engine === 'browser');

  // 试听句：每句针对一个发音难点，凑数的话引擎之间听不出差别
  for (const { lang, label } of SAMPLE_LANGS) {
    const list = TTS_SAMPLES[lang];
    check(`${label}试听句有 10 句`, list?.length === 10);
    check(`${label}试听句都有标签和内容`,
      list.every((s) => s.label && s.text));
    check(`${label}试听句互不重复`,
      new Set(list.map((s) => s.text)).size === list.length);
  }
  check('中文试听句确实是中文', /[\u4e00-\u9fa5]/.test(TTS_SAMPLES['zh-CN'][0].text));
  check('英文试听句不含中文', !/[\u4e00-\u9fa5]/.test(TTS_SAMPLES['en-US'][0].text));
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

  // 影子宿主是 width:0 的盒子。绝对定位元素的 shrink-to-fit 可用宽度取自
  // 包含块，为 0 时会塌缩到「最小内容宽」——中文配 word-break 就是一个字，
  // 浮层竖成一列。所以影子树里每个 position:absolute 的块都必须自己定宽。
  for (const cssFile of ['content/overlay.css', 'content/selection.css']) {
    // 必须先剥掉注释：说明这条规则的注释里就写着 "width:0"，
    // 不剥的话正则会在注释里匹配到，删掉真正的 width 声明也照样"通过"
    const css = readFileSync(cssFile, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const blocks = css.match(/\.[a-z-]+[^{}]*\{[^}]*\}/g) || [];
    const collapsing = blocks
      .filter((b) => /position:\s*absolute/.test(b))
      .filter((b) => !/\bwidth:/.test(b))
      .map((b) => b.slice(0, b.indexOf('{')).trim());
    check(`${cssFile} 里绝对定位的浮层都定了宽度`, collapsing.length === 0,
      collapsing.length ? `会塌缩成一列：${collapsing.join(', ')}` : '');
  }

  // 事件穿出影子树时 target 会重定向成 host，closest 找不到面板，
  // 「点面板内部」会被判成「点了外面」——面板每点一下就关
  const sel = readFileSync('content/selection.js', 'utf8');
  check('划词面板的外部点击判断用 composedPath，不用 target.closest',
    !/target\.closest\(\s*['"]\.['"]\s*\+\s*(PANEL|ICON)_CLASS/.test(sel));
  check('划词浮层挂在影子根上，不挂 document.body',
    !/document\.body\.appendChild/.test(sel));
}

// ── 内容脚本的跨文件依赖 ────────────────────────────────────────────────────
// @crxjs 把每个内容脚本包成异步加载的模块，manifest 里 js 数组的顺序**不保证**
// 执行顺序。靠顺序去拿另一个脚本挂在 window 上的对象，会随机地
// Cannot read properties of undefined —— 依赖必须写成真正的 import。
section('内容脚本：window 上的共享对象必须显式导入');
{
  const { readdirSync, readFileSync } = await import('node:fs');

  // window 上的全局 → 定义它的模块
  const PROVIDERS = {
    ttsManager: 'utils/tts.js',
    translator: 'utils/translator.js',
  };

  for (const file of readdirSync('content').filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(`content/${file}`, 'utf8');
    for (const [global, provider] of Object.entries(PROVIDERS)) {
      // 只看代码里的用法，注释里提到不算
      const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      if (!code.includes(`window.${global}`)) continue;
      const name = provider.split('/').pop();
      check(`content/${file} 用了 window.${global}，就必须导入 ${provider}`,
        new RegExp(`import\\s+['"]\\.\\./utils/${name.replace('.', '\\.')}['"]`).test(src)
        || new RegExp(`from\\s+['"]\\.\\./utils/${name.replace('.', '\\.')}['"]`).test(src));
    }
  }
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

// ── 剪贴板加密 ──────────────────────────────────────────────────────────────
// 剪贴板里可能有任何东西。这一节守的是「GitHub 上只有密文」这条底线。
section('剪贴板同步：端到端加密');
{
  const { readFileSync } = await import('node:fs');
  const { encryptJson, decryptJson, isEncrypted, generateRecoveryKey } =
    await import('../utils/crypto.js');

  const secret = { items: ['我的密码是 hunter2', 'ghp_realtokenlookalike'] };
  const box = await encryptJson(secret, 'correct horse battery');

  check('密文里没有明文残留', !JSON.stringify(box).includes('hunter2'));
  check('盐和 IV 随密文保存（它们不需要保密，需要保密的只有口令）',
    !!box.salt && !!box.iv);
  check('记下了 KDF 与迭代次数，将来调参数旧密文仍解得开',
    box.kdf === 'PBKDF2-SHA256' && box.iterations >= 600000);

  const back = await decryptJson(box, 'correct horse battery');
  check('正确口令能完整还原', JSON.stringify(back) === JSON.stringify(secret));

  let wrong = null;
  try { await decryptJson(box, 'wrong'); } catch (e) { wrong = e.name; }
  check('口令不对时抛 WrongPassphraseError，而不是给出错误明文',
    wrong === 'WrongPassphraseError');

  // AES-GCM 的认证标签：密文被改一个字节，解密必须失败
  let tampered = null;
  const bad = { ...box, ciphertext: `${box.ciphertext.slice(0, -4)}AAAA` };
  try { await decryptJson(bad, 'correct horse battery'); } catch (e) { tampered = e.name; }
  check('密文被篡改时解密失败（GCM 认证）', tampered === 'WrongPassphraseError');

  // 同样的数据两次加密必须得到不同密文，否则观察者能从"密文没变"推出"内容没变"
  const a = await encryptJson(secret, 'p');
  const b = await encryptJson(secret, 'p');
  check('同数据两次加密密文不同（每次新随机盐和 IV）', a.ciphertext !== b.ciphertext);

  check('isEncrypted 认得自家密文', isEncrypted(box));
  check('isEncrypted 不把普通数组当密文', !isEncrypted([{ id: 1 }]) && !isEncrypted(null));

  const rk = generateRecoveryKey();
  check('恢复密钥足够长（256 位随机量）', rk.replace(/-/g, '').length >= 50);
  check('恢复密钥不含易混字符 I/O/0/1', !/[IO01]/.test(rk));
  check('两次生成的恢复密钥不同', generateRecoveryKey() !== generateRecoveryKey());

  // 没有口令绝不能退化成明文上传——这是整个功能的底线
  let noPass = null;
  try { await encryptJson(secret, ''); } catch (e) { noPass = e.message; }
  check('没有口令时加密直接报错，不返回明文', !!noPass);

  const syncSrc = readFileSync('utils/github-sync.js', 'utf8');
  check('同步代码里没有口令就抛错，不会走到上传',
    /if \(!passphrase\)[\s\S]{0,200}throw new Error/.test(syncSrc));
  check('剪贴板推送的是 encryptJson 的结果', /encryptJson\(final, passphrase\)/.test(syncSrc));

  // 口令绝不能进 storage.sync —— 那会同步到 Google 账号，
  // 密文给 GitHub、钥匙给 Google，就谈不上端到端了
  const uiSrc = readFileSync('options/components/ClipboardSyncCard.tsx', 'utf8');
  check('口令只存 storage.local，不进 sync',
    uiSrc.includes('storage.local.set({ clipboardSyncPassphrase')
    && !/storage\.sync\.set\([^)]*clipboardSyncPassphrase/.test(uiSrc));
  check('defaults 里没有 clipboardSyncPassphrase（它不属于可同步设置）',
    !readFileSync('utils/defaults.js', 'utf8').includes('clipboardSyncPassphrase'));
}

// ── React Hook 顺序 ────────────────────────────────────────────────────────
// 提前返回上面少调了几个 Hook，下次渲染数量就对不上，React 抛 #310 整页白屏。
// 这类错误 typecheck 查不出、构建也不报，只有真打开页面才炸——
// 设置页就这么崩过一次（加标签页持久化时把 useCallback 写到了 return null 下面）。
section('AI 请求走 Service Worker（内容脚本受宿主页 CORS 约束）');
{
  const { readFileSync } = await import('node:fs');
  const tr = readFileSync('utils/translator.js', 'utf8');
  const es = readFileSync('utils/example-sentence.js', 'utf8');
  const net = readFileSync('utils/net.js', 'utf8');
  const bg = readFileSync('background/background.js', 'utf8');

  // Chrome 85 起 host_permissions 在内容脚本里不再豁免 CORS。
  // OpenAI/Gemini/Claude 都不给浏览器发 CORS 头，Ollama 默认只放行 localhost，
  // 所以这些引擎在划词面板里必须绕后台，否则根本发不出请求
  /**
   * 截取一个方法的函数体：切到**下一个方法定义**为止，不能用固定长度。
   * 用固定长度切的话，_ollamaBatch 后面 25 行就是 _claudeBatch，
   * 邻居的 fetchViaBackground 会落进窗口里让断言假通过（踩过）。
   */
  const methodBody = (src, name) => {
    const start = src.indexOf(`async ${name}(`);
    if (start < 0) return '';
    const next = src.slice(start + 1).search(/\n  (async )?_[a-zA-Z]+\(/);
    return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next);
  };

  const AI_ENGINES = ['_deeplBatch', '_customBatch', '_openaiBatch',
    '_geminiBatch', '_claudeBatch', '_ollamaBatch'];
  for (const fn of AI_ENGINES) {
    const body = methodBody(tr, fn);
    check(`${fn} 存在`, body.length > 0);
    if (!body) continue;
    check(`${fn} 走后台代发`, body.includes('fetchViaBackground('),
      body.includes('fetchWithTimeout(') ? '还在用直连的 fetchWithTimeout' : '');
  }

  // 免费接口自己发 CORS 头，直连即可，绕后台只会多一次消息往返
  const FREE = ['_googleBatch', '_mymemoryBatch', '_lingvaBatch', '_libreBatch'];
  for (const fn of FREE) {
    const body = methodBody(tr, fn);
    if (!body) continue;
    check(`${fn} 直连，不必绕后台`, !body.includes('fetchViaBackground('));
  }

  check('example-sentence 的请求也走后台', es.includes("from './net.js'"));

  // 判断运行环境：内容脚本在宿主页面的源里，扩展页面是 chrome-extension:
  check('按运行环境分流，而不是一律绕后台',
    /location\.protocol !== 'chrome-extension:'/.test(net));
  check('后台注册了代发处理器', /msg\.action === 'proxyFetch'/.test(bg));
  // 消息通道要序列化，回传文本由调用方自己解析，出错时还能看到原始响应
  check('代发回传文本而不是解析后的对象', /body: await resp\.text\(\)/.test(bg));
  check('代发也有超时', /signal: AbortSignal\.timeout\(timeoutMs\)/.test(bg));
  // 通道断了（扩展重载、SW 被回收）拿不到 reply，不能当成成功
  check('拿不到回复时报错而不是静默当成功', /if \(!reply\) throw new Error/.test(net));
}

section('AI 请求必须有超时');
{
  const { readFileSync } = await import('node:fs');

  // 没有超时的话，一个卡住的本地模型会让请求永远挂着：面板一直转圈，
  // 而且每次重载扩展都会把在途请求变成孤儿继续占着服务端的并发槽位，
  // 最后把本地推理队列彻底堵死——这是真实发生过的，Ollama 卡到
  // 连一句 "hi" 都要 120 秒超时。
  for (const f of ['utils/translator.js', 'utils/example-sentence.js']) {
    const src = readFileSync(f, 'utf8');
    // 裸 fetch( 一处都不该剩（fetchWithTimeout 里面那次除外）
    const bare = [...src.matchAll(/await fetch\(/g)].length;
    check(`${f} 没有不带超时的 fetch`, bare === 0, `还有 ${bare} 处`);
    // 超时可以自己加，也可以委托给 net.js 的 request（它内部和后台代发都会加）。
    // 断言认的是「这条路径有超时」，不是某一种写法——
    // 上一版只认 AbortSignal.timeout，请求改走后台后就误报了
    check(`${f} 每条请求路径都有超时`,
      /AbortSignal\.timeout\(/.test(src) || /return request\(url, init, timeoutMs\)/.test(src));
    // 本地推理天生慢，按在线接口的超时卡会误杀大模型
    check(`${f} 本地引擎用更长的超时`,
      /LOCAL_TIMEOUT_MS/.test(src) && /}, LOCAL_TIMEOUT_MS\)/.test(src));
  }
}

section('划词浮层定位');
{
  const { placeOverlay } = await import('../content/overlay-position.js');
  const V = { viewportW: 1000, viewportH: 800, scrollX: 0, scrollY: 0 };
  const box = { width: 30, height: 30 };
  const at = (top, bottom, left, right, extra = {}) =>
    placeOverlay({ rect: { top, bottom, left, right }, ...box, ...V, ...extra });

  // 结果必须钳在视口内。不钳的话，在视口右缘/页面底部划词时浮层伸到文档之外，
  // 浏览器据此扩大滚动区域——宿主网站平白多出一条滚动条
  const right = at(300, 320, 940, 995);
  check('贴右缘时不超出视口右边界', right.left + box.width <= V.viewportW);
  const bottom = at(770, 795, 400, 460);
  check('贴底部时不超出视口下边界', bottom.top + box.height <= V.viewportH);
  const topEdge = at(0, 5, 400, 460);
  check('贴顶部时不越过上边界', topEdge.top >= 0);
  const leftEdge = at(300, 320, 0, 2);
  check('贴左缘时不越过左边界', leftEdge.left >= 0);

  // 下方放不下要翻到上方，否则按钮落在视口外，用户根本看不到
  check('底部划词时翻到选区上方', bottom.flipped === true);
  check('中间划词时不翻转', at(300, 320, 400, 460).flipped === false);
  check('翻转后落在选区上方', bottom.top + box.height <= 770);

  // 上下都放不下（选区几乎占满视口）也不能跑出视口
  const tall = placeOverlay({
    rect: { top: 5, bottom: 795, left: 400, right: 460 }, ...box, ...V,
  });
  check('上下都放不下时仍钳在视口内',
    tall.top >= 0 && tall.top + box.height <= V.viewportH);

  // 页面坐标 = 视口坐标 + 滚动量。先加滚动再钳的话钳的是文档边界，
  // 仍然可能落在视口之外
  const scrolled = placeOverlay({
    rect: { top: 300, bottom: 320, left: 400, right: 460 },
    ...box, ...V, scrollY: 2000, scrollX: 50,
  });
  const plain = at(300, 320, 400, 460);
  check('滚动后返回的是页面坐标',
    scrolled.top === plain.top + 2000 && scrolled.left === plain.left + 50);

  // 浮层比视口还宽时，贴左边总比贴右边可用
  const huge = placeOverlay({
    rect: { top: 300, bottom: 320, left: 400, right: 460 },
    width: 2000, height: 30, ...V,
  });
  check('浮层比视口还宽时贴左边而不是算出负数', huge.left >= 0);

  // 面板贴选区左缘，读起来跟原文对齐；图标贴右缘，不挡住刚选的字
  check('anchor=left 时贴选区左缘',
    at(300, 320, 400, 460, { anchor: 'left' }).left === 400);
  check('默认贴选区右缘', at(300, 320, 400, 460).left > 460);

  const sel = (await import('node:fs')).readFileSync('content/selection.js', 'utf8');
  check('图标与面板都走同一套定位',
    (sel.match(/placeOverlay\(/g) || []).length >= 2);
}

section('划词面板：词条区');
{
  const { readFileSync } = await import('node:fs');
  const sel = readFileSync('content/selection.js', 'utf8');
  const css = readFileSync('content/selection.css', 'utf8');
  const ai = readFileSync('utils/example-sentence.js', 'utf8');

  // 查词的人最想先看到「这个词有几个意思」，各引擎译文是用来相互印证的，排在后面
  const entryPos = sel.indexOf('class="sit-entry"');
  const inputPos = sel.indexOf('class="sit-input-wrap"');
  const enginePos = sel.indexOf('class="sit-engines"');
  check('词条区排在输入框之后、引擎结果之前',
    inputPos > 0 && entryPos > inputPos && enginePos > entryPos);

  // 义项必须按词性分开：challenge 作名词是「挑衅/考验」、作动词是「挑战」，
  // 混成一段就看不出区别了
  check('提示词要求不同词性拆成不同义项',
    /Different parts of speech MUST be separate senses/.test(ai));
  check('义项数量有上限（撑满面板会把引擎结果挤到很后面）',
    /\.slice\(0, 4\)/.test(ai));
  check('每个义项都要求自带能区分词义的例句',
    /own example sentence that actually disambiguates/.test(ai));

  // 词条区只能由 AI 产出，本地词典给不了多义项释义。所以「音标/词性/例句都齐了」
  // 不能用来跳过词条请求——早先那个 return 就是这么写的，
  // 导致凡是收藏过的词都看不到词条区
  const body = sel.slice(sel.indexOf('async function loadDictionaryInfo'));
  const fnEnd = body.indexOf('\n  }');
  const lookup = body.slice(0, fnEnd);
  check('取词条不受「音标词性已齐」的提前返回影响',
    lookup.indexOf('analyzeWordSenses') > 0
    && !/if \(phonetic && pos && ex\?\.sentence\) return;/.test(lookup));

  // 默认配置下根本没有可用 AI 引擎，这块内容本就是锦上添花，拿不到必须能降级
  check('拿不到分析结果时返回 null 而不是抛',
    /export async function analyzeWordSenses[\s\S]{0,400}if \(!engine\) return null/.test(ai));
  check('渲染前判空，没有义项就不显示这一块',
    /if \(!el \|\| !data\?\.senses\?\.length\) return/.test(sel));

  // 两次独立请求各自渲染。用 Promise.all 会让先回来的干等另一个——
  // 词条是这块的主内容，不该因为例句慢而一起卡住
  check('词条与例句各自独立渲染，不互相等待',
    /analyzeWordSenses\([^)]*\)\s*\n?\s*\.then/.test(sel)
    && !/Promise\.all\(\[[\s\S]{0,120}analyzeWordSenses/.test(sel));
  // AI 拿不到本就该静默忽略，不能变成 unhandled rejection 弹在控制台
  check('两条链路都有 catch 兜底',
    (sel.match(/\.catch\(\(\) => \{\}\)/g) || []).length >= 2);

  // 面板会出现在任意网页上，用户内容必须转义
  check('义项内容经过 HTML 转义',
    /escapeHtml\(s\.definition\)/.test(sel) && /escapeHtml\(s\.example\)/.test(sel));

  // 浮层在影子树里，宿主页深色时这块也要能看
  const dark = css.slice(css.lastIndexOf('prefers-color-scheme: dark'));
  for (const cls of ['sit-sense-def', 'sit-sense-pos', 'sit-primary-text', 'sit-entry-note']) {
    check(`${cls} 有深色模式样式`, dark.includes(`.${cls}`));
  }
}

section('React：Hook 必须在提前返回之前调用');
{
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join, extname } = await import('node:path');

  const walk = (dir, out = []) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (extname(full) === '.tsx') out.push(full);
    }
    return out;
  };

  const IS_HOOK = /\buse(State|Effect|Callback|Memo|Ref|Reducer|Context|LayoutEffect)\s*\(/;
  const violations = [];

  for (const dir of ['options', 'wordbook', 'history', 'popup', 'sandbox', 'pdf', 'components']) {
    for (const file of walk(dir)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      // 按顶层函数切块：一个文件里常有多个组件，不切块的话前一个组件的
      // return 会被当成后一个组件的提前返回，误报一堆
      const starts = lines
        .map((l, i) => (/^(export\s+)?function\s+[A-Z]/.test(l) ? i : -1))
        .filter((i) => i >= 0);

      starts.forEach((start, k) => {
        const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
        const body = lines.slice(start, end);
        // 组件体内的 Hook 调用：缩进两格
        const hooks = body
          .map((l, i) => (/^ {2}\S/.test(l) && IS_HOOK.test(l) ? i : -1))
          .filter((i) => i >= 0);
        if (hooks.length === 0) return;
        const early = body.findIndex(
          (l, i) => i > hooks[0] && /^ {2}(if \(.*\)\s*return|return[\s(;])/.test(l),
        );
        if (early < 0) return;
        const after = hooks.filter((i) => i > early);
        if (after.length) {
          violations.push(
            `${file}:${start + after[0] + 1}（提前返回在 ${start + early + 1} 行）`,
          );
        }
      });
    }
  }

  check('没有 Hook 写在提前返回之后', violations.length === 0,
    violations.join('; '));
}

section('多标签页面：刷新要停在原处');
{
  const { readFileSync } = await import('node:fs');

  // 刷新跳回第一个标签，是设置页最容易被察觉的毛病——
  // 「改一项 → 刷新验证 → 再改一项」正是这一页最常见的用法
  const PAGES = [
    ['options/App.tsx', 'tab'],
    ['history/App.tsx', 'tab'],
    ['wordbook/App.tsx', 'view'],
  ];
  for (const [file, param] of PAGES) {
    const src = readFileSync(file, 'utf8');
    check(`${file} 从 URL 读取初始${param}`,
      new RegExp(`URLSearchParams\\(location\\.search\\)[\\s\\S]{0,80}get\\('${param}'\\)`).test(src));
    check(`${file} 切换时写回 URL`,
      src.includes(`searchParams.set('${param}'`)
      && /history\.replaceState/.test(src));
    // pushState 会让切几次标签后要按很多下返回键才能离开这一页
    check(`${file} 用 replaceState 而不是 pushState`, !src.includes('history.pushState'));
  }
}

section('翻译并发：每引擎可配');
{
  const { resolveEngineConcurrency, ENGINE_CONCURRENCY, MAX_CONCURRENCY } =
    await import('../utils/translation-options.ts');

  check('没配过的引擎用建议值',
    resolveEngineConcurrency('google', {}) === ENGINE_CONCURRENCY.google.recommended);
  check('配过的引擎用自定义值', resolveEngineConcurrency('google', { google: 12 }) === 12);
  check('别的引擎不受影响',
    resolveEngineConcurrency('openai', { google: 12 }) === ENGINE_CONCURRENCY.openai.recommended);

  // 本机引擎不该被为公共免费接口设计的数字压着——限流是 API 服务方的事，
  // Ollama 的上限由显存和 OLLAMA_NUM_PARALLEL 决定
  check('Ollama 可以调到远高于建议值', resolveEngineConcurrency('ollama', { ollama: 24 }) === 24);
  check('Ollama 没有硬顶', ENGINE_CONCURRENCY.ollama.hardMax === undefined);

  // WebLLM 是浏览器里的单个模型实例，第二路只会排队——这是技术事实，不是礼貌限制
  check('WebLLM 恒为 1，调多少都一样', resolveEngineConcurrency('webllm', { webllm: 16 }) === 1);

  check('0 或负数回落到建议值',
    resolveEngineConcurrency('google', { google: 0 }) === ENGINE_CONCURRENCY.google.recommended
    && resolveEngineConcurrency('google', { google: -3 }) === ENGINE_CONCURRENCY.google.recommended);
  check('小数向下取整', resolveEngineConcurrency('google', { google: 7.9 }) === 7);
  check('手滑输入超大值被天花板挡住',
    resolveEngineConcurrency('google', { google: 99999 }) === MAX_CONCURRENCY);
  check('未知引擎也能得到一个可用值', resolveEngineConcurrency('nope', {}) >= 1);
  check('overrides 为 undefined 不炸', resolveEngineConcurrency('google', undefined) >= 1);

  check('每个引擎都写了建议理由',
    Object.values(ENGINE_CONCURRENCY).every((p) => p.note && p.recommended >= 1));

  // 解析逻辑必须只有一份：content script 和设置页各算一遍，
  // 迟早会在某次改动后分叉
  const { readFileSync } = await import('node:fs');
  const content = readFileSync('content/content.js', 'utf8');
  check('内容脚本复用共享的解析函数，不自己算',
    content.includes('resolveEngineConcurrency')
    && !content.includes('CONCURRENCY_LEVELS'));

  check('全页翻译可单独指定引擎', /fullPageEngine/.test(content));
  check('站点专属引擎优先级高于全页专用引擎',
    content.indexOf('stored.fullPageEngine') < content.indexOf('const siteEngine'));
}

section('剪贴板图片');
{
  const { readFileSync } = await import('node:fs');
  const { pickEvictions } = await import('../utils/image-store.js');

  const mk = (id, ts, pinned) => ({ id, timestamp: ts, pinned });
  const imgs = [mk('a', 5), mk('b', 4, true), mk('c', 3), mk('d', 2), mk('e', 1, true)];

  const doomed = pickEvictions(imgs, 3);
  check('超出上限时淘汰最旧的', doomed.length === 2);
  // 置顶就是为了留住它，被容量规则默默删掉是最难解释的一种数据丢失
  check('置顶的图片永不被淘汰', !doomed.includes('b') && !doomed.includes('e'));
  check('淘汰的是时间最早的非置顶项',
    doomed.includes('d') && doomed.includes('c'));
  check('未超上限时不淘汰', pickEvictions(imgs, 99).length === 0);
  check('上限为 0 表示不限制', pickEvictions(imgs, 0).length === 0);
  check('全是置顶时不淘汰任何一张',
    pickEvictions([mk('x', 1, true), mk('y', 2, true)], 1).length === 0);

  // 图片必须走 IndexedDB。塞进 clipboardHistory 数组的话，每复制一次**文字**
  // 都要把那几 MB 重新序列化写一遍——这是设计冲突，不是优化问题
  const textStore = readFileSync('utils/clipboard.js', 'utf8');
  check('文字剪贴板不碰 IndexedDB，也不存二进制',
    !textStore.includes('indexedDB') && !textStore.includes('Blob'));
  const imgStore = readFileSync('utils/image-store.js', 'utf8');
  check('图片走 IndexedDB，不进 storage.local',
    imgStore.includes('indexedDB') && !imgStore.includes('storage.local'));

  // 列表只读缩略图：三十张原图一次性进内存会让页面卡住
  check('列表查询把原图剔除掉', /\{ blob, \.\.\.meta \}/.test(imgStore));

  // 抓取必须在 Service Worker：内容脚本在宿主页面的源里，
  // 写进去的 IndexedDB 扩展页面读不到
  const bg = readFileSync('background/background.js', 'utf8');
  check('图片抓取在 Service Worker 里', bg.includes('saveImageFromUrl'));
  check('超过单张上限的图片不入库', /clipboardMaxImageBytes[\s\S]{0,200}throw new Error/.test(bg));

  // 浏览器剪贴板对图片只保证支持 image/png，JPEG 不转直接 write 会抛错
  const item = readFileSync('history/views/ImageItem.tsx', 'utf8');
  check('复制图片前把非 PNG 转成 PNG',
    item.includes("blob.type !== 'image/png'") && item.includes("'image/png'"));
  check('缩略图的 blob URL 会被撤销（否则翻几次列表就攒一堆）',
    item.includes('revokeObjectURL'));
}

section('剪贴板：容量裁剪与合并');
{
  const { trim } = await import('../utils/clipboard.js');
  const { mergeClipboard } = await import('../utils/github-sync.js');

  const mk = (id, ts, pinned) => ({ id, text: `t${id}`, timestamp: ts, pinned });
  const list = [mk('a', 5), mk('b', 4, true), mk('c', 3), mk('d', 2), mk('e', 1, true)];

  const trimmed = trim(list, 3);
  check('裁到上限', trimmed.length === 3);
  // 置顶就是为了留住它，被容量规则默默删掉是最难解释的一种数据丢失
  check('置顶的条目不会被裁掉',
    trimmed.some((e) => e.id === 'b') && trimmed.some((e) => e.id === 'e'));
  check('裁剪不打乱原有顺序',
    trimmed.map((e) => e.id).join('') === [...trimmed].map((e) => e.id).join(''));
  check('未超上限时原样返回', trim(list, 99).length === 5);
  check('上限为 0 表示不限制', trim(list, 0).length === 5);

  const merged = mergeClipboard([mk('a', 9), mk('x', 1)], [mk('a', 3), mk('y', 2)], 0);
  check('两端取并集', merged.length === 3);
  check('同 id 取时间较新的', merged.find((e) => e.id === 'a').timestamp === 9);
  check('结果按时间倒序', merged[0].id === 'a');

  // 置顶是用户的明确意图，同步把它抹掉比多留一个置顶更难解释
  const pinMerged = mergeClipboard([mk('a', 5)], [mk('a', 9, true)], 0);
  check('任一端置顶则合并后保持置顶', pinMerged[0].pinned === true);
}

// ── 商店发布 ────────────────────────────────────────────────────────────────
// 这些字段缺了不会影响本地运行，只在提交审核时才暴露——那时改一轮要等好几天
section('商店发布必备项');
{
  const { readFileSync, existsSync } = await import('node:fs');
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));

  for (const field of ['author', 'homepage_url', 'minimum_chrome_version', 'description']) {
    check(`manifest 有 ${field}`, !!manifest[field]);
  }
  // 商店的简短说明上限 132 字符，超了提交页直接不让过
  check('description 不超过 132 字符', (manifest.description || '').length <= 132,
    `当前 ${manifest.description?.length} 字符`);

  check('有 LICENSE 文件', existsSync('LICENSE'));
  check('有隐私政策', existsSync('docs/PRIVACY.md'));
  check('有提交材料清单', existsSync('docs/STORE-SUBMISSION.md'));

  // 商店对尺寸是严格的，差一个像素就传不上去
  const pngSizeOf = (f) => {
    const buf = readFileSync(f);
    return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
  };
  const ASSETS = [
    ['store-assets/store-icon-128.png', '128x128'],
    ['store-assets/promo-small-440x280.png', '440x280'],
  ];
  for (const [file, size] of ASSETS) {
    check(`${file} 存在`, existsSync(file));
    if (existsSync(file)) {
      check(`${file} 正好是 ${size}`, pngSizeOf(file) === size, `实际 ${pngSizeOf(file)}`);
    }
  }

  // 隐私政策必须覆盖所有实际会联网的目的地，否则审核对不上就是打回重来
  const privacy = readFileSync('docs/PRIVACY.md', 'utf8');
  const DESTINATIONS = [
    'translate.googleapis.com', 'api.mymemory.translated.net', 'lingva.ml',
    'libretranslate.com', 'api-free.deepl.com', 'api.openai.com',
    'generativelanguage.googleapis.com', 'api.anthropic.com', 'api.deepseek.com',
    'api.ocr.space', 'dict.youdao.com', 'translate.google.com',
  ];
  const missing = DESTINATIONS.filter((d) => !privacy.includes(d));
  check('隐私政策列全了所有对外域名', missing.length === 0,
    missing.length ? `漏了：${missing.join(', ')}` : '');

  // MV3 硬性要求：不得加载远程代码
  for (const f of ['utils/translator.js', 'utils/example-sentence.js', 'utils/tts.js']) {
    const src = readFileSync(f, 'utf8');
    check(`${f} 没有 eval / new Function`,
      !/\beval\s*\(|new Function\s*\(/.test(src));
  }

  // 打包脚本必须自检，否则源码搭车进发布包只能靠肉眼在上百个文件里发现
  const pkg = readFileSync('scripts/package.mjs', 'utf8');
  check('打包脚本会回查源码残留', pkg.includes('leaked') && pkg.includes('process.exit(1)'));
  check('打包脚本会回查 manifest 在根目录', pkg.includes("includes('manifest.json')"));
}

// ── 扩展图标 ────────────────────────────────────────────────────────────────
// 图标路径写错或尺寸对不上，Chrome 不会报错，只会显示一个默认的灰色拼图块
section('扩展图标');
{
  const { readFileSync, existsSync } = await import('node:fs');
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));

  /** 读 PNG 头里的宽高（IHDR 在固定偏移，不必引依赖） */
  const pngSize = (file) => {
    const buf = readFileSync(file);
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  };

  check('工具栏图标与扩展图标是同一组',
    JSON.stringify(manifest.icons) === JSON.stringify(manifest.action.default_icon));

  /**
   * PNG 有没有透明。两种合法形态都要认：
   * IHDR 第 25 字节的颜色类型 4/6 自带 alpha 通道；颜色类型 3（调色板）
   * 则靠 tRNS 块声明透明色——小图标常被优化成这种，只认 4/6 会误判。
   *
   * 这条不是形式主义：这次换图标的源文件就是 RGB 无 alpha 的，
   * 所谓"透明棋盘"是画进像素里的灰格子。直接用的话，网页上会出现
   * 一个灰方块，而 Chrome 不会有任何报错。
   */
  const hasAlpha = (file) => {
    const buf = readFileSync(file);
    return [4, 6].includes(buf[25]) || buf.includes(Buffer.from('tRNS'));
  };

  // Windows 工具栏取 32；缺了会拿 48 缩，比直接给一张 32 更糊
  for (const size of ['16', '32', '48', '128']) {
    const file = manifest.icons[size];
    check(`声明了 ${size}px 图标`, !!file);
    if (!file) continue;
    check(`${file} 存在`, existsSync(file));
    if (!existsSync(file)) continue;
    const { w, h } = pngSize(file);
    check(`${file} 实际就是 ${size}×${size}`, w === Number(size) && h === Number(size),
      `实际 ${w}×${h}`);
    check(`${file} 有透明通道`, hasAlpha(file));
  }

  // 划词触发图标走 web_accessible_resources，不内联进内容脚本：
  // 那段脚本注入每一个访问过的页面，一张 72px PNG 内联成 base64 要 7000 多字符
  const TRIGGER = 'icons/trigger.png';
  check(`${TRIGGER} 存在`, existsSync(TRIGGER));
  check(`${TRIGGER} 有透明通道`, existsSync(TRIGGER) && hasAlpha(TRIGGER));
  check('触发图标已声明为网页可访问资源',
    manifest.web_accessible_resources.some((r) => r.resources.includes(TRIGGER)));

  const sel = readFileSync('content/selection.js', 'utf8');
  check('划词图标通过 runtime.getURL 引用，没有内联成 data URI',
    sel.includes(`getURL('${TRIGGER}')`) && !/icon\.innerHTML = `<img src="data:/.test(sel));
}

// ── 例句译文 ────────────────────────────────────────────────────────────────
// collectWord 的 sentenceTranslation 从来没有调用方传过，于是从阅读抓到的
// 例句在词库里一直只有原句没有译文。语境例句是这个产品的差异点，缺一半没意义。
section('例句译文补全');
{
  let stored = {
    words: [{
      id: 'w1',
      word: 'ephemeral',
      meanings: [],
      examples: [
        { sentence: 'Fame is ephemeral.', origin: 'context', timestamp: 1 },
        { sentence: 'Already done.', translation: '已经有了', origin: 'ai', timestamp: 2 },
      ],
      source: 'ai',
      addedAt: 0,
    }],
  };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.map((k) => [k, stored[k]]));
        },
        set: async (patch) => { stored = { ...stored, ...patch }; },
      },
    },
    runtime: { sendMessage: async () => {} },
  };

  const { translateMissingExamples } = await import('../utils/example-sentence.js');

  const asked = [];
  const fakeTranslator = {
    translate: async (text) => { asked.push(text); return `【译】${text}`; },
  };
  await translateMissingExamples('ephemeral', fakeTranslator);

  const examples = stored.words[0].examples;
  check('缺译文的例句被补上', examples[0].translation === '【译】Fame is ephemeral.');
  check('已有译文的例句不被覆盖', examples[1].translation === '已经有了');
  check('已有译文的例句不白翻一次', !asked.includes('Already done.'));
  check('原句本身不被改动', examples[0].sentence === 'Fame is ephemeral.');

  // 引擎把英文识别成目标语言时会原样返回，那不是译文
  stored.words[0].examples = [{ sentence: 'Echo me.', origin: 'context', timestamp: 1 }];
  await translateMissingExamples('ephemeral', { translate: async (t) => t });
  check('原样返回的“译文”不写入', !stored.words[0].examples[0].translation);

  // 大小写不同的词也要能找到（collectWord 是大小写不敏感的）
  stored.words[0].examples = [{ sentence: 'Case test.', origin: 'context', timestamp: 1 }];
  await translateMissingExamples('Ephemeral', fakeTranslator);
  check('查词大小写不敏感', stored.words[0].examples[0].translation === '【译】Case test.');

  // 词已经被删了：不能抛，收藏流程不该被这一步搞崩
  stored.words = [];
  let threw = false;
  try { await translateMissingExamples('gone', fakeTranslator); } catch { threw = true; }
  check('词已被删时安静返回，不抛异常', !threw);
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
