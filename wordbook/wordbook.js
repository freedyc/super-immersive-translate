/**
 * Wordbook - Super Immersive Translate
 * Word list, flashcards, quiz, stats
 */
import { createIcons } from 'lucide';
import { icons } from '../utils/icons.js';
import { applyTheme, initThemeControl } from '../utils/theme.js';
import { createCard, scheduleNext, isDue, serializeCard, deserializeCard } from '../utils/srs.js';

(async function () {
  'use strict';

  let wordbook = [];
  let filteredWords = [];
  let currentView = 'review';
  let cardIndex = 0;
  let quizIndex = 0;
  let quizCorrect = 0;
  let quizTotal = 0;
  let quizWords = [];

  const ENGINE_NAMES = {
    google: 'Google', mymemory: 'MyMemory', lingva: 'Lingva',
    libre: 'Libre', deepl: 'DeepL', custom: 'Custom'
  };

  // ========== Init ==========
  async function loadWordbook() {
    const { wordbook: wb = [] } = await chrome.storage.local.get('wordbook');
    wordbook = wb;
    filteredWords = [...wordbook];
    render();
  }

  async function saveWordbook() {
    await chrome.storage.local.set({ wordbook });
  }

  // 后台自动同步可能在用户复习/浏览期间把远端合并结果写回 wordbook，如果不监听
  // 就会被内存里的旧快照在下次保存时覆盖掉。任何外部变更都重新读取 + 重渲染当前视图，
  // 顺带重新应用搜索框里已经输入的关键字，不会打断用户正在做的筛选。
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.wordbook) {
      wordbook = changes.wordbook.newValue || [];
      applySearchFilter();
      render();
    }
  });

  // ========== Navigation ==========
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const view = item.dataset.view;
      switchView(view);
    });
  });

  function switchView(view) {
    currentView = view;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector(`.nav-item[data-view="${view}"]`)?.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(view + 'View')?.classList.add('active');

    if (view === 'review') initReview();
    if (view === 'cards') initCards();
    if (view === 'quiz') initQuiz();
    if (view === 'stats') renderStats();
  }

  // ========== Search ==========
  function applySearchFilter() {
    const q = document.getElementById('searchInput').value.trim().toLowerCase();
    if (!q) {
      filteredWords = [...wordbook];
    } else {
      filteredWords = wordbook.filter(w =>
        w.text.toLowerCase().includes(q) ||
        Object.values(w.translations || {}).some(t => t.toLowerCase().includes(q))
      );
    }
  }

  document.getElementById('searchInput').addEventListener('input', () => {
    applySearchFilter();
    renderList();
  });

  // ========== Render ==========
  function render() {
    document.getElementById('wordCount').textContent = `${wordbook.length} 个单词`;
    document.getElementById('emptyState').style.display = wordbook.length === 0 ? 'flex' : 'none';
    renderList();
  }

  function renderList() {
    const container = document.getElementById('wordList');
    if (filteredWords.length === 0 && wordbook.length > 0) {
      container.innerHTML = '<div class="col-span-full text-center py-12 text-base-content/50"><p>没有匹配的单词</p></div>';
      return;
    }

    container.innerHTML = filteredWords.map((w, i) => {
      const translations = Object.entries(w.translations || {}).map(([engine, text]) =>
        `<div class="flex gap-2 items-baseline text-sm">
          <span class="badge badge-ghost badge-sm shrink-0">${ENGINE_NAMES[engine] || engine}</span>
          <span class="text-base-content/80">${escapeHtml(text)}</span>
        </div>`
      ).join('');

      const badge = getMasteryBadge(w);
      const status = `<span class="badge ${badge.cls} badge-sm">${badge.text}</span>`;

      const time = new Date(w.timestamp).toLocaleDateString('zh-CN');
      const source = w.url
        ? `<a href="${escapeHtml(w.url)}" target="_blank" class="link link-hover text-xs text-base-content/50" title="${escapeHtml(w.title || w.url)}">${escapeHtml(w.title || '来源页面')}</a>`
        : '';

      return `
        <div class="card bg-base-100 shadow word-card" data-index="${i}">
          <div class="card-body gap-2 p-4">
            <div class="flex items-start justify-between gap-2">
              <div class="font-bold text-lg text-base-content">${escapeHtml(w.text)}</div>
              <div class="flex gap-1 shrink-0">
                <button class="btn btn-ghost btn-xs delete-word" title="删除">
                  <i data-lucide="trash-2" class="w-4 h-4 text-error/60"></i>
                </button>
              </div>
            </div>
            <div class="flex flex-col gap-1">${translations}</div>
            <div class="flex items-center gap-2 mt-1">${status} <span class="text-xs text-base-content/40">${time}</span> ${source}</div>
          </div>
        </div>
      `;
    }).join('');
    createIcons({ icons });

    // Bind card events
    container.querySelectorAll('.delete-word').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = getCardIndex(e);
        if (idx < 0) return;
        const realIdx = wordbook.indexOf(filteredWords[idx]);
        wordbook.splice(realIdx, 1);
        filteredWords.splice(idx, 1);
        saveWordbook();
        render();
      });
    });
  }

  function getCardIndex(e) {
    const card = e.target.closest('.word-card');
    return card ? parseInt(card.dataset.index) : -1;
  }

  // ========== Flashcards ==========
  function initCards() {
    cardIndex = 0;
    renderCard();
  }

  function renderCard() {
    const flashcard = document.getElementById('flashcard');
    const words = wordbook.length > 0 ? wordbook : [];
    if (words.length === 0) {
      document.getElementById('cardWord').textContent = '没有单词';
      document.getElementById('cardTranslation').textContent = '';
      document.getElementById('cardSource').textContent = '';
      document.getElementById('cardProgress').textContent = '0 / 0';
      return;
    }

    cardIndex = Math.max(0, Math.min(cardIndex, words.length - 1));
    const w = words[cardIndex];
    const trans = Object.values(w.translations || {});

    flashcard.classList.remove('flipped');
    document.getElementById('cardWord').textContent = w.text;
    document.getElementById('cardTranslation').textContent = trans[0] || '无翻译';
    document.getElementById('cardSource').textContent = trans.length > 1
      ? trans.slice(1).join(' / ') : (w.title || '');
    document.getElementById('cardProgress').textContent = `${cardIndex + 1} / ${words.length}`;
  }

  document.getElementById('flashcard').addEventListener('click', () => {
    document.getElementById('flashcard').classList.toggle('flipped');
  });

  document.getElementById('cardPrev').addEventListener('click', () => {
    if (cardIndex > 0) { cardIndex--; renderCard(); }
  });

  document.getElementById('cardNext').addEventListener('click', () => {
    if (cardIndex < wordbook.length - 1) { cardIndex++; renderCard(); }
  });

  document.getElementById('cardShuffle').addEventListener('click', () => {
    // Fisher-Yates on a copy of indices
    cardIndex = Math.floor(Math.random() * wordbook.length);
    renderCard();
  });

  // ========== Review (FSRS) ==========
  function findWordByKey(key) {
    return wordbook.find(w => w.text.toLowerCase() === key);
  }

  function buildReviewQueue() {
    const now = new Date();
    const queue = [];
    wordbook.forEach((w) => {
      ['recall', 'recognition'].forEach((mode) => {
        const raw = w.srs?.[mode];
        const card = raw ? deserializeCard(raw) : null;
        if (isDue(card, now)) {
          queue.push({ key: w.text.toLowerCase(), mode });
        }
      });
    });
    shuffleInPlace(queue);
    return queue;
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  let reviewQueue = [];
  let reviewIndex = 0;

  function initReview() {
    reviewQueue = buildReviewQueue();
    reviewIndex = 0;
    renderReviewQuestion();
  }

  function renderReviewQuestion() {
    const dueCountEl = document.getElementById('reviewDueCount');
    const emptyEl = document.getElementById('reviewEmpty');
    const questionEl = document.getElementById('reviewQuestion');

    if (reviewIndex >= reviewQueue.length) {
      questionEl.style.display = 'none';
      emptyEl.style.display = 'flex';
      dueCountEl.textContent = '0';
      createIcons({ icons });
      return;
    }

    const item = reviewQueue[reviewIndex];
    const word = findWordByKey(item.key);
    if (!word) {
      // 复习队列生成之后、答到这道题之前，这个词被删掉了：跳过。
      reviewIndex++;
      renderReviewQuestion();
      return;
    }

    emptyEl.style.display = 'none';
    questionEl.style.display = '';
    dueCountEl.textContent = String(reviewQueue.length - reviewIndex);

    if (item.mode === 'recall') {
      renderRecallQuestion(word);
    } else {
      renderRecognitionQuestion(word);
    }
  }

  async function recordReviewResult(word, mode, grade) {
    const now = new Date();
    const raw = word.srs?.[mode];
    const card = raw ? deserializeCard(raw) : createCard(now);
    const nextCard = scheduleNext(card, grade, now);

    const idx = wordbook.findIndex(w => w.text.toLowerCase() === word.text.toLowerCase());
    if (idx >= 0) {
      wordbook[idx].srs = wordbook[idx].srs || {};
      wordbook[idx].srs[mode] = serializeCard(nextCard);
      await saveWordbook();
    }

    reviewIndex++;
    renderReviewQuestion();
  }

  document.getElementById('reviewLearnNewBtn').addEventListener('click', () => {
    const newQueue = [];
    wordbook.forEach((w) => {
      ['recall', 'recognition'].forEach((mode) => {
        if (!w.srs?.[mode]) newQueue.push({ key: w.text.toLowerCase(), mode });
      });
    });
    shuffleInPlace(newQueue);
    reviewQueue = newQueue;
    reviewIndex = 0;
    renderReviewQuestion();
  });

  function reviewSentenceHtml(word) {
    const ctx = word.contexts && word.contexts.length > 0 ? word.contexts[word.contexts.length - 1] : null;
    if (!ctx || !ctx.sentence) return '';
    return `<div class="text-sm text-base-content/50 italic mt-2">${escapeHtml(ctx.sentence)}</div>`;
  }

  function renderRecallQuestion(word) {
    const trans = Object.values(word.translations || {});
    const prompt = trans[0] || '???';
    document.getElementById('reviewQuestion').innerHTML = `
      <div class="card bg-base-100 shadow-sm rounded-xl mb-4">
        <div class="card-body gap-4">
          <div class="text-xl text-base-content/70 leading-relaxed">${escapeHtml(prompt)}</div>
          <input type="text" id="reviewRecallInput" class="input input-bordered text-center text-lg" placeholder="输入单词..." autocomplete="off" />
          <div id="reviewRecallFeedback" class="quiz-feedback text-base font-semibold min-h-6"></div>
          <div id="reviewRecallGrades" class="flex justify-center gap-2" style="display:none">
            <button class="btn btn-sm btn-outline" data-grade="hard">困难</button>
            <button class="btn btn-sm btn-outline" data-grade="good">记得</button>
            <button class="btn btn-sm btn-outline" data-grade="easy">简单</button>
          </div>
          ${reviewSentenceHtml(word)}
        </div>
      </div>
    `;

    const input = document.getElementById('reviewRecallInput');
    input.focus();

    function check() {
      const answer = input.value.trim().toLowerCase();
      const correct = word.text.toLowerCase();
      const feedback = document.getElementById('reviewRecallFeedback');
      input.disabled = true;

      if (answer === correct) {
        feedback.textContent = '✅ 正确！选一个难易度：';
        feedback.className = 'quiz-feedback correct';
        document.getElementById('reviewRecallGrades').style.display = 'flex';
      } else {
        feedback.textContent = `❌ 正确答案: ${word.text}`;
        feedback.className = 'quiz-feedback wrong';
        setTimeout(() => recordReviewResult(word, 'recall', 'again'), 900);
      }
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !input.disabled) check();
    });

    document.getElementById('reviewRecallGrades').querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => recordReviewResult(word, 'recall', btn.dataset.grade));
    });
  }

  function renderRecognitionQuestion(word) {
    const correctAnswer = Object.values(word.translations || {})[0] || '';
    const distractorPool = wordbook
      .filter(w => w.text.toLowerCase() !== word.text.toLowerCase())
      .map(w => Object.values(w.translations || {})[0])
      .filter(Boolean);
    const distractors = shuffleInPlace([...distractorPool]).slice(0, 3);
    const options = shuffleInPlace([correctAnswer, ...distractors].filter(Boolean));
    const correctIndex = options.indexOf(correctAnswer);

    document.getElementById('reviewQuestion').innerHTML = `
      <div class="card bg-base-100 shadow-sm rounded-xl mb-4">
        <div class="card-body gap-4">
          <div class="flex items-center justify-center gap-2">
            <div class="text-3xl font-bold">${escapeHtml(word.text)}</div>
            <button id="reviewSpeakBtn" class="btn btn-ghost btn-sm btn-circle" title="发音">
              <i data-lucide="volume-2" class="w-4 h-4"></i>
            </button>
          </div>
          <div class="flex flex-col gap-2" id="reviewOptions">
            ${options.map((opt, i) => `<button class="btn btn-outline justify-start" data-index="${i}">${escapeHtml(opt)}</button>`).join('')}
          </div>
          ${reviewSentenceHtml(word)}
        </div>
      </div>
    `;
    createIcons({ icons });

    const startedAt = Date.now();

    document.getElementById('reviewSpeakBtn').addEventListener('click', () => {
      window.ttsManager.speak(word.text, 'auto');
    });

    document.getElementById('reviewOptions').querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const elapsed = Date.now() - startedAt;
        const isCorrect = parseInt(btn.dataset.index, 10) === correctIndex;
        const optionButtons = document.getElementById('reviewOptions').querySelectorAll('button');
        optionButtons.forEach(b => { b.disabled = true; });
        btn.classList.add(isCorrect ? 'btn-success' : 'btn-error');
        if (!isCorrect) {
          const correctBtn = [...optionButtons].find(b => parseInt(b.dataset.index, 10) === correctIndex);
          correctBtn?.classList.add('btn-success');
        }

        let grade;
        if (!isCorrect) {
          grade = 'again';
        } else if (elapsed < 2000) {
          grade = 'easy';
        } else if (elapsed < 5000) {
          grade = 'good';
        } else {
          grade = 'hard';
        }

        setTimeout(() => recordReviewResult(word, 'recognition', grade), 700);
      });
    });
  }

  // ========== Quiz ==========
  function initQuiz() {
    quizCorrect = 0;
    quizTotal = 0;
    quizWords = [...wordbook].sort(() => Math.random() - 0.5);
    quizIndex = 0;
    document.getElementById('quizCorrect').textContent = '0';
    document.getElementById('quizTotal').textContent = '0';
    renderQuiz();
  }

  function renderQuiz() {
    const feedback = document.getElementById('quizFeedback');
    const input = document.getElementById('quizInput');
    const checkBtn = document.getElementById('quizCheck');
    const skipBtn = document.getElementById('quizSkip');
    const nextBtn = document.getElementById('quizNext');

    feedback.textContent = '';
    feedback.className = 'quiz-feedback';
    input.value = '';
    input.disabled = false;
    input.focus();
    checkBtn.style.display = '';
    skipBtn.style.display = '';
    nextBtn.style.display = 'none';

    if (quizWords.length === 0) {
      document.getElementById('quizPrompt').textContent = '没有单词可以测验';
      input.style.display = 'none';
      checkBtn.style.display = 'none';
      skipBtn.style.display = 'none';
      return;
    }

    input.style.display = '';
    quizIndex = quizIndex % quizWords.length;
    const w = quizWords[quizIndex];
    const trans = Object.values(w.translations || {});
    document.getElementById('quizPrompt').textContent = trans[0] || '???';
  }

  document.getElementById('quizCheck').addEventListener('click', checkQuiz);
  document.getElementById('quizInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') checkQuiz();
  });

  function checkQuiz() {
    if (quizWords.length === 0) return;
    const w = quizWords[quizIndex];
    const input = document.getElementById('quizInput');
    const feedback = document.getElementById('quizFeedback');
    const answer = input.value.trim().toLowerCase();
    const correct = w.text.toLowerCase();

    quizTotal++;
    input.disabled = true;

    if (answer === correct) {
      quizCorrect++;
      feedback.textContent = '✅ 正确！';
      feedback.className = 'quiz-feedback correct';
    } else {
      feedback.textContent = `❌ 正确答案: ${w.text}`;
      feedback.className = 'quiz-feedback wrong';
    }

    document.getElementById('quizCorrect').textContent = quizCorrect;
    document.getElementById('quizTotal').textContent = quizTotal;
    document.getElementById('quizCheck').style.display = 'none';
    document.getElementById('quizSkip').style.display = 'none';
    document.getElementById('quizNext').style.display = '';
  }

  document.getElementById('quizSkip').addEventListener('click', () => {
    quizIndex++;
    renderQuiz();
  });

  document.getElementById('quizNext').addEventListener('click', () => {
    quizIndex++;
    renderQuiz();
  });

  // ========== Stats ==========
  function renderStats() {
    const total = wordbook.length;
    const known = wordbook.filter(isMastered).length;
    const unknown = total - known;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const today = wordbook.filter(w => w.timestamp >= todayStart.getTime()).length;

    document.getElementById('statTotal').textContent = total;
    document.getElementById('statKnown').textContent = known;
    document.getElementById('statUnknown').textContent = unknown;
    document.getElementById('statToday').textContent = today;

    // Recent words (last 20)
    const recent = wordbook.slice(0, 20);
    document.getElementById('recentWords').innerHTML = recent.map(w =>
      `<span class="badge badge-outline">${escapeHtml(w.text)}</span>`
    ).join('');
  }

  // ========== Export / Import ==========
  document.getElementById('exportBtn').addEventListener('click', () => {
    const data = JSON.stringify(wordbook, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `super-translate-wordbook-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });

  document.getElementById('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      if (!Array.isArray(imported)) throw new Error('Invalid format');

      // Merge: skip duplicates
      const existing = new Set(wordbook.map(w => w.text.toLowerCase()));
      let added = 0;
      imported.forEach(w => {
        if (w.text && !existing.has(w.text.toLowerCase())) {
          wordbook.unshift(w);
          existing.add(w.text.toLowerCase());
          added++;
        }
      });

      await saveWordbook();
      filteredWords = [...wordbook];
      render();
      alert(`导入成功！新增 ${added} 个单词`);
    } catch (err) {
      alert('导入失败: ' + err.message);
    }
    e.target.value = '';
  });

  // ========== Clear All ==========
  document.getElementById('clearAllBtn').addEventListener('click', async () => {
    if (!confirm('确定要清空所有单词吗？此操作不可撤销。')) return;
    wordbook = [];
    filteredWords = [];
    await saveWordbook();
    render();
  });

  // ========== Utils ==========
  // 稳定性达到约 3 周（21 天）视为"已掌握"，这是一个可调阈值，不是 FSRS 算法本身规定的。
  const MASTERED_STABILITY_DAYS = 21;

  function isMastered(word) {
    const raw = word.srs?.recall;
    if (!raw || raw.reps === 0) return false;
    return deserializeCard(raw).stability >= MASTERED_STABILITY_DAYS;
  }

  function getMasteryBadge(word) {
    const raw = word.srs?.recall;
    if (!raw || raw.reps === 0) return { text: '未学习', cls: 'badge-ghost' };
    const card = deserializeCard(raw);
    if (card.stability >= MASTERED_STABILITY_DAYS) return { text: '已掌握', cls: 'badge-success' };
    if (isDue(card)) return { text: '待复习', cls: 'badge-warning' };
    return { text: '学习中', cls: 'badge-info' };
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  // ========== Keyboard shortcuts ==========
  document.addEventListener('keydown', (e) => {
    if (currentView === 'cards') {
      if (e.key === 'ArrowLeft') { cardIndex = Math.max(0, cardIndex - 1); renderCard(); }
      if (e.key === 'ArrowRight') { cardIndex = Math.min(wordbook.length - 1, cardIndex + 1); renderCard(); }
      if (e.key === ' ') { e.preventDefault(); document.getElementById('flashcard').classList.toggle('flipped'); }
    }
  });

  // ========== Start ==========
  await applyTheme();
  await initThemeControl(document.getElementById('themeControl'));
  await window.ttsManager.init();
  createIcons({ icons });
  await loadWordbook();

  const requestedView = new URLSearchParams(location.search).get('view');
  if (requestedView && document.getElementById(requestedView + 'View')) {
    switchView(requestedView);
  } else {
    switchView('review');
  }
})();
