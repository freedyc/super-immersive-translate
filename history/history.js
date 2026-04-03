/**
 * Translation History Page - Super Immersive Translate
 */
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
    document.getElementById('emptyState').style.display = history.length === 0 ? 'block' : 'none';
    renderList();
  }

  function renderList() {
    const container = document.getElementById('historyList');
    if (filtered.length === 0 && history.length > 0) {
      container.innerHTML = '<div class="empty-state"><p>没有匹配的记录</p></div>';
      return;
    }

    container.innerHTML = filtered.map((item, i) => {
      const time = formatTime(item.timestamp);
      const source = item.url
        ? `<a href="${esc(item.url)}" target="_blank" title="${esc(item.url)}">${esc(item.title || '来源页面')}</a>`
        : '';

      return `
        <div class="history-card" data-index="${i}">
          <div class="history-header">
            <span class="history-text">${esc(item.text)}</span>
            <button class="history-delete" title="删除">✕</button>
          </div>
          <div class="history-translation">${esc(item.translation || '')}</div>
          <div class="history-meta">
            <span class="history-engine">${esc(item.engine || '')}</span>
            <span class="history-time">${time}</span>
            ${source}
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

  await loadHistory();
})();
