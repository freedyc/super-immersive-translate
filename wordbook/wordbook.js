/**
 * Wordbook - Super Immersive Translate
 * Word list, flashcards, quiz, stats
 */
import { createIcons } from 'lucide';
import { icons } from '../utils/icons.js';
import { applyTheme, initThemeControl } from '../utils/theme.js';
import { createCard, scheduleNext, isDue, serializeCard, deserializeCard } from '../utils/srs.js';
import { Translator } from '../utils/translator.js';
import { generateExampleSentence } from '../utils/example-sentence.js';

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

    // 切换页签同步更新 URL，刷新页面时能回到刚才停留的那个页签，不会一律弹回"今日复习"
    const url = new URL(location.href);
    url.searchParams.set('view', view);
    history.replaceState(null, '', url);

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
      const percent = getMasteryPercent(w);
      const progressCls = percent >= 100 ? 'progress-success' : (badge.cls === 'badge-warning' ? 'progress-warning' : 'progress-primary');
      const posBadge = w.pos ? `<span class="badge badge-outline badge-sm">${escapeHtml(w.pos)}</span>` : '';
      const ipaText = w.ipa ? `<span class="text-xs text-base-content/40 font-mono">${escapeHtml(w.ipa)}</span>` : '';

      const time = new Date(w.timestamp).toLocaleDateString('zh-CN');
      const source = w.url
        ? `<a href="${escapeHtml(w.url)}" target="_blank" class="link link-hover text-xs text-base-content/50" title="${escapeHtml(w.title || w.url)}">${escapeHtml(w.title || '来源页面')}</a>`
        : '';

      const ctx = w.contexts && w.contexts.length > 0 ? w.contexts[w.contexts.length - 1] : null;
      const exampleHtml = ctx?.sentence ? `
        <div class="flex flex-col gap-1 mt-1 p-2 rounded-lg bg-base-200/50 text-xs">
          <div class="flex items-start gap-1.5">
            <span class="italic text-base-content/70 flex-1">${escapeHtml(ctx.sentence)}</span>
            <button class="example-speak btn btn-ghost btn-xs btn-circle shrink-0" data-lang="en-US" data-text="${escapeAttr(ctx.sentence)}" title="朗读例句">
              <i data-lucide="volume-2" class="w-3 h-3"></i>
            </button>
          </div>
          ${ctx.translation ? `
          <div class="flex items-start gap-1.5">
            <span class="text-base-content/50 flex-1">${escapeHtml(ctx.translation)}</span>
            <button class="example-speak btn btn-ghost btn-xs btn-circle shrink-0" data-lang="zh-CN" data-text="${escapeAttr(ctx.translation)}" title="朗读译文">
              <i data-lucide="volume-2" class="w-3 h-3"></i>
            </button>
          </div>` : ''}
        </div>
      ` : '';

      return `
        <div class="card bg-base-100 shadow rounded-xl hover:shadow-lg transition-shadow word-card" data-index="${i}">
          <div class="card-body gap-2 p-4">
            <div class="flex items-start justify-between gap-2">
              <div class="flex items-center gap-2">
                <div class="font-bold text-lg text-base-content">${escapeHtml(w.text)}</div>
                ${ipaText}
                ${posBadge}
              </div>
              <div class="flex gap-1 shrink-0">
                <button class="word-speak btn btn-ghost btn-xs btn-circle" title="发音">
                  <i data-lucide="volume-2" class="w-4 h-4"></i>
                </button>
                <button class="regenerate-word btn btn-ghost btn-xs btn-circle" title="AI 生成新例句 / 补全音标词性">
                  <i data-lucide="rotate-cw" class="w-4 h-4"></i>
                </button>
                <button class="btn btn-ghost btn-xs delete-word" title="删除">
                  <i data-lucide="trash-2" class="w-4 h-4 text-error/60"></i>
                </button>
              </div>
            </div>
            <div class="flex flex-col gap-1">${translations}</div>
            ${exampleHtml}
            <div class="flex items-center gap-2 mt-1">${status} <span class="text-xs text-base-content/40">${time}</span> ${source}</div>
            <div class="mt-1">
              <div class="flex justify-between text-[10px] text-base-content/40 mb-0.5">
                <span>掌握度</span><span>${percent}%</span>
              </div>
              <progress class="progress ${progressCls} w-full h-1.5" value="${percent}" max="100"></progress>
            </div>
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

    container.querySelectorAll('.word-speak').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = getCardIndex(e);
        if (idx < 0) return;
        window.ttsManager.speak(filteredWords[idx].text, 'auto');
      });
    });

    container.querySelectorAll('.example-speak').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.dataset.text) window.ttsManager.speak(btn.dataset.text, btn.dataset.lang);
      });
    });

    container.querySelectorAll('.regenerate-word').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const idx = getCardIndex(e);
        if (idx < 0) return;
        const word = filteredWords[idx];
        btn.disabled = true;
        btn.classList.add('animate-spin');
        try {
          const t = new Translator();
          await t.init();
          const generated = await generateExampleSentence(word.text, t);
          if (!generated) return;
          const realIdx = wordbook.indexOf(word);
          if (realIdx < 0) return;
          wordbook[realIdx].contexts = [...(wordbook[realIdx].contexts || []), {
            sentence: generated.sentence,
            translation: generated.translation,
            tokens: generated.tokens,
            url: null,
            title: 'AI 生成',
            timestamp: Date.now(),
            source: 'ai'
          }];
          if (generated.pos && !wordbook[realIdx].pos) wordbook[realIdx].pos = generated.pos;
          if (generated.ipa && !wordbook[realIdx].ipa) wordbook[realIdx].ipa = generated.ipa;
          await saveWordbook();
          render();
        } finally {
          btn.disabled = false;
          btn.classList.remove('animate-spin');
        }
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
      document.getElementById('cardIpa').textContent = '';
      document.getElementById('cardPos').textContent = '';
      document.getElementById('cardTranslation').textContent = '';
      document.getElementById('cardSource').textContent = '';
      document.getElementById('cardProgress').textContent = '0 / 0';
      document.getElementById('cardExample').innerHTML = '';
      return;
    }

    cardIndex = Math.max(0, Math.min(cardIndex, words.length - 1));
    const w = words[cardIndex];
    const trans = Object.values(w.translations || {});

    flashcard.classList.remove('flipped');
    document.getElementById('cardWord').textContent = w.text;
    document.getElementById('cardIpa').textContent = w.ipa || '';
    document.getElementById('cardPos').textContent = w.pos || '';
    document.getElementById('cardPos').style.display = w.pos ? '' : 'none';
    document.getElementById('cardTranslation').textContent = trans[0] || '无翻译';
    document.getElementById('cardSource').textContent = trans.length > 1
      ? trans.slice(1).join(' / ') : (w.title || '');
    document.getElementById('cardProgress').textContent = `${cardIndex + 1} / ${words.length}`;
    document.getElementById('cardExample').innerHTML = cardExampleHtml(w);
  }

  function cardExampleHtml(word) {
    const ctx = word.contexts && word.contexts.length > 0 ? word.contexts[word.contexts.length - 1] : null;
    if (!ctx || !ctx.sentence) return '';
    const translationLine = ctx.translation
      ? `<div class="text-xs text-base-content/40 mt-1">${escapeHtml(ctx.translation)}</div>` : '';
    return `
      <div>${renderTaggedSentenceChips(ctx.sentence, ctx.tokens)}</div>
      ${translationLine}
    `;
  }

  // 词类 → daisyUI badge 语义色，10 个词类复用 8 种语义色（部分虚词共用同一色）
  const POS_BADGE_CLASS = {
    '名词': 'badge-primary', '代词': 'badge-neutral', '动词': 'badge-secondary',
    '形容词': 'badge-accent', '副词': 'badge-info', '介词': 'badge-neutral',
    '连词': 'badge-neutral', '感叹词': 'badge-warning', '冠词': 'badge-neutral',
    '限定词': 'badge-neutral',
  };

  // 把 tokens（{text, pos}[]）渲染成按词类上色的词块序列（悬浮显示中文词类名）。
  // 没有 tokens（比如真实抓取的例句，没经过 AI 标注）就退回纯文本展示。
  function renderTaggedSentenceChips(sentence, tokens) {
    if (!tokens || tokens.length === 0) return `<span class="italic">${escapeHtml(sentence)}</span>`;
    const chips = tokens
      .filter(tok => tok?.text)
      .map(tok => `<span class="badge ${POS_BADGE_CLASS[tok.pos] || 'badge-neutral'} badge-sm align-middle" title="${escapeAttr(tok.pos || '')}">${escapeHtml(tok.text)}</span>`)
      .join('');
    return `<span class="inline-flex flex-wrap gap-1 items-center">${chips}</span>`;
  }

  document.getElementById('flashcard').addEventListener('click', () => {
    document.getElementById('flashcard').classList.toggle('flipped');
  });

  document.getElementById('cardSpeakBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const words = wordbook.length > 0 ? wordbook : [];
    const w = words[cardIndex];
    if (w) window.ttsManager.speak(w.text, 'auto');
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
      const hasTranslation = Object.values(w.translations || {}).some(Boolean);
      ['recall', 'recognition'].forEach((mode) => {
        if (mode === 'recognition' && !hasTranslation) return; // 没有翻译的词无法出选择题，只能出拼写题
        const raw = w.srs?.[mode];
        if (!raw) return; // 还没学过的词只能通过"学新词"按钮进入，不会自动出现在今日复习里
        const card = deserializeCard(raw);
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
  let pendingGradeTimer = null;

  function initReview() {
    if (pendingGradeTimer) { clearTimeout(pendingGradeTimer); pendingGradeTimer = null; }
    reviewQueue = buildReviewQueue();
    reviewIndex = 0;
    renderReviewQuestion();
  }

  function renderReviewQuestion() {
    const dueCountEl = document.getElementById('reviewDueCount');
    const progressRing = document.getElementById('reviewProgressRing');
    const emptyEl = document.getElementById('reviewEmpty');
    const questionEl = document.getElementById('reviewQuestion');

    if (reviewIndex >= reviewQueue.length) {
      questionEl.style.display = 'none';
      emptyEl.style.display = 'flex';
      dueCountEl.textContent = '0';
      progressRing.style.setProperty('--value', 100);
      hideGrammarSidebar();
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
    progressRing.style.setProperty('--value', Math.round((reviewIndex / reviewQueue.length) * 100));

    if (item.mode === 'recall') {
      renderRecallQuestion(word);
    } else {
      renderRecognitionQuestion(word);
    }
  }

  async function recordReviewResult(word, mode, grade) {
    const now = new Date();
    // 不要相信传入的 word 参数里的 srs 字段：后台同步可能在用户答题期间把
    // wordbook 整个替换成新数组（新对象引用），word 闭包里存的仍是旧对象。
    // 必须先用 findIndex 定位到当前（可能已被同步更新过的）数组里的真实位置，
    // 后续读写都基于这个实时位置，避免用过时的 FSRS 状态覆盖刚合并进来的新状态。
    const idx = wordbook.findIndex(w => w.text.toLowerCase() === word.text.toLowerCase());
    if (idx < 0) {
      // 复习中途这个词被删掉了：跳过，不写入任何东西。
      reviewIndex++;
      renderReviewQuestion();
      return;
    }

    const raw = wordbook[idx].srs?.[mode];
    const card = raw ? deserializeCard(raw) : createCard(now);
    const nextCard = scheduleNext(card, grade, now);

    wordbook[idx].srs = wordbook[idx].srs || {};
    wordbook[idx].srs[mode] = serializeCard(nextCard);
    await saveWordbook();

    reviewIndex++;
    renderReviewQuestion();
  }

  document.getElementById('reviewLearnNewBtn').addEventListener('click', () => {
    const newQueue = [];
    wordbook.forEach((w) => {
      const hasTranslation = Object.values(w.translations || {}).some(Boolean);
      ['recall', 'recognition'].forEach((mode) => {
        if (mode === 'recognition' && !hasTranslation) return; // 没有翻译的词无法出选择题，只能出拼写题
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
    const translationLine = ctx.translation
      ? `<div class="text-xs text-base-content/40 mt-1">${escapeHtml(ctx.translation)}</div>` : '';
    return `
      <div class="text-sm mt-2">${renderTaggedSentenceChips(ctx.sentence, ctx.tokens)}</div>
      ${translationLine}
    `;
  }

  // 语法角色拆解侧栏——按 tokens 里的 role 字段分组展示（跟词性是两个维度，
  // role 是这个词在这句话里当的成分）。旧数据/没生成过 role 的例句直接不显示，不留空壳。
  const ROLE_ORDER = ['主语', '谓语', '宾语', '定语', '状语', '补语', '其他'];
  function renderGrammarSidebarHtml(word) {
    const ctx = word.contexts && word.contexts.length > 0 ? word.contexts[word.contexts.length - 1] : null;
    const tokens = ctx?.tokens;
    if (!tokens || !tokens.some(t => t.role)) return '';
    const groups = {};
    tokens.forEach((t) => {
      if (!t.role) return;
      (groups[t.role] = groups[t.role] || []).push(t.text);
    });
    const rows = ROLE_ORDER
      .filter((role) => groups[role]?.length)
      .map((role) => `
        <div class="flex items-start gap-2 py-1.5 border-b border-base-200 last:border-0">
          <span class="badge badge-outline badge-sm shrink-0 w-14 justify-center">${escapeHtml(role)}</span>
          <span class="text-sm text-base-content/70">${escapeHtml(groups[role].join(' / '))}</span>
        </div>
      `).join('');
    if (!rows) return '';
    return `
      <div class="card bg-base-100 shadow-sm rounded-xl">
        <div class="card-body p-4 gap-1">
          <h3 class="text-xs font-bold uppercase tracking-wide text-base-content/40 mb-1">语法拆解</h3>
          ${rows}
        </div>
      </div>
    `;
  }

  function updateGrammarSidebar(word) {
    const el = document.getElementById('reviewGrammarHint');
    if (!el) return;
    const html = renderGrammarSidebarHtml(word);
    el.innerHTML = html;
    el.style.display = html ? '' : 'none';
  }

  function hideGrammarSidebar() {
    const el = document.getElementById('reviewGrammarHint');
    if (el) el.style.display = 'none';
  }

  function renderRecallQuestion(word) {
    hideGrammarSidebar(); // 答题前不能提前展示——语法拆解里会带出要默写的这个词本身
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
          <div id="reviewRecallExample"></div>
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
      // 例句本身就包含要默写的这个词，答题前显示等于直接给答案，所以延到判分之后才揭晓
      document.getElementById('reviewRecallExample').innerHTML = reviewSentenceHtml(word);
      updateGrammarSidebar(word);

      if (answer === correct) {
        feedback.textContent = '✅ 正确！选一个难易度：';
        feedback.className = 'quiz-feedback correct';
        document.getElementById('reviewRecallGrades').style.display = 'flex';
      } else {
        feedback.textContent = `❌ 正确答案: ${word.text}`;
        feedback.className = 'quiz-feedback wrong';
        pendingGradeTimer = setTimeout(() => recordReviewResult(word, 'recall', 'again'), 900);
      }
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !input.disabled) check();
    });

    document.getElementById('reviewRecallGrades').querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('reviewRecallGrades').querySelectorAll('button').forEach((b) => { b.disabled = true; });
        recordReviewResult(word, 'recall', btn.dataset.grade);
      });
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
    updateGrammarSidebar(word); // 识别题单词本身已经明摆着显示了，不存在剧透问题，直接展示

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

        pendingGradeTimer = setTimeout(() => recordReviewResult(word, 'recognition', grade), 700);
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

  function getMasteryPercent(word) {
    const raw = word.srs?.recall;
    if (!raw || raw.reps === 0) return 0;
    return Math.min(100, Math.round((deserializeCard(raw).stability / MASTERED_STABILITY_DAYS) * 100));
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  // escapeHtml 走 textContent/innerHTML 往返，不转义双引号，放进 HTML 属性值前要额外处理
  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
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
