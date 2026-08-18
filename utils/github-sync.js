// GitHub 同步：只负责"读远端 / 写远端 / 合并"，不做调度决策（调度在 background）。
import { pick } from './defaults.js';

const API_BASE = 'https://api.github.com';
const GIST_FILENAME = 'translation-history.json';

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

async function pullFromGist(headers, gistId) {
  if (!gistId) return { list: [] };
  const res = await fetch(`${API_BASE}/gists/${gistId}`, { headers });
  if (res.status === 404) return { list: [] };
  if (!res.ok) throw new Error(`读取 Gist 失败: HTTP ${res.status}`);
  const data = await res.json();
  const file = data.files?.[GIST_FILENAME];
  const list = file?.content ? JSON.parse(file.content) : [];
  return { list };
}

async function createGist(headers, content) {
  const res = await fetch(`${API_BASE}/gists`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      description: 'Super Immersive Translate - 翻译历史同步',
      public: false,
      files: { [GIST_FILENAME]: { content } },
    }),
  });
  if (!res.ok) throw new Error(`创建 Gist 失败: HTTP ${res.status}`);
  const data = await res.json();
  return data.id;
}

async function pushToGist(headers, gistId, list) {
  const content = JSON.stringify(list);
  if (!gistId) {
    return createGist(headers, content);
  }
  const res = await fetch(`${API_BASE}/gists/${gistId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ files: { [GIST_FILENAME]: { content } } }),
  });
  if (res.status === 404) {
    // 远端 gist 被用户手动删除：视为空远端，创建一个新 gist 顶替，调用方会把新 id 回填到设置里。
    return createGist(headers, content);
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

async function pushToRepo(headers, target, list, attempt = 0) {
  const { list: remoteList, sha } = await pullFromRepo(headers, target);
  // 每次尝试都要与刚拉到的远端最新内容合并（而不仅在重试时），否则并发同步会互相覆盖，
  // 且大概率不会命中 409（因为用的就是最新 sha），下面的冲突重试保护也就形同虚设。
  const toWrite = mergeHistories(list, remoteList);
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
    return pushToRepo(headers, target, list, attempt + 1);
  }
  if (!res.ok) throw new Error(`写入仓库文件失败: HTTP ${res.status}`);
}

export async function pullRemoteHistory() {
  const settings = await chrome.storage.sync.get(pick(
    'githubSyncTargetType', 'githubGistId',
    'githubRepoOwner', 'githubRepoName', 'githubRepoBranch', 'githubRepoPath'
  ));
  const headers = await getAuthHeaders();
  if (settings.githubSyncTargetType === 'repo') {
    const { list } = await pullFromRepo(headers, {
      owner: settings.githubRepoOwner,
      repo: settings.githubRepoName,
      branch: settings.githubRepoBranch,
      path: settings.githubRepoPath,
    });
    return list;
  }
  const { list } = await pullFromGist(headers, settings.githubGistId);
  return list;
}

export async function pushRemoteHistory(list) {
  const settings = await chrome.storage.sync.get(pick(
    'githubSyncTargetType', 'githubGistId',
    'githubRepoOwner', 'githubRepoName', 'githubRepoBranch', 'githubRepoPath'
  ));
  const headers = await getAuthHeaders();
  if (settings.githubSyncTargetType === 'repo') {
    await pushToRepo(headers, {
      owner: settings.githubRepoOwner,
      repo: settings.githubRepoName,
      branch: settings.githubRepoBranch,
      path: settings.githubRepoPath,
    }, list);
    return;
  }
  const gistId = await pushToGist(headers, settings.githubGistId, list);
  if (gistId !== settings.githubGistId) {
    await chrome.storage.sync.set({ githubGistId: gistId });
  }
}

export function mergeHistories(local, remote) {
  const byId = new Map();
  [...remote, ...local].forEach((entry) => {
    if (entry?.id) byId.set(entry.id, entry);
  });
  return Array.from(byId.values()).sort((a, b) => b.timestamp - a.timestamp);
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
    const { translationHistory: rawLocal = [] } = await chrome.storage.local.get('translationHistory');
    const local = rawLocal.map((e) => (e.id ? e : { ...e, id: crypto.randomUUID() }));
    const { historyMaxItems = 0 } = await chrome.storage.sync.get(pick('historyMaxItems'));

    const remote = await pullRemoteHistory();
    const merged = mergeHistories(local, remote);

    // pullRemoteHistory() 期间（网络请求，可能几秒）本地可能又通过 saveHistoryEntry 写入了新记录。
    // 写回本地前重新读一次最新快照并再合并一次，避免用"读取时的旧快照"覆盖掉这段时间内的新写入，
    // 同时把这份最新数据一并推送到远端，避免新记录永远没被同步出去。
    const { translationHistory: latestRawLocal = [] } = await chrome.storage.local.get('translationHistory');
    const latestLocal = latestRawLocal.map((e) => (e.id ? e : { ...e, id: crypto.randomUUID() }));
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
