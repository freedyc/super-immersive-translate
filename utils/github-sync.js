// GitHub 同步：只负责"读远端 / 写远端 / 合并"，不做调度决策（调度在 background）。
import { pick } from './defaults.js';
import { decryptEnvelope, encryptEnvelope, isEnvelope, unwrapDek } from './crypto.js';
import { getPassphrase } from './secrets.js';
import { trim as trimClipboard } from './clipboard.js';
// 2.1 学习数据的合并逻辑写在 TypeScript 里：这个文件历史上最常见的 bug 就是
// 新增字段忘了加进合并函数、同步一次字段就被静默丢掉（pos / ipa 都发生过），
// 显式字段 + 类型检查能把这类问题挡在编译期。
import { mergeWords, mergeLearningRecords } from './learning/syncMerge.ts';
import { migrateWordbook } from './learning/migrate.ts';

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

async function pushToRepo(headers, target, list, mergeFn, commitMessage, attempt = 0) {
  const { list: remoteList, sha } = await pullFromRepo(headers, target);
  // 每次尝试都要与刚拉到的远端最新内容合并（而不仅在重试时），否则并发同步会互相覆盖，
  // 且大概率不会命中 409（因为用的就是最新 sha），下面的冲突重试保护也就形同虚设。
  // await：加密同步的合并要先解密，是异步的。await 一个非 Promise 无副作用，
  // 现有的同步 mergeFn 照常工作
  const toWrite = await mergeFn(list, remoteList);
  const body = {
    message: commitMessage,
    content: toBase64(JSON.stringify(toWrite)),
    branch: target.branch,
  };
  if (sha) body.sha = sha;
  const res = await fetch(
    `${API_BASE}/repos/${target.owner}/${target.repo}/contents/${encodeURIComponent(target.path)}`,
    { method: 'PUT', headers, body: JSON.stringify(body) }
  );
  if (res.status === 409 && attempt === 0) {
    return pushToRepo(headers, target, list, mergeFn, commitMessage, attempt + 1);
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

async function pushRemoteFile(gistFilename, repoPath, mergeFn, list, commitMessage) {
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
    }, list, mergeFn, commitMessage);
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
  return pushRemoteFile(HISTORY_GIST_FILENAME, githubRepoPath, mergeHistories, list, 'Update translation history');
}

// 为缺失 id 的旧记录计算确定性 id：内容不变则无论回填多少次、在哪个执行上下文回填，
// 算出来的 id 都完全一样，天然避免"同一条记录被回填出两个不同随机 id 导致重复"的问题，
// 不再需要依赖"回填后抢先写回 storage"这种时序技巧。
async function computeLegacyId(entry) {
  const key = `${entry.text}|${entry.translation}|${entry.engine}|${entry.timestamp}`;
  const data = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `legacy-${hex}`;
}

async function backfillIds(rawList) {
  return Promise.all(rawList.map(async (e) => (e.id ? e : { ...e, id: await computeLegacyId(e) })));
}

export function mergeHistories(local, remote) {
  const byId = new Map();
  [...remote, ...local].forEach((entry) => {
    if (entry?.id) byId.set(entry.id, entry);
  });
  return Array.from(byId.values()).sort((a, b) => b.timestamp - a.timestamp);
}

const WORDBOOK_GIST_FILENAME = 'wordbook.json';
const WORDBOOK_REPO_PATH = 'wordbook.json';

// contexts 数组按 sentence+url 去重取并集：每条上下文是独立的"捕获事件"，
// 不是会演变的状态，两边各自收集的都要保留，不能"新覆盖旧"。
function mergeContexts(a = [], b = []) {
  const seen = new Map();
  [...a, ...b].forEach((ctx) => {
    if (!ctx?.sentence) return;
    const key = `${ctx.sentence}|${ctx.url || ''}`;
    if (!seen.has(key)) seen.set(key, ctx);
  });
  return Array.from(seen.values());
}

