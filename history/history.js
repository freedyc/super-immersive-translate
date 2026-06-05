/**
 * Translation History Page - Super Immersive Translate
 */
import { createIcons } from 'lucide';
import { icons } from '../utils/icons.js';
import { applyTheme, initThemeControl } from '../utils/theme.js';

(async function () {
  'use strict';

  let history = [];
  let filtered = [];

  async function loadHistory() {
    const { translationHistory = [] } = await chrome.storage.local.get('translationHistory');
    history = translationHistory;
    filtered = [...history];
    render();
  }

  async function saveHistory() {
    await chrome.storage.local.set({ translationHistory: history });
  }

  function render() {
    document.getElementById('countLabel').textContent = `${history.length} 条记录`;
    document.getElementById('emptyState').style.display = history.length === 0 ? 'flex' : 'none';
    renderList();
    createIcons({ icons });
  }

  function renderList() {
    const container = document.getElementById('historyList');
    if (filtered.length === 0 && history.length > 0) {
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-12 text-base-content/50">
          <i data-lucide="search-x" class="w-10 h-10 mb-3 text-base-content/30"></i>
          <p class="text-sm">没有匹配的记录</p>
        </div>`;
      createIcons({ icons });
      return;
    }

    container.innerHTML = filtered.map((item, i) => {
      const time = formatTime(item.timestamp);
      const source = item.url
        ? `<a href="${esc(item.url)}" target="_blank" title="${esc(item.url)}" class="link link-primary">${esc(item.title || '来源页面')}</a>`
        : '';

      return `
        <div class="card bg-base-100 shadow-sm history-card" data-index="${i}">
          <div class="card-body p-4 gap-2">
            <div class="flex items-start justify-between gap-3">
              <span class="font-medium text-base-content text-sm leading-relaxed break-words flex-1">${esc(item.text)}</span>
              <button class="btn btn-ghost btn-xs history-delete shrink-0" title="删除">
                <i data-lucide="x" class="w-3.5 h-3.5"></i>
              </button>
            </div>
            <div class="text-sm text-secondary leading-relaxed break-words">${esc(item.translation || '')}</div>
            <div class="flex flex-wrap items-center gap-2 text-xs text-base-content/50">
              ${item.engine ? `<span class="badge badge-ghost badge-sm">${esc(item.engine)}</span>` : ''}
              <span>${time}</span>
              ${source}
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.history-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const card = e.target.closest('.history-card');
        const idx = parseInt(card.dataset.index);
        const realIdx = history.indexOf(filtered[idx]);
        if (realIdx >= 0) history.splice(realIdx, 1);
        filtered.splice(idx, 1);
        saveHistory();
        render();
      });
    });

    createIcons({ icons });
  }

  // Search
  document.getElementById('searchInput').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) {
      filtered = [...history];
    } else {
      filtered = history.filter(item =>
        (item.text || '').toLowerCase().includes(q) ||
        (item.translation || '').toLowerCase().includes(q)
      );
    }
    renderList();
  });

  // Clear all
  document.getElementById('clearBtn').addEventListener('click', async () => {
    if (!confirm('确定要清空所有翻译历史吗？')) return;
    history = [];
    filtered = [];
    await saveHistory();
    render();
  });

  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  await applyTheme();
  await initThemeControl(document.getElementById('themeControl'));
  createIcons({ icons });

  await loadHistory();
})();
