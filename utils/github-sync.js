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

async function pushToGist(headers, gistId, list) {
  const content = JSON.stringify(list);
  if (!gistId) {
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
  const res = await fetch(`${API_BASE}/gists/${gistId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ files: { [GIST_FILENAME]: { content } } }),
  });
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
  const toWrite = attempt === 0 ? list : mergeHistories(list, remoteList);
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

export async function syncNow() {
  try {
    const { translationHistory: rawLocal = [] } = await chrome.storage.local.get('translationHistory');
    const local = rawLocal.map((e) => (e.id ? e : { ...e, id: crypto.randomUUID() }));
    const { historyMaxItems = 0 } = await chrome.storage.sync.get(pick('historyMaxItems'));

    const remote = await pullRemoteHistory();
    const merged = mergeHistories(local, remote);
    const localSlice = historyMaxItems > 0 ? merged.slice(0, historyMaxItems) : merged;

    await chrome.storage.local.set({ translationHistory: localSlice });
    await pushRemoteHistory(merged);
    await chrome.storage.local.set({ githubSyncStatus: { lastSyncAt: Date.now(), lastError: null } });
    return { ok: true };
  } catch (err) {
    await chrome.storage.local.set({ githubSyncStatus: { lastSyncAt: Date.now(), lastError: err.message } });
    return { ok: false, error: err.message };
  }
}