// srs 是"模式名 -> FSRSCard"的开放字典：按 key 遍历合并，某个 key 只在一边存在时
// 直接取那一边；两边都有同一个 key 时，取 last_review 较新的那一整张卡（不拆开卡内部
// 字段合并，因为 FSRS 的 difficulty/stability 等字段彼此关联，混着来会破坏算法的假设）。
// 这条"字典型字段按 key 合并、每个 key 内部整体取更优先一方"的约定，供以后任何新增的
// 字典型字段（比如未来的听力模式）复用，不需要每次新增字段都重新设计一遍合并规则。
function mergeSrs(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const result = {};
  keys.forEach((mode) => {
    const cardA = a[mode];
    const cardB = b[mode];
    if (!cardA) { result[mode] = cardB; return; }
    if (!cardB) { result[mode] = cardA; return; }
    const tsA = cardA.last_review ? new Date(cardA.last_review).getTime() : 0;
    const tsB = cardB.last_review ? new Date(cardB.last_review).getTime() : 0;
    result[mode] = tsA >= tsB ? cardA : cardB;
  });
  return result;
}

export function mergeWordbook(local, remote) {
  const byText = new Map();
  // remote 在前、local 在后：同一个 key 第二次出现时（一定是 local）该次的字段优先，
  // 从而实现"本地同引擎覆盖远端"的约定；known/timestamp 用哪边都一样
  // （|| 和 Math.min 本身顺序无关）。
  // id 字段是唯一的例外：取 prior（远端）优先，而不是本地优先。id 不参与任何展示/业务逻辑，
  // 只用于去重；一旦"本地优先"，两台设备互推时 id 会在两个随机值之间来回切换——内容完全没变
  // 也会产生一次无意义的 commit/版本变更。远端优先能让 id 在第一次推送后收敛、不再变化。
  [...remote, ...local].forEach((entry) => {
    // 远端文件可能被手动编辑成畸形数据（缺 text 或整条为 null），跳过而不是让 toLowerCase() 抛异常。
    const key = entry?.text?.toLowerCase();
    if (!key) return;
    const prior = byText.get(key);
    if (!prior) {
      byText.set(key, entry);
      return;
    }
    const priorTs = prior.timestamp ?? Infinity;
    const entryTs = entry.timestamp ?? Infinity;
    const minTs = Math.min(priorTs, entryTs);
    byText.set(key, {
      id: prior.id || entry.id,
      text: prior.text,
      translations: { ...prior.translations, ...entry.translations },
      known: prior.known || entry.known,
      timestamp: minTs === Infinity ? Date.now() : minTs,
      url: entry.url || prior.url,
      title: entry.title || prior.title,
      pos: entry.pos || prior.pos,
      ipa: entry.ipa || prior.ipa,
      contexts: mergeContexts(prior.contexts, entry.contexts),
      srs: mergeSrs(prior.srs, entry.srs),
    });
  });
  return Array.from(byText.values()).sort((a, b) => b.timestamp - a.timestamp);
}

// 单词本按 text 去重，id 不参与去重判断，所以旧条目回填 id 不需要像历史记录那样用
// 确定性哈希——哪怕两次独立读取给同一个单词生成了两个不同的随机 id，mergeWordbook
// 依然会按 text 把它们合并成一条（id 字段取远端那个，减少无意义的重复推送），
// 不会重现历史记录同步踩过的坑。
function backfillWordbookIds(rawList) {
  return rawList.map((e) => (e.id ? e : { ...e, id: crypto.randomUUID() }));
}

async function pullRemoteWordbook() {
  return pullRemoteFile(WORDBOOK_GIST_FILENAME, WORDBOOK_REPO_PATH);
}

async function pushRemoteWordbook(list) {
  return pushRemoteFile(WORDBOOK_GIST_FILENAME, WORDBOOK_REPO_PATH, mergeWordbook, list, 'Update wordbook');
}

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

