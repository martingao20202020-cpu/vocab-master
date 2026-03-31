// =============================================
// VocabMaster - Main Application
// =============================================

(function () {
  'use strict';

  // ---- Storage Keys ----
  const KEYS = {
    words: 'vm_words',
    reviews: 'vm_reviews',
    stats: 'vm_stats',
    settings: 'vm_settings'
  };

  // ---- SM-2 Spaced Repetition ----
  const SM2 = {
    defaultReview() {
      return { interval: 0, ef: 2.5, reps: 0, nextReview: Date.now(), lastReview: null, status: 'new' };
    },
    calculate(review, quality) {
      const r = { ...review };
      r.lastReview = Date.now();
      if (quality < 3) {
        r.reps = 0;
        r.interval = 1;
        r.status = 'learning';
      } else {
        r.reps += 1;
        if (r.reps === 1) r.interval = 1;
        else if (r.reps === 2) r.interval = 3;
        else r.interval = Math.round(r.interval * r.ef);
        r.ef = Math.max(1.3, r.ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
        r.status = r.interval >= 21 ? 'mastered' : r.reps >= 2 ? 'reviewing' : 'learning';
      }
      r.nextReview = Date.now() + r.interval * 86400000;
      return r;
    },
    getIntervalText(review, quality) {
      const r = this.calculate({ ...review }, quality);
      if (r.interval < 1) return '< 1天';
      if (r.interval === 1) return '1天';
      if (r.interval < 30) return r.interval + '天';
      if (r.interval < 365) return Math.round(r.interval / 30) + '个月';
      return Math.round(r.interval / 365) + '年';
    }
  };

  // ---- State ----
  let state = {
    words: [],
    reviews: {},
    stats: { streak: 0, lastStudyDate: null, totalReviews: 0, dailyLog: {} },
    settings: { autoPlay: true, ttsSpeed: 0.9, dailyNewWords: 10 },
    currentView: 'home',
    reviewQueue: [],
    reviewIndex: 0,
    reviewResults: { total: 0, correct: 0, wrong: 0 },
    isFlipped: false,
    editingWordId: null
  };

  // ---- Init ----
  function init() {
    loadState();
    initBuiltinWords();
    updateGreeting();
    updateStreak();
    bindEvents();
    navigateTo('home');
    updateDashboard();
  }

  function loadState() {
    try {
      const w = localStorage.getItem(KEYS.words);
      const r = localStorage.getItem(KEYS.reviews);
      const s = localStorage.getItem(KEYS.stats);
      const st = localStorage.getItem(KEYS.settings);
      if (w) state.words = JSON.parse(w);
      if (r) state.reviews = JSON.parse(r);
      if (s) state.stats = { ...state.stats, ...JSON.parse(s) };
      if (st) state.settings = { ...state.settings, ...JSON.parse(st) };
    } catch (e) { console.error('Load error:', e); }
  }

  function saveState() {
    try {
      localStorage.setItem(KEYS.words, JSON.stringify(state.words));
      localStorage.setItem(KEYS.reviews, JSON.stringify(state.reviews));
      localStorage.setItem(KEYS.stats, JSON.stringify(state.stats));
      localStorage.setItem(KEYS.settings, JSON.stringify(state.settings));
    } catch (e) { console.error('Save error:', e); }
  }

  function initBuiltinWords() {
    if (typeof BUILTIN_WORDS === 'undefined') return;
    const existingWords = new Set(state.words.map(w => w.word.toLowerCase()));
    BUILTIN_WORDS.forEach(bw => {
      if (!existingWords.has(bw.word.toLowerCase())) {
        const id = 'w_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        state.words.push({ id, ...bw, addedAt: Date.now() });
        state.reviews[id] = SM2.defaultReview();
      }
    });
    saveState();
  }

  // ---- Navigation ----
  function navigateTo(view) {
    state.currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const viewEl = document.getElementById('view-' + view);
    const navEl = document.querySelector(`.nav-item[data-view="${view}"]`);
    if (viewEl) viewEl.classList.add('active');
    if (navEl) navEl.classList.add('active');

    if (view === 'home') updateDashboard();
    else if (view === 'words') renderWordList();
    else if (view === 'stats') renderStats();
    else if (view === 'add') renderAddView();
    else if (view === 'review') prepareReview();
  }

  // ---- Greeting ----
  function updateGreeting() {
    const h = new Date().getHours();
    let g = '晚上好 🌙';
    if (h < 6) g = '夜深了 🌃';
    else if (h < 12) g = '早上好 ☀️';
    else if (h < 14) g = '中午好 🌤️';
    else if (h < 18) g = '下午好 🌅';
    document.getElementById('greeting-text').textContent = g;
  }

  // ---- Streak ----
  function updateStreak() {
    const today = new Date().toDateString();
    if (state.stats.lastStudyDate === today) return;
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    if (state.stats.lastStudyDate === yesterday) {
      // streak continues
    } else if (state.stats.lastStudyDate !== today) {
      state.stats.streak = 0;
    }
  }

  function recordStudyToday() {
    const today = new Date().toDateString();
    if (state.stats.lastStudyDate !== today) {
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      if (state.stats.lastStudyDate === yesterday || state.stats.lastStudyDate === today) {
        state.stats.streak += 1;
      } else {
        state.stats.streak = 1;
      }
      state.stats.lastStudyDate = today;
    }
    const dateKey = new Date().toISOString().split('T')[0];
    state.stats.dailyLog[dateKey] = (state.stats.dailyLog[dateKey] || 0) + 1;
    state.stats.totalReviews += 1;
    saveState();
  }

  // ---- Dashboard ----
  function getDueWords() {
    const now = Date.now();
    return state.words.filter(w => {
      const r = state.reviews[w.id];
      return r && r.nextReview <= now;
    });
  }

  function updateDashboard() {
    const due = getDueWords();
    const mastered = state.words.filter(w => state.reviews[w.id]?.status === 'mastered').length;
    document.getElementById('stat-streak').textContent = state.stats.streak;
    const todayKey = new Date().toISOString().split('T')[0];
    document.getElementById('stat-today').textContent = state.stats.dailyLog[todayKey] || 0;
    document.getElementById('stat-mastered').textContent = mastered;
    document.getElementById('stat-total').textContent = state.words.length;

    const reviewBtn = document.getElementById('btn-start-review');
    const reviewCount = document.getElementById('review-count');
    const badge = document.getElementById('nav-review-badge');
    reviewCount.textContent = due.length + ' 词待复习';
    if (due.length > 0) {
      reviewBtn.disabled = false;
      badge.style.display = 'flex';
      badge.textContent = due.length;
    } else {
      reviewBtn.disabled = true;
      badge.style.display = 'none';
    }

    // Recent words
    const recentList = document.getElementById('recent-words-list');
    const recent = [...state.words].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 5);
    if (recent.length === 0) {
      recentList.innerHTML = '<div class="empty-state"><p>还没有添加单词，点击 ➕ 开始添加</p></div>';
    } else {
      recentList.innerHTML = recent.map(w => {
        const r = state.reviews[w.id];
        const statusClass = r ? r.status : 'new';
        return `<div class="word-mini-card" data-word-id="${w.id}">
          <div class="word-info">
            <span class="word-text">${w.word}</span>
            <span class="word-pos">${w.pos || ''}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="word-meaning">${w.defZh || ''}</span>
            <span class="mastery-dot ${statusClass}"></span>
          </div>
        </div>`;
      }).join('');
    }
  }

  // ---- Review System ----
  function prepareReview() {
    const due = getDueWords();
    if (due.length === 0) {
      document.getElementById('flashcard-area').style.display = 'none';
      document.getElementById('rating-buttons').style.display = 'none';
      document.getElementById('review-complete').style.display = 'none';
      document.getElementById('review-progress-text').textContent = '暂无待复习单词';
      return;
    }
    state.reviewQueue = due.sort(() => Math.random() - 0.5);
    state.reviewIndex = 0;
    state.reviewResults = { total: 0, correct: 0, wrong: 0 };
    showCurrentCard();
  }

  function showCurrentCard() {
    if (state.reviewIndex >= state.reviewQueue.length) {
      showReviewComplete();
      return;
    }
    const w = state.reviewQueue[state.reviewIndex];
    const total = state.reviewQueue.length;
    state.isFlipped = false;

    document.getElementById('flashcard-area').style.display = 'block';
    document.getElementById('review-complete').style.display = 'none';

    const flashcard = document.getElementById('flashcard');
    flashcard.classList.remove('flipped');

    document.getElementById('review-progress-text').textContent = `${state.reviewIndex + 1} / ${total}`;
    document.getElementById('review-progress-fill').style.width = ((state.reviewIndex / total) * 100) + '%';

    document.getElementById('fc-word').textContent = w.word;
    document.getElementById('fc-phonetic').textContent = w.phonetic || '';
    document.getElementById('fc-pos').textContent = w.pos || '';

    // Build back of card
    const back = document.getElementById('fc-back');
    back.innerHTML = buildCardBack(w);

    // Update interval previews
    const review = state.reviews[w.id] || SM2.defaultReview();
    document.getElementById('interval-again').textContent = SM2.getIntervalText(review, 0);
    document.getElementById('interval-hard').textContent = SM2.getIntervalText(review, 3);
    document.getElementById('interval-good').textContent = SM2.getIntervalText(review, 4);
    document.getElementById('interval-easy').textContent = SM2.getIntervalText(review, 5);

    document.getElementById('rating-buttons').style.display = 'none';
  }

  function buildCardBack(w) {
    let html = '';
    if (w.roots) {
      html += `<div class="fc-back-section">
        <div class="fc-back-label"><span class="label-icon">📌</span> 词根分析</div>
        <div class="fc-root-analysis">${w.roots}</div>
      </div>`;
    }
    html += `<div class="fc-back-section">
      <div class="fc-back-label"><span class="label-icon">📖</span> 释义</div>
      <div class="fc-definition">
        <div class="fc-def-en">${w.defEn || ''}</div>
        <div class="fc-def-zh">${w.defZh || ''}</div>
      </div>
    </div>`;
    if (w.mnemonic) {
      html += `<div class="fc-back-section">
        <div class="fc-back-label"><span class="label-icon">💡</span> 记忆方法</div>
        <div class="fc-mnemonic">${w.mnemonic}</div>
      </div>`;
    }
    if (w.exampleEn) {
      const highlighted = w.exampleEn.replace(new RegExp(`(${w.word})`, 'gi'), '<span class="highlight-word">$1</span>');
      html += `<div class="fc-back-section">
        <div class="fc-back-label"><span class="label-icon">📝</span> 例句</div>
        <div class="fc-example">
          <div class="fc-example-en">${highlighted}</div>
          ${w.exampleZh ? `<div class="fc-example-zh">${w.exampleZh}</div>` : ''}
        </div>
      </div>`;
    }
    if (w.synonyms?.length || w.antonyms?.length) {
      html += `<div class="fc-back-section">
        <div class="fc-back-label"><span class="label-icon">🔗</span> 关联词</div>
        <div class="fc-synonyms">
          ${(w.synonyms || []).map(s => `<span class="fc-synonym-tag">${s}</span>`).join('')}
          ${(w.antonyms || []).map(a => `<span class="fc-antonym-tag">${a}</span>`).join('')}
        </div>
      </div>`;
    }
    return html;
  }

  function flipCard() {
    const flashcard = document.getElementById('flashcard');
    state.isFlipped = !state.isFlipped;
    flashcard.classList.toggle('flipped', state.isFlipped);
    if (state.isFlipped) {
      document.getElementById('rating-buttons').style.display = 'grid';
      if (state.settings.autoPlay) pronounceWord(state.reviewQueue[state.reviewIndex]?.word);
    } else {
      document.getElementById('rating-buttons').style.display = 'none';
    }
  }

  function rateWord(quality) {
    const w = state.reviewQueue[state.reviewIndex];
    if (!w) return;
    const review = state.reviews[w.id] || SM2.defaultReview();
    state.reviews[w.id] = SM2.calculate(review, quality);
    state.reviewResults.total++;
    if (quality >= 3) state.reviewResults.correct++;
    else state.reviewResults.wrong++;
    recordStudyToday();
    state.reviewIndex++;
    showCurrentCard();
  }

  function showReviewComplete() {
    document.getElementById('flashcard-area').style.display = 'none';
    document.getElementById('rating-buttons').style.display = 'none';
    document.getElementById('review-complete').style.display = 'block';
    document.getElementById('rc-total').textContent = state.reviewResults.total;
    document.getElementById('rc-correct').textContent = state.reviewResults.correct;
    document.getElementById('rc-wrong').textContent = state.reviewResults.wrong;
    document.getElementById('review-progress-fill').style.width = '100%';
    saveState();
  }

  // ---- TTS ----
  // Preferred female voice names (iOS/macOS/Windows/Android)
  const FEMALE_VOICES = [
    'samantha', 'karen', 'moira', 'tessa', 'fiona', 'victoria',
    'allison', 'ava', 'susan', 'zira', 'hazel', 'linda',
    'kate', 'serena', 'martha', 'catherine',
    'google us english', 'google uk english female',
    'female', 'woman'
  ];
  const MALE_VOICES = [
    'daniel', 'alex', 'fred', 'tom', 'david', 'mark',
    'james', 'lee', 'oliver', 'ralph', 'albert',
    'google uk english male', 'male', 'man'
  ];

  function pickBestVoice(voices) {
    const enVoices = voices.filter(v => v.lang && v.lang.startsWith('en'));
    if (enVoices.length === 0) return null;

    // Score each voice: higher = better
    let best = null, bestScore = -999;
    for (const v of enVoices) {
      let score = 0;
      const name = v.name.toLowerCase();

      // Strong prefer known female voices
      if (FEMALE_VOICES.some(f => name.includes(f))) score += 100;
      // Penalize known male voices
      if (MALE_VOICES.some(m => name.includes(m))) score -= 100;

      // Prefer en-US
      if (v.lang === 'en-US') score += 10;
      // Prefer enhanced/premium voices
      if (name.includes('enhanced') || name.includes('premium') || name.includes('compact')) score += 5;
      // Prefer non-default (iOS specific higher quality voices)
      if (!v.default) score += 1;

      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }
    return best;
  }

  function pronounceWord(word) {
    if (!word || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    u.rate = state.settings.ttsSpeed || 0.9;
    u.pitch = 1.05; // Slightly higher pitch for a softer tone

    const voices = window.speechSynthesis.getVoices();
    const voice = pickBestVoice(voices);
    if (voice) u.voice = voice;

    const btn = document.querySelector('.btn-pronounce');
    if (btn) btn.classList.add('playing');
    u.onend = () => { if (btn) btn.classList.remove('playing'); };
    u.onerror = () => { if (btn) btn.classList.remove('playing'); };
    window.speechSynthesis.speak(u);
  }

  // ---- Add Word ----
  function renderAddView() {
    document.getElementById('word-detail-form').classList.remove('visible');
    document.getElementById('word-search-input').value = '';
    document.getElementById('search-suggestions').classList.remove('visible');
    renderSuggestions();
  }

  async function searchWord(query) {
    if (!query || query.length < 2) {
      document.getElementById('search-suggestions').classList.remove('visible');
      return;
    }
    const sugEl = document.getElementById('search-suggestions');
    // Search in local DB first
    const localMatches = state.words.filter(w => w.word.toLowerCase().startsWith(query.toLowerCase()));
    // Search in builtin (not yet added)
    const builtinMatches = (typeof BUILTIN_WORDS !== 'undefined' ? BUILTIN_WORDS : [])
      .filter(w => w.word.toLowerCase().startsWith(query.toLowerCase()) &&
                   !state.words.find(sw => sw.word.toLowerCase() === w.word.toLowerCase()));

    let html = '';
    localMatches.forEach(w => {
      html += `<div class="suggestion-item" data-action="view" data-word-id="${w.id}">
        <div><span class="sug-word">${w.word}</span> <span style="color:var(--text-muted);font-size:12px;">(已添加)</span></div>
        <span class="sug-meaning">${w.defZh || ''}</span>
      </div>`;
    });
    builtinMatches.forEach(w => {
      html += `<div class="suggestion-item" data-action="add-builtin" data-word="${w.word}">
        <div><span class="sug-word">${w.word}</span></div>
        <span class="sug-meaning">${w.defZh || ''}</span>
      </div>`;
    });

    // Option to look up online
    if (!localMatches.find(w => w.word.toLowerCase() === query.toLowerCase())) {
      html += `<div class="suggestion-item" data-action="lookup" data-word="${query}">
        <div><span class="sug-word">${query}</span> <span style="color:var(--secondary);font-size:12px;">🔍 在线查询</span></div>
        <span class="sug-meaning">从词典获取释义</span>
      </div>`;
    }

    sugEl.innerHTML = html;
    sugEl.classList.toggle('visible', html.length > 0);
  }

  // ---- Word Root Analysis Engine ----
  const ROOT_DB = {
    prefixes: [
      { p: 'anti', m: '反对 against', zh: '反' },
      { p: 'auto', m: '自己 self', zh: '自' },
      { p: 'bene', m: '好 good/well', zh: '好' },
      { p: 'bi', m: '二/双 two', zh: '双' },
      { p: 'circum', m: '环绕 around', zh: '环绕' },
      { p: 'co', m: '共同 together', zh: '共' },
      { p: 'com', m: '共同 together', zh: '共' },
      { p: 'con', m: '共同/加强 together', zh: '共/加强' },
      { p: 'contra', m: '相反 against', zh: '反' },
      { p: 'counter', m: '相反 against', zh: '反' },
      { p: 'de', m: '向下/去除 down/away', zh: '向下/去除' },
      { p: 'dis', m: '不/分开 not/apart', zh: '不/分开' },
      { p: 'em', m: '使 make/put in', zh: '使' },
      { p: 'en', m: '使 make/put in', zh: '使' },
      { p: 'epi', m: '在...上 upon', zh: '在...上' },
      { p: 'ex', m: '出/超出 out', zh: '出' },
      { p: 'extra', m: '超越 beyond', zh: '超越' },
      { p: 'fore', m: '前 before', zh: '前' },
      { p: 'hyper', m: '超过 over/above', zh: '超' },
      { p: 'il', m: '不 not', zh: '不' },
      { p: 'im', m: '不/进入 not/into', zh: '不/进入' },
      { p: 'in', m: '不/进入 not/into', zh: '不/进入' },
      { p: 'inter', m: '之间 between', zh: '之间' },
      { p: 'ir', m: '不 not', zh: '不' },
      { p: 'macro', m: '大 large', zh: '大' },
      { p: 'mal', m: '坏 bad', zh: '坏' },
      { p: 'micro', m: '小 small', zh: '小' },
      { p: 'mis', m: '错误 wrong', zh: '错误' },
      { p: 'mono', m: '单一 one', zh: '单' },
      { p: 'multi', m: '多 many', zh: '多' },
      { p: 'non', m: '不 not', zh: '不' },
      { p: 'ob', m: '反对/朝向 against/toward', zh: '反对' },
      { p: 'omni', m: '所有 all', zh: '全' },
      { p: 'out', m: '超过/外 beyond/out', zh: '超/外' },
      { p: 'over', m: '过度 over/excessive', zh: '过度' },
      { p: 'para', m: '旁边/相反 beside/against', zh: '旁/反' },
      { p: 'per', m: '完全/贯穿 through/thorough', zh: '完全/贯穿' },
      { p: 'post', m: '后 after', zh: '后' },
      { p: 'pre', m: '前 before', zh: '前' },
      { p: 'pro', m: '向前/支持 forward/for', zh: '向前/支持' },
      { p: 're', m: '再/回 again/back', zh: '再/回' },
      { p: 'retro', m: '向后 backward', zh: '向后' },
      { p: 'semi', m: '半 half', zh: '半' },
      { p: 'sub', m: '在下 under', zh: '下' },
      { p: 'super', m: '超越 above', zh: '超' },
      { p: 'sur', m: '超越/上 over/above', zh: '超/上' },
      { p: 'syn', m: '共同 together', zh: '共' },
      { p: 'trans', m: '穿越 across', zh: '穿越' },
      { p: 'tri', m: '三 three', zh: '三' },
      { p: 'ultra', m: '极端 beyond', zh: '极' },
      { p: 'un', m: '不 not', zh: '不' },
      { p: 'under', m: '不足/下 below', zh: '下/不足' },
      { p: 'uni', m: '单一 one', zh: '单' },
      { p: 'vice', m: '副 deputy', zh: '副' },
      { p: 'with', m: '反对/回 against/back', zh: '反/回' },
      { p: 'ac', m: '朝向/加强 toward', zh: '朝向' },
      { p: 'ad', m: '朝向 toward', zh: '朝向' },
      { p: 'ambi', m: '两边 both', zh: '两边' },
      { p: 'ab', m: '离开 away from', zh: '离开' },
    ],
    suffixes: [
      { s: 'able', m: '能...的 able to', zh: '能...的', pos: 'adj.' },
      { s: 'ible', m: '能...的 able to', zh: '能...的', pos: 'adj.' },
      { s: 'al', m: '...的 relating to', zh: '...的', pos: 'adj.' },
      { s: 'ance', m: '...状态 state of', zh: '...状态', pos: 'n.' },
      { s: 'ence', m: '...状态 state of', zh: '...状态', pos: 'n.' },
      { s: 'ant', m: '...的人/物 one who', zh: '...的', pos: 'adj./n.' },
      { s: 'ent', m: '...的/者 one who', zh: '...的', pos: 'adj./n.' },
      { s: 'ate', m: '使 to make', zh: '使', pos: 'v.' },
      { s: 'ation', m: '...行为/状态 act of', zh: '...化/行为', pos: 'n.' },
      { s: 'tion', m: '...行为/状态 act of', zh: '...化/行为', pos: 'n.' },
      { s: 'dom', m: '...领域/状态 state of', zh: '...域', pos: 'n.' },
      { s: 'er', m: '...者 one who', zh: '...者', pos: 'n.' },
      { s: 'or', m: '...者 one who', zh: '...者', pos: 'n.' },
      { s: 'ful', m: '充满...的 full of', zh: '充满...的', pos: 'adj.' },
      { s: 'fy', m: '使成为 to make', zh: '使成为', pos: 'v.' },
      { s: 'ify', m: '使成为 to make', zh: '使成为', pos: 'v.' },
      { s: 'ism', m: '...主义 belief', zh: '...主义', pos: 'n.' },
      { s: 'ist', m: '...者 one who', zh: '...者', pos: 'n.' },
      { s: 'ity', m: '...性质 quality', zh: '...性', pos: 'n.' },
      { s: 'ive', m: '倾向...的 tending to', zh: '...的', pos: 'adj.' },
      { s: 'ize', m: '使...化 to make', zh: '使...化', pos: 'v.' },
      { s: 'less', m: '无...的 without', zh: '无...的', pos: 'adj.' },
      { s: 'ly', m: '...地 in manner', zh: '...地', pos: 'adv.' },
      { s: 'ment', m: '...行为/结果 act/result', zh: '...行为', pos: 'n.' },
      { s: 'ness', m: '...状态 state of', zh: '...性/状态', pos: 'n.' },
      { s: 'ous', m: '...的 having quality', zh: '...的', pos: 'adj.' },
      { s: 'ious', m: '...的 having quality', zh: '...的', pos: 'adj.' },
      { s: 'ward', m: '朝...方向 toward', zh: '朝...方向', pos: 'adv.' },
    ],
    roots: [
      { r: 'act', m: '做 do/act', zh: '做' },
      { r: 'anim', m: '生命/精神 life/spirit', zh: '生命' },
      { r: 'ann', m: '年 year', zh: '年' },
      { r: 'aud', m: '听 hear', zh: '听' },
      { r: 'brev', m: '短 short', zh: '短' },
      { r: 'cap', m: '抓/头 seize/head', zh: '抓/头' },
      { r: 'cede', m: '走 go/yield', zh: '走/让' },
      { r: 'ceed', m: '走 go', zh: '走' },
      { r: 'cess', m: '走 go', zh: '走' },
      { r: 'chron', m: '时间 time', zh: '时间' },
      { r: 'cid', m: '切/杀 cut/kill', zh: '切/杀' },
      { r: 'claim', m: '喊叫 shout', zh: '喊' },
      { r: 'clam', m: '喊叫 shout', zh: '喊' },
      { r: 'cogn', m: '知道 know', zh: '知' },
      { r: 'cord', m: '心 heart', zh: '心' },
      { r: 'corp', m: '身体 body', zh: '体' },
      { r: 'cred', m: '相信 believe', zh: '信' },
      { r: 'curr', m: '跑/流 run/flow', zh: '跑/流' },
      { r: 'dict', m: '说 say/speak', zh: '说' },
      { r: 'doc', m: '教 teach', zh: '教' },
      { r: 'duc', m: '引导 lead', zh: '引导' },
      { r: 'duct', m: '引导 lead', zh: '引导' },
      { r: 'dur', m: '持久 last/hard', zh: '持久' },
      { r: 'equ', m: '相等 equal', zh: '等' },
      { r: 'fac', m: '做/制造 make/do', zh: '做' },
      { r: 'fact', m: '做/制造 make/do', zh: '做' },
      { r: 'fect', m: '做 make/do', zh: '做' },
      { r: 'fer', m: '带/承受 carry/bear', zh: '带/承受' },
      { r: 'fid', m: '信任 faith/trust', zh: '信' },
      { r: 'fin', m: '结束/边界 end/limit', zh: '终/界' },
      { r: 'flect', m: '弯曲 bend', zh: '弯' },
      { r: 'flex', m: '弯曲 bend', zh: '弯' },
      { r: 'flu', m: '流 flow', zh: '流' },
      { r: 'fluct', m: '流动 flow', zh: '流动' },
      { r: 'form', m: '形式 shape/form', zh: '形' },
      { r: 'frag', m: '打碎 break', zh: '碎' },
      { r: 'fract', m: '打碎 break', zh: '碎' },
      { r: 'gen', m: '产生/种类 birth/kind', zh: '生/种' },
      { r: 'grad', m: '步/级 step/degree', zh: '步/级' },
      { r: 'graph', m: '写/画 write/draw', zh: '写/画' },
      { r: 'greg', m: '群 flock/group', zh: '群' },
      { r: 'gress', m: '走 walk/step', zh: '走' },
      { r: 'hab', m: '拥有/居住 have/dwell', zh: '有/居' },
      { r: 'hemer', m: '天 day', zh: '天' },
      { r: 'ject', m: '投/掷 throw', zh: '投' },
      { r: 'jud', m: '判断 judge', zh: '判' },
      { r: 'jur', m: '发誓/法律 swear/law', zh: '誓/法' },
      { r: 'lat', m: '搬运/侧 carry/side', zh: '运/侧' },
      { r: 'leg', m: '法律/读 law/read', zh: '法/读' },
      { r: 'liber', m: '自由 free', zh: '自由' },
      { r: 'loc', m: '地方 place', zh: '地' },
      { r: 'log', m: '话/学 word/study', zh: '话/学' },
      { r: 'loqu', m: '说 speak', zh: '说' },
      { r: 'luc', m: '光 light', zh: '光' },
      { r: 'man', m: '手 hand', zh: '手' },
      { r: 'mand', m: '命令 command', zh: '命令' },
      { r: 'mem', m: '记忆 memory', zh: '记忆' },
      { r: 'ment', m: '心/思考 mind/think', zh: '心/思' },
      { r: 'merc', m: '贸易 trade', zh: '贸易' },
      { r: 'met', m: '恐惧 fear', zh: '惧' },
      { r: 'migr', m: '迁移 move', zh: '迁' },
      { r: 'min', m: '小 small', zh: '小' },
      { r: 'miss', m: '送/发 send', zh: '送' },
      { r: 'mit', m: '送/发 send', zh: '送' },
      { r: 'mob', m: '移动 move', zh: '移' },
      { r: 'mort', m: '死亡 death', zh: '死' },
      { r: 'mot', m: '移动 move', zh: '移' },
      { r: 'mov', m: '移动 move', zh: '移' },
      { r: 'nat', m: '出生 birth', zh: '生' },
      { r: 'nom', m: '名/法 name/law', zh: '名/法' },
      { r: 'nov', m: '新 new', zh: '新' },
      { r: 'pact', m: '约定 agree', zh: '约' },
      { r: 'path', m: '感情/痛苦 feeling/suffering', zh: '情/痛' },
      { r: 'ped', m: '脚 foot', zh: '脚' },
      { r: 'pel', m: '推/驱 drive/push', zh: '推/驱' },
      { r: 'pend', m: '悬挂/花费 hang/pay', zh: '挂/花费' },
      { r: 'pens', m: '花费/思考 pay/think', zh: '花费/思' },
      { r: 'phil', m: '爱 love', zh: '爱' },
      { r: 'phon', m: '声音 sound', zh: '声' },
      { r: 'plic', m: '折叠 fold', zh: '折' },
      { r: 'pon', m: '放置 put/place', zh: '放' },
      { r: 'port', m: '搬运 carry', zh: '搬运' },
      { r: 'pos', m: '放置 put/place', zh: '放' },
      { r: 'prehens', m: '抓住 grasp/seize', zh: '抓' },
      { r: 'press', m: '按压 press', zh: '压' },
      { r: 'prim', m: '第一 first', zh: '第一' },
      { r: 'psych', m: '精神/心灵 mind/soul', zh: '心灵' },
      { r: 'quer', m: '寻找 seek', zh: '寻' },
      { r: 'quest', m: '寻找 seek', zh: '寻' },
      { r: 'rupt', m: '打破 break', zh: '破' },
      { r: 'scrib', m: '写 write', zh: '写' },
      { r: 'script', m: '写 write', zh: '写' },
      { r: 'scrut', m: '检查 examine', zh: '检查' },
      { r: 'sect', m: '切 cut', zh: '切' },
      { r: 'sens', m: '感觉 feel/sense', zh: '感' },
      { r: 'sent', m: '感觉 feel/sense', zh: '感' },
      { r: 'sequ', m: '跟随 follow', zh: '跟随' },
      { r: 'sever', m: '严肃 severe/serious', zh: '严肃' },
      { r: 'sil', m: '跳 leap', zh: '跳' },
      { r: 'simil', m: '相似 like/same', zh: '似' },
      { r: 'sol', m: '独/太阳 alone/sun', zh: '独/阳' },
      { r: 'spec', m: '看 look/see', zh: '看' },
      { r: 'spect', m: '看 look/see', zh: '看' },
      { r: 'spir', m: '呼吸 breathe', zh: '呼吸' },
      { r: 'struct', m: '建造 build', zh: '建' },
      { r: 'tact', m: '接触 touch', zh: '触' },
      { r: 'temp', m: '时间 time', zh: '时间' },
      { r: 'templ', m: '庙宇 temple', zh: '庙' },
      { r: 'ten', m: '持有/延伸 hold/stretch', zh: '持/伸' },
      { r: 'tend', m: '伸向 stretch toward', zh: '伸向' },
      { r: 'terior', m: '更... comparative', zh: '更...' },
      { r: 'terr', m: '地/恐惧 earth/frighten', zh: '地/恐' },
      { r: 'tract', m: '拉 pull/draw', zh: '拉' },
      { r: 'vac', m: '空 empty', zh: '空' },
      { r: 'val', m: '价值/强 value/strong', zh: '价值/强' },
      { r: 'ven', m: '来 come', zh: '来' },
      { r: 'vent', m: '来 come', zh: '来' },
      { r: 'ver', m: '真实 true', zh: '真' },
      { r: 'verb', m: '词/语 word', zh: '词' },
      { r: 'vers', m: '转 turn', zh: '转' },
      { r: 'vert', m: '转 turn', zh: '转' },
      { r: 'vid', m: '看 see', zh: '看' },
      { r: 'vis', m: '看 see', zh: '看' },
      { r: 'vit', m: '生命/避免 life/avoid', zh: '生/避免' },
      { r: 'viv', m: '活 live', zh: '活' },
      { r: 'voc', m: '声音/叫 voice/call', zh: '声/叫' },
      { r: 'vol', m: '意愿 wish/will', zh: '意愿' },
      { r: 'volv', m: '转 roll/turn', zh: '转' },
    ]
  };

  function analyzeRoots(word) {
    const w = word.toLowerCase();
    const parts = [];

    // Find prefix
    const sortedPrefixes = [...ROOT_DB.prefixes].sort((a, b) => b.p.length - a.p.length);
    let prefixMatch = null;
    for (const pf of sortedPrefixes) {
      if (w.startsWith(pf.p) && w.length > pf.p.length + 2) {
        prefixMatch = pf;
        break;
      }
    }

    // Find suffix
    const sortedSuffixes = [...ROOT_DB.suffixes].sort((a, b) => b.s.length - a.s.length);
    let suffixMatch = null;
    for (const sf of sortedSuffixes) {
      if (w.endsWith(sf.s) && w.length > sf.s.length + 2) {
        suffixMatch = sf;
        break;
      }
    }

    // Find root in the middle part
    const startIdx = prefixMatch ? prefixMatch.p.length : 0;
    const endIdx = suffixMatch ? w.length - suffixMatch.s.length : w.length;
    const middle = w.substring(startIdx, endIdx);

    const sortedRoots = [...ROOT_DB.roots].sort((a, b) => b.r.length - a.r.length);
    let rootMatch = null;
    for (const rt of sortedRoots) {
      if (middle.includes(rt.r) || w.includes(rt.r)) {
        rootMatch = rt;
        break;
      }
    }

    // Build analysis string
    if (!prefixMatch && !rootMatch && !suffixMatch) return '';

    const segments = [];
    if (prefixMatch) segments.push(`${prefixMatch.p}-(${prefixMatch.m})`);
    if (rootMatch) segments.push(`${rootMatch.r}(${rootMatch.m})`);
    else if (middle && middle.length >= 2) segments.push(middle);
    if (suffixMatch) segments.push(`-${suffixMatch.s}(${suffixMatch.m})`);

    // Build meaning chain
    let meaning = '';
    if (prefixMatch) meaning += prefixMatch.zh;
    if (rootMatch) meaning += (meaning ? ' + ' : '') + rootMatch.zh;
    if (suffixMatch) meaning += (meaning ? ' + ' : '') + suffixMatch.zh;

    return segments.join(' + ') + (meaning ? ' → ' + meaning : '');
  }

  function generateMnemonic(word, roots, defZh) {
    const parts = [];
    // Root-based hint
    if (roots) {
      parts.push('词根拆解: ' + roots.split('→')[0].trim());
    }
    // Association hint
    const simpleWords = [];
    const w = word.toLowerCase();
    ROOT_DB.roots.forEach(r => {
      if (w.includes(r.r)) {
        simpleWords.push(`${r.r}=${r.zh}(${r.m.split(' ')[0]})`);
      }
    });
    if (simpleWords.length > 0) {
      parts.push('核心词素: ' + simpleWords.join(', '));
    }
    if (defZh) {
      parts.push('联想: 看到 "' + word + '" 想到 "' + defZh.split('；')[0] + '"');
    }
    return parts.join('\n') || '';
  }

  async function translateToZh(text) {
    try {
      const resp = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN`);
      if (!resp.ok) return '';
      const data = await resp.json();
      if (data.responseStatus === 200 && data.responseData?.translatedText) {
        return data.responseData.translatedText;
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  async function lookupWord(word) {
    try {
      showToast('info', `🔍 正在查询 "${word}"...`);

      // 1. Fetch from dictionary API
      const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
      if (!resp.ok) throw new Error('Word not found');
      const data = await resp.json();
      const entry = data[0];
      const phonetic = entry.phonetics?.find(p => p.text)?.text || entry.phonetic || '';
      const meanings = entry.meanings || [];
      const pos = meanings.map(m => m.partOfSpeech).join(', ');
      const defEn = meanings.flatMap(m => m.definitions.slice(0, 2)).map(d => d.definition).join('; ');
      const synonyms = [...new Set(meanings.flatMap(m => m.synonyms || []).slice(0, 5))];
      const antonyms = [...new Set(meanings.flatMap(m => m.antonyms || []).slice(0, 5))];
      const example = meanings.flatMap(m => m.definitions).find(d => d.example)?.example || '';

      // 2. Auto word root analysis
      const roots = analyzeRoots(entry.word);

      // 3. Auto translate to Chinese (definition + example)
      showToast('info', '🌐 正在翻译中文释义...');
      const [defZh, exampleZh] = await Promise.all([
        translateToZh(defEn.split(';')[0].trim()),
        example ? translateToZh(example) : Promise.resolve('')
      ]);

      // 4. Auto generate mnemonic
      const mnemonic = generateMnemonic(entry.word, roots, defZh);

      populateForm({
        word: entry.word, phonetic, pos, defEn,
        defZh, roots, mnemonic,
        exampleEn: example, exampleZh,
        synonyms, antonyms
      });

      showToast('success', `✅ "${entry.word}" 查询完成，已自动填充所有信息`);
    } catch (e) {
      // Even if API fails, still try root analysis
      const roots = analyzeRoots(word);
      const mnemonic = generateMnemonic(word, roots, '');
      populateForm({
        word, phonetic: '', pos: '', defEn: '', defZh: '',
        roots, mnemonic,
        exampleEn: '', exampleZh: '',
        synonyms: [], antonyms: []
      });
      showToast('error', '未找到该单词的在线定义，请手动补充信息');
    }
  }

  function populateForm(data) {
    state.editingWordId = null;
    document.getElementById('form-word-display').textContent = data.word;
    document.getElementById('form-phonetic-display').textContent = data.phonetic || '';
    document.getElementById('form-roots').value = data.roots || '';
    document.getElementById('form-def-en').value = data.defEn || '';
    document.getElementById('form-def-zh').value = data.defZh || '';
    document.getElementById('form-pos').value = data.pos || '';
    document.getElementById('form-mnemonic').value = data.mnemonic || '';
    document.getElementById('form-example-en').value = data.exampleEn || '';
    document.getElementById('form-example-zh').value = data.exampleZh || '';
    document.getElementById('form-synonyms').value = (data.synonyms || []).join(', ');
    document.getElementById('form-antonyms').value = (data.antonyms || []).join(', ');
    document.getElementById('word-detail-form').classList.add('visible');
    document.getElementById('search-suggestions').classList.remove('visible');
  }

  function saveWord() {
    const word = document.getElementById('form-word-display').textContent.trim();
    if (!word) { showToast('error', '请输入单词'); return; }

    const existing = state.words.find(w => w.word.toLowerCase() === word.toLowerCase());
    const wordData = {
      word,
      phonetic: document.getElementById('form-phonetic-display').textContent,
      pos: document.getElementById('form-pos').value.trim(),
      roots: document.getElementById('form-roots').value.trim(),
      defEn: document.getElementById('form-def-en').value.trim(),
      defZh: document.getElementById('form-def-zh').value.trim(),
      mnemonic: document.getElementById('form-mnemonic').value.trim(),
      exampleEn: document.getElementById('form-example-en').value.trim(),
      exampleZh: document.getElementById('form-example-zh').value.trim(),
      synonyms: document.getElementById('form-synonyms').value.split(',').map(s => s.trim()).filter(Boolean),
      antonyms: document.getElementById('form-antonyms').value.split(',').map(s => s.trim()).filter(Boolean),
      addedAt: Date.now()
    };

    if (existing) {
      Object.assign(existing, wordData);
      showToast('success', `✅ "${word}" 已更新`);
    } else {
      const id = 'w_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      state.words.push({ id, ...wordData });
      state.reviews[id] = SM2.defaultReview();
      showToast('success', `✅ "${word}" 已添加到词库`);
    }
    saveState();
    document.getElementById('word-detail-form').classList.remove('visible');
    document.getElementById('word-search-input').value = '';
    renderSuggestions();
  }

  // ---- Suggestions ----
  function renderSuggestions() {
    const container = document.getElementById('suggested-words-list');
    const userWords = new Set(state.words.map(w => w.word.toLowerCase()));
    // Collect synonyms/antonyms from user's words that aren't in their list yet
    const suggested = new Map();
    state.words.forEach(w => {
      (w.synonyms || []).concat(w.antonyms || []).forEach(s => {
        const low = s.toLowerCase();
        if (!userWords.has(low) && !suggested.has(low)) {
          suggested.set(low, { word: s, reason: `与 "${w.word}" 相关` });
        }
      });
    });
    // Add builtin words not yet added
    if (typeof BUILTIN_WORDS !== 'undefined') {
      BUILTIN_WORDS.forEach(bw => {
        const low = bw.word.toLowerCase();
        if (!userWords.has(low) && !suggested.has(low)) {
          suggested.set(low, { word: bw.word, reason: '推荐词汇' });
        }
      });
    }
    const items = [...suggested.values()].slice(0, 10);
    if (items.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>暂无推荐单词</p></div>';
      return;
    }
    container.innerHTML = items.map(s => `
      <div class="suggested-word-card">
        <div class="suggested-word-info">
          <div class="sw-word">${s.word}</div>
          <div class="sw-reason">${s.reason}</div>
        </div>
        <button class="btn-add-suggested" data-word="${s.word}" title="添加">+</button>
      </div>
    `).join('');
  }

  // ---- Word List ----
  function renderWordList(filter = 'all', search = '') {
    const container = document.getElementById('word-list-container');
    let words = [...state.words];
    if (filter !== 'all') {
      words = words.filter(w => (state.reviews[w.id]?.status || 'new') === filter);
    }
    if (search) {
      const q = search.toLowerCase();
      words = words.filter(w => w.word.toLowerCase().includes(q) || (w.defZh || '').includes(q));
    }
    words.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

    if (words.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><h3>空空如也</h3><p>当前筛选条件下没有单词</p></div>`;
      return;
    }

    container.innerHTML = words.map(w => {
      const r = state.reviews[w.id];
      const status = r?.status || 'new';
      const next = r?.nextReview ? formatRelativeTime(r.nextReview) : '';
      return `<div class="word-list-item" data-word-id="${w.id}">
        <div class="wli-mastery ${status}"></div>
        <div class="wli-content">
          <div class="wli-word">${w.word}</div>
          <div class="wli-def">${w.defZh || w.defEn || ''}</div>
        </div>
        <div class="wli-next">${next}</div>
      </div>`;
    }).join('');
  }

  // ---- Stats ----
  function renderStats() {
    // Total days
    const days = Object.keys(state.stats.dailyLog).length;
    document.getElementById('stats-total-days').textContent = days;
    document.getElementById('stats-total-reviews').textContent = state.stats.totalReviews;

    // Heatmap
    const heatmap = document.getElementById('heatmap-grid');
    let heatHtml = '';
    for (let i = 27; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toISOString().split('T')[0];
      const count = state.stats.dailyLog[key] || 0;
      let level = '';
      if (count > 0) level = 'level-1';
      if (count >= 5) level = 'level-2';
      if (count >= 10) level = 'level-3';
      if (count >= 20) level = 'level-4';
      heatHtml += `<div class="heatmap-cell ${level}" title="${key}: ${count}次"></div>`;
    }
    heatmap.innerHTML = heatHtml;

    // Mastery distribution
    const dist = { new: 0, learning: 0, reviewing: 0, mastered: 0 };
    state.words.forEach(w => {
      const s = state.reviews[w.id]?.status || 'new';
      dist[s] = (dist[s] || 0) + 1;
    });
    const total = state.words.length || 1;
    const distEl = document.getElementById('mastery-distribution');
    distEl.innerHTML = [
      { key: 'new', label: '新词', color: 'new' },
      { key: 'learning', label: '学习中', color: 'learning' },
      { key: 'reviewing', label: '复习中', color: 'reviewing' },
      { key: 'mastered', label: '已掌握', color: 'mastered' }
    ].map(item => `
      <div class="mastery-bar-item">
        <span class="mastery-bar-label">${item.label}</span>
        <div class="mastery-bar">
          <div class="mastery-bar-fill ${item.color}" style="width: ${(dist[item.key] / total) * 100}%"></div>
        </div>
        <span class="mastery-bar-count">${dist[item.key]}</span>
      </div>
    `).join('');

    // Upcoming reviews
    const upcoming = [...state.words]
      .map(w => ({ word: w.word, next: state.reviews[w.id]?.nextReview || 0, id: w.id }))
      .filter(w => w.next > Date.now())
      .sort((a, b) => a.next - b.next)
      .slice(0, 10);
    const upEl = document.getElementById('upcoming-list');
    if (upcoming.length === 0) {
      upEl.innerHTML = '<div class="empty-state"><p>暂无计划中的复习</p></div>';
    } else {
      upEl.innerHTML = upcoming.map(u => `
        <div class="upcoming-item">
          <span class="ui-word">${u.word}</span>
          <span class="ui-time">${formatRelativeTime(u.next)}</span>
        </div>
      `).join('');
    }
  }

  // ---- Word Detail Modal ----
  function showWordModal(wordId) {
    const w = state.words.find(w => w.id === wordId);
    if (!w) return;
    const r = state.reviews[w.id] || SM2.defaultReview();
    const modal = document.getElementById('word-modal');
    const content = document.getElementById('word-modal-content');

    content.innerHTML = `
      <div class="modal-handle"></div>
      <div class="modal-header">
        <div>
          <div class="modal-word-title">${w.word}</div>
          <div style="color:var(--text-secondary);font-size:14px;">${w.phonetic || ''} ${w.pos || ''}</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn-pronounce" id="modal-pronounce" style="width:36px;height:36px;font-size:16px;">🔊</button>
          <button class="btn-modal-close" id="btn-close-modal">✕</button>
        </div>
      </div>
      ${w.roots ? `<div class="modal-section"><div class="modal-section-title">📌 词根分析</div><div class="fc-root-analysis">${w.roots}</div></div>` : ''}
      <div class="modal-section">
        <div class="modal-section-title">📖 释义</div>
        <div class="fc-definition"><div class="fc-def-en">${w.defEn || ''}</div><div class="fc-def-zh">${w.defZh || ''}</div></div>
      </div>
      ${w.mnemonic ? `<div class="modal-section"><div class="modal-section-title">💡 记忆方法</div><div class="fc-mnemonic">${w.mnemonic}</div></div>` : ''}
      ${w.exampleEn ? `<div class="modal-section"><div class="modal-section-title">📝 例句</div><div class="fc-example"><div class="fc-example-en">${w.exampleEn}</div>${w.exampleZh ? `<div class="fc-example-zh">${w.exampleZh}</div>` : ''}</div></div>` : ''}
      <div class="modal-section">
        <div class="modal-section-title">📊 学习状态</div>
        <div style="font-size:13px;color:var(--text-secondary);line-height:2;">
          状态: <span style="color:var(--primary-light)">${{ new: '新词', learning: '学习中', reviewing: '复习中', mastered: '已掌握' }[r.status] || '新词'}</span><br>
          复习次数: ${r.reps} 次<br>
          下次复习: ${r.nextReview <= Date.now() ? '现在' : formatRelativeTime(r.nextReview)}<br>
          记忆因子: ${r.ef.toFixed(2)}
        </div>
      </div>
      <button class="btn-secondary" id="btn-edit-word" data-word-id="${w.id}" style="margin-bottom:8px;">✏️ 编辑单词</button>
      <button class="btn-delete-word" id="btn-delete-word" data-word-id="${w.id}">🗑️ 删除单词</button>
    `;

    modal.classList.add('visible');

    document.getElementById('modal-pronounce').onclick = () => pronounceWord(w.word);
    document.getElementById('btn-close-modal').onclick = () => modal.classList.remove('visible');
    document.getElementById('btn-delete-word').onclick = () => {
      if (confirm(`确定要删除 "${w.word}" 吗？`)) {
        state.words = state.words.filter(ww => ww.id !== w.id);
        delete state.reviews[w.id];
        saveState();
        modal.classList.remove('visible');
        showToast('success', `已删除 "${w.word}"`);
        if (state.currentView === 'words') renderWordList();
        if (state.currentView === 'home') updateDashboard();
      }
    };
    document.getElementById('btn-edit-word').onclick = () => {
      modal.classList.remove('visible');
      navigateTo('add');
      populateForm(w);
      state.editingWordId = w.id;
    };
  }

  // ---- Utilities ----
  function formatRelativeTime(timestamp) {
    const diff = timestamp - Date.now();
    if (diff <= 0) return '现在';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + '分钟后';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + '小时后';
    const days = Math.floor(hours / 24);
    if (days < 30) return days + '天后';
    const months = Math.floor(days / 30);
    return months + '个月后';
  }

  function showToast(type, message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // ---- Data Management ----
  function exportData() {
    const data = { words: state.words, reviews: state.reviews, stats: state.stats, exportDate: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `vocabmaster_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click(); URL.revokeObjectURL(url);
    showToast('success', '📤 数据已导出');
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = JSON.parse(e.target.result);
        if (data.words) state.words = data.words;
        if (data.reviews) state.reviews = data.reviews;
        if (data.stats) state.stats = { ...state.stats, ...data.stats };
        saveState();
        showToast('success', '📥 数据已导入');
        navigateTo(state.currentView);
      } catch (err) { showToast('error', '导入失败：文件格式错误'); }
    };
    reader.readAsText(file);
  }

  // ---- Event Binding ----
  function bindEvents() {
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => navigateTo(item.dataset.view));
    });

    // Start review
    document.getElementById('btn-start-review').addEventListener('click', () => navigateTo('review'));

    // Flashcard flip
    document.getElementById('flashcard').addEventListener('click', (e) => {
      if (e.target.closest('.btn-pronounce')) return;
      flipCard();
    });

    // Pronounce
    document.getElementById('btn-pronounce').addEventListener('click', (e) => {
      e.stopPropagation();
      const w = state.reviewQueue[state.reviewIndex];
      if (w) pronounceWord(w.word);
    });

    // Rating
    document.querySelectorAll('.btn-rate').forEach(btn => {
      btn.addEventListener('click', () => rateWord(parseInt(btn.dataset.quality)));
    });

    // Exit review
    document.getElementById('btn-exit-review').addEventListener('click', () => {
      saveState();
      navigateTo('home');
    });

    // Review done
    document.getElementById('btn-review-done').addEventListener('click', () => navigateTo('home'));

    // Search input
    let searchTimeout;
    const searchInput = document.getElementById('word-search-input');
    const clearBtn = document.getElementById('btn-search-clear');
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      const val = searchInput.value.trim();
      clearBtn.style.display = val ? 'flex' : 'none';
      searchTimeout = setTimeout(() => searchWord(val), 300);
    });
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      clearBtn.style.display = 'none';
      document.getElementById('search-suggestions').classList.remove('visible');
    });

    // Search suggestions click
    document.getElementById('search-suggestions').addEventListener('click', (e) => {
      const item = e.target.closest('.suggestion-item');
      if (!item) return;
      const action = item.dataset.action;
      if (action === 'lookup') lookupWord(item.dataset.word);
      else if (action === 'add-builtin') {
        const bw = BUILTIN_WORDS.find(w => w.word === item.dataset.word);
        if (bw) populateForm(bw);
      } else if (action === 'view') showWordModal(item.dataset.wordId);
    });

    // Save word
    document.getElementById('btn-save-word').addEventListener('click', saveWord);
    document.getElementById('btn-cancel-add').addEventListener('click', () => {
      document.getElementById('word-detail-form').classList.remove('visible');
    });

    // Suggested words
    document.getElementById('suggested-words-list').addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-add-suggested');
      if (!btn) return;
      const word = btn.dataset.word;
      const bw = (typeof BUILTIN_WORDS !== 'undefined' ? BUILTIN_WORDS : []).find(w => w.word === word);
      if (bw) { populateForm(bw); }
      else { lookupWord(word); }
    });

    // Form pronounce
    document.getElementById('form-btn-pronounce').addEventListener('click', () => {
      pronounceWord(document.getElementById('form-word-display').textContent);
    });

    // Word list click
    document.getElementById('word-list-container').addEventListener('click', (e) => {
      const item = e.target.closest('.word-list-item');
      if (item) showWordModal(item.dataset.wordId);
    });

    // Recent words click
    document.getElementById('recent-words-list').addEventListener('click', (e) => {
      const card = e.target.closest('.word-mini-card');
      if (card) showWordModal(card.dataset.wordId);
    });

    // Filters
    document.getElementById('wordlist-filters').addEventListener('click', (e) => {
      const chip = e.target.closest('.filter-chip');
      if (!chip) return;
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderWordList(chip.dataset.filter, document.getElementById('wordlist-search-input').value);
    });

    // Word list search
    document.getElementById('wordlist-search-input').addEventListener('input', (e) => {
      const activeFilter = document.querySelector('.filter-chip.active')?.dataset.filter || 'all';
      renderWordList(activeFilter, e.target.value);
    });

    // Settings
    document.getElementById('btn-settings').addEventListener('click', () => {
      document.getElementById('settings-modal').classList.add('visible');
      document.getElementById('tts-speed').value = state.settings.ttsSpeed;
      document.getElementById('daily-new-words').value = state.settings.dailyNewWords;
      const toggle = document.getElementById('toggle-auto-pronounce');
      toggle.classList.toggle('active', state.settings.autoPlay);
    });
    document.getElementById('btn-close-settings').addEventListener('click', () => {
      document.getElementById('settings-modal').classList.remove('visible');
    });
    document.getElementById('toggle-auto-pronounce').addEventListener('click', function () {
      this.classList.toggle('active');
      state.settings.autoPlay = this.classList.contains('active');
      saveState();
    });
    document.getElementById('tts-speed').addEventListener('change', function () {
      state.settings.ttsSpeed = parseFloat(this.value);
      saveState();
    });
    document.getElementById('daily-new-words').addEventListener('change', function () {
      state.settings.dailyNewWords = parseInt(this.value);
      saveState();
    });
    document.getElementById('btn-export-data').addEventListener('click', exportData);
    document.getElementById('btn-import-data').addEventListener('click', () => {
      document.getElementById('import-file-input').click();
    });
    document.getElementById('import-file-input').addEventListener('change', (e) => {
      if (e.target.files[0]) importData(e.target.files[0]);
    });
    document.getElementById('btn-reset-data').addEventListener('click', () => {
      if (confirm('⚠️ 确定要重置所有数据吗？此操作不可撤销！')) {
        localStorage.clear();
        location.reload();
      }
    });

    // Modal overlay click to close
    document.getElementById('word-modal').addEventListener('click', (e) => {
      if (e.target === document.getElementById('word-modal')) {
        document.getElementById('word-modal').classList.remove('visible');
      }
    });
    document.getElementById('settings-modal').addEventListener('click', (e) => {
      if (e.target === document.getElementById('settings-modal')) {
        document.getElementById('settings-modal').classList.remove('visible');
      }
    });

    // Load voices
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
  }

  // Start app
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