// ── 2.1 学习数据同步（words + learningRecords）────────────────────────────────
//
// 与旧的 wordbook.json 并存，按「本地是否已迁移」二选一：
//   未迁移 → 继续同步 wordbook.json（旧行为，不破坏现有用户）
//   已迁移 → 同步 wordbook-v2.json
// 两者不同时推送：双写等于两个真源，一旦不一致就没法判断谁对。
//
// ⚠️ 已知限制：如果用户有多台设备且版本不一致（A 已升级、B 还在旧版），
// A 写 v2 文件、B 写旧文件，两边不会互相看见。这是有意的取舍——双写会让
// 本就微妙的三方合并复杂度翻倍。升级时建议把所有设备一起升。
const LEARNING_GIST_FILENAME = 'wordbook-v2.json';
const LEARNING_REPO_PATH = 'wordbook-v2.json';

/** 把远端拉回来的任意内容规整成 v2 载荷：文件不存在时原语返回的是 []，不是对象 */
function normalizeLearningPayload(raw) {
  if (raw && !Array.isArray(raw) && raw.version === 2) {
    return {
      version: 2,
      words: Array.isArray(raw.words) ? raw.words : [],
      records: Array.isArray(raw.records) ? raw.records : [],
    };
  }
  return { version: 2, words: [], records: [] };
}

function mergeLearningPayload(local, remote) {
  const a = normalizeLearningPayload(local);
  const b = normalizeLearningPayload(remote);
  return {
    version: 2,
    words: mergeWords(a.words, b.words),
    records: mergeLearningRecords(a.records, b.records),
  };
}

/** 本地是否已经迁移到 2.1 的数据结构 */
async function hasMigratedLocally() {
  const { words, learningRecords } = await chrome.storage.local.get(['words', 'learningRecords']);
  return (Array.isArray(words) && words.length > 0)
    || (Array.isArray(learningRecords) && learningRecords.length > 0);
}

async function readLocalLearning() {
  const { words = [], learningRecords = [] } = await chrome.storage.local.get([
    'words', 'learningRecords',
  ]);
  return {
    version: 2,
    words: Array.isArray(words) ? words : [],
    records: Array.isArray(learningRecords) ? learningRecords : [],
  };
}

async function syncLearningNow() {
  const local = await readLocalLearning();

  let remote = normalizeLearningPayload(
    await pullRemoteFile(LEARNING_GIST_FILENAME, LEARNING_REPO_PATH)
  );

  // 远端还没有 v2 文件（对端设备尚未升级，或首次在新设备上同步）：
  // 回退去读旧的 wordbook.json 并就地迁移，避免升级后远端历史数据看起来"消失"
  if (remote.words.length === 0 && remote.records.length === 0) {
    const legacyRemote = await pullRemoteWordbook();
    if (Array.isArray(legacyRemote) && legacyRemote.length > 0) {
      const migrated = migrateWordbook(legacyRemote, local.records);
      remote = { version: 2, words: migrated.words, records: migrated.records };
    }
  }

  const merged = mergeLearningPayload(local, remote);

  // 防竞态：拉取期间（网络往返，可能几秒）用户可能又学了几个词，
  // 写回前重新读一次最新快照再合并一次，否则会用旧快照覆盖这段时间的新进度
  const latest = await readLocalLearning();
  const final = mergeLearningPayload(latest, merged);

  await chrome.storage.local.set({ words: final.words, learningRecords: final.records });
  await pushRemoteFile(
    LEARNING_GIST_FILENAME, LEARNING_REPO_PATH,
    mergeLearningPayload, final, 'Update learning data'
  );
}

async function syncWordbookNow() {
  // 仓库模式下，历史记录的路径是用户在设置里自定义的 githubRepoPath；单词本固定用
  // WORDBOOK_REPO_PATH（'wordbook.json'）。如果两者恰好相同，会导致历史和单词本
  // 用两套不同的合并函数读写同一个仓库文件，互相破坏对方数据，必须提前拦截。
  const { githubSyncTargetType, githubRepoPath } = await chrome.storage.sync.get(
    pick('githubSyncTargetType', 'githubRepoPath')
  );
  if (githubSyncTargetType === 'repo'
      && (githubRepoPath === WORDBOOK_REPO_PATH || githubRepoPath === LEARNING_REPO_PATH)) {
    throw new Error(
      `仓库路径与单词本同步文件（${WORDBOOK_REPO_PATH} / ${LEARNING_REPO_PATH}）冲突，`
      + '请修改「同步载体」里的仓库文件路径设置'
    );
  }

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

// 进行中标记：防抖闹钟和周期闹钟可能前后脚触发，避免两次 syncNow 并发跑（并发跑会互相踩读-改-写窗口）。
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
      // 已迁移到 2.1 数据结构的走新路径，否则维持旧行为——
      // 这样本批只加能力、不改变尚未迁移用户的同步表现
      if (await hasMigratedLocally()) {
        await syncLearningNow();
      } else {
        await syncWordbookNow();
      }
    }

    const { githubSyncClipboard, githubSyncSettings } = await chrome.storage.sync.get(
      pick('githubSyncClipboard', 'githubSyncSettings'),
    );
    if (githubSyncSettings) await syncSettingsNow();
    if (githubSyncClipboard) await syncClipboardNow();

    await chrome.storage.local.set({ githubSyncStatus: { lastSyncAt: Date.now(), lastError: null } });
    return { ok: true, error: null };
  } catch (err) {
    await chrome.storage.local.set({ githubSyncStatus: { lastSyncAt: Date.now(), lastError: err.message } });
    return { ok: false, error: err.message };
  } finally {
    syncInFlight = false;
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// 剪贴板历史同步（端到端加密）
//
// 剪贴板里可能有任何东西，明文推到 GitHub 等于把它交给 GitHub。所以这条链路
// 有一条不可协商的规则：**没有口令就不同步**，绝不退化成明文上传。
// ─────────────────────────────────────────────────────────────────────────────

const CLIPBOARD_GIST_FILENAME = 'clipboard.enc.json';
const CLIPBOARD_REPO_PATH = 'clipboard.enc.json';

/**
 * 口令存在 storage.local 而不是 storage.sync。
 * sync 会同步到 Google 账号——把解密口令跟密文分别交给两家云厂商，
 * 也就谈不上端到端加密了。代价是换设备要重新输入一次，这是应该付的代价。
 */
async function getClipboardPassphrase() {
  // 全扩展只有一个口令（utils/secrets.js 是唯一出入口）。
  // 剪贴板同步和 API Key 加密共用它——让用户为同一件事记两个口令没有道理
  return getPassphrase();
}

/**
 * 合并两端的剪贴板记录。
 *
 * 按 id 取并集；同 id 取时间较新的一条。置顶状态只要有一边置顶就保留——
 * 置顶是用户的明确意图，同步把它抹掉比多留一个置顶更难解释。
 */
export function mergeClipboard(local = [], remote = [], maxItems = 0) {
  const byId = new Map();
  for (const entry of [...remote, ...local]) {
    if (!entry?.id) continue;
    const prev = byId.get(entry.id);
    if (!prev) { byId.set(entry.id, { ...entry }); continue; }
    const newer = (entry.timestamp || 0) > (prev.timestamp || 0) ? entry : prev;
    byId.set(entry.id, { ...newer, pinned: !!(prev.pinned || entry.pinned) });
  }
  const merged = [...byId.values()].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return trimClipboard(merged, maxItems);
}

async function syncClipboardNow() {
  const passphrase = await getClipboardPassphrase();
  if (!passphrase) {
    throw new Error('剪贴板同步需要先设置加密口令——没有口令不会上传，以免明文外泄');
  }

  const { clipboardMaxItems } = await chrome.storage.sync.get(pick('clipboardMaxItems'));
  const { clipboardHistory: local = [] } = await chrome.storage.local.get('clipboardHistory');

  // 远端可能是空的（首次同步）、也可能是别的设备写的密文
  const remoteRaw = await pullRemoteFile(CLIPBOARD_GIST_FILENAME, CLIPBOARD_REPO_PATH)
    .catch(() => null);

  // 复用远端信封里的数据密钥：换口令时 rewrap 保持数据密文不变，
  // 若这里每次新生成 DEK，远端历史密文又会变成解不开的
  let dek;
  if (isEnvelope(remoteRaw) && remoteRaw.v === 2) {
    dek = await unwrapDek(remoteRaw, passphrase).catch(() => undefined);
  }

  let remote = [];
  if (isEnvelope(remoteRaw)) {
    // 口令不对时**不要**用本地数据覆盖远端：那会把另一台设备的记录全删掉。
    // 让错误冒上去，用户看到的是"口令不对"，而不是数据悄悄消失
    remote = await decryptEnvelope(remoteRaw, passphrase);
  } else if (Array.isArray(remoteRaw) && remoteRaw.length > 0) {
    throw new Error('远端剪贴板文件不是本扩展加密的格式，已停止同步以免覆盖它');
  }

  const merged = mergeClipboard(local, Array.isArray(remote) ? remote : [], clipboardMaxItems);
  await chrome.storage.local.set({ clipboardHistory: merged });

  await pushRemoteFile(
    CLIPBOARD_GIST_FILENAME, CLIPBOARD_REPO_PATH,
    // 推送时再与刚拉到的远端合一次（应对 409 重试），同样要先解密
    async (mine, remoteAtPush) => {
      let theirs = [];
      if (isEnvelope(remoteAtPush)) theirs = await decryptEnvelope(remoteAtPush, passphrase);
      const final = mergeClipboard(mine, Array.isArray(theirs) ? theirs : [], clipboardMaxItems);
      return encryptEnvelope(final, passphrase, dek);
    },
    merged,
    'Update clipboard (encrypted)',
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// 设置同步
//
// 让你不必依赖 Chrome 的 Google 账号同步：设置走你自己的 Gist/仓库。
// API Key 以密文形式随行；**加密口令永远不上传**——口令跟密文一起走，
// 加密就没有意义了。所以换设备时口令要手动输一次，这是应该付的代价。
// ─────────────────────────────────────────────────────────────────────────────

const SETTINGS_GIST_FILENAME = 'settings.json';
const SETTINGS_REPO_PATH = 'settings.json';

/**
 * 这些键不参与同步：
 *  - githubGistId 是同步载体自身的地址，同步它会把两台设备指到同一个 gist 上打架
 *  - 明文密钥键一律不上传；密钥只以 secretsEnc 密文形式随行
 */
const SETTINGS_EXCLUDE = new Set([
  'githubGistId',
  'openaiKey', 'deepseekKey', 'geminiKey', 'claudeKey',
  'deeplKey', 'customApiKey', 'githubToken', 'githubOAuthAccessToken',
]);

async function readLocalSettings() {
  const all = await chrome.storage.sync.get(null);
  const out = {};
  for (const [k, v] of Object.entries(all)) {
    if (!SETTINGS_EXCLUDE.has(k)) out[k] = v;
  }
  return { version: 1, updatedAt: Date.now(), settings: out };
}

/**
 * 合并两端设置：整体按 updatedAt 取较新的一份。
 *
 * 不做逐键合并——设置之间是有关联的（引擎和它的模型、地址是一组），
 * 逐键取新会拼出两边都没有过的组合，比"以某一端为准"更难排查。
 */
export function mergeSettings(local, remote) {
  const l = local?.settings ? local : { updatedAt: 0, settings: {} };
  const r = remote?.settings ? remote : { updatedAt: 0, settings: {} };
  return (r.updatedAt || 0) > (l.updatedAt || 0) ? r : l;
}

async function syncSettingsNow() {
  const local = await readLocalSettings();
  const remote = await pullRemoteFile(SETTINGS_GIST_FILENAME, SETTINGS_REPO_PATH)
    .catch(() => null);

  const winner = mergeSettings(local, Array.isArray(remote) ? null : remote);
  if (winner !== local && winner.settings) {
    // 远端更新：写回本地，但同样不碰被排除的那些键
    const patch = {};
    for (const [k, v] of Object.entries(winner.settings)) {
      if (!SETTINGS_EXCLUDE.has(k)) patch[k] = v;
    }
    await chrome.storage.sync.set(patch);
  }

  await pushRemoteFile(
    SETTINGS_GIST_FILENAME, SETTINGS_REPO_PATH,
    (mine, theirs) => mergeSettings(mine, Array.isArray(theirs) ? null : theirs),
    winner,
    'Update settings',
  );
}
