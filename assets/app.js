/* ============================================================
   lll 的小站 · 交互逻辑
   ------------------------------------------------------------
   * 内容是静态的：data.js（图集 / 音乐）+ content.js（简介 / 文章）
   * 路由用 hash：#/ 欢迎页、#/profile、#/gallery、#/essays、#/essays/<slug>、#/can
   * 在本地服务器下会额外请求 /api/images，自动发现新放进来的图片
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 小工具 ---------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const pad2 = (n) => String(n).padStart(2, '0');
  const FILE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
  const STORE = { theme: 'cuteimage:theme', favs: 'cuteimage:favs' };
  const MUSIC_STORE = { volume: 'cuteimage:volume' };

  const esc = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const formatBytes = (bytes) => {
    if (!bytes || bytes < 0) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  };
  const formatDate = (d) => `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
  const formatTime = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const formatFull = (d) => `${formatDate(d)} ${formatTime(d)}`;
  const encodePath = (p) => String(p).split('/').map(encodeURIComponent).join('/');

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* 隐私模式忽略 */ }
  }
  function vibrate(ms) {
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (_) {} }
  }
  function hashAccent(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return hslToHex((h * 7 + 320) % 360, 0.68, 0.63);
  }
  function hslToHex(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
    return '#' + rgb.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
  }
  function pickIndices(total, wanted) {
    if (!total) return [];
    const out = [];
    const step = Math.max(1, Math.floor(total / wanted));
    for (let i = 0; i < wanted; i++) {
      let idx = i * step;
      if (idx >= total) idx = total - 1;
      if (!out.includes(idx)) out.push(idx);
    }
    for (let i = 0; out.length < Math.min(wanted, total); i++) {
      if (!out.includes(i)) out.push(i);
    }
    return out;
  }

  /* ---------- 内容与配置 ---------- */
  const CONTENT = (window.CUTE_CONTENT && typeof window.CUTE_CONTENT === 'object') ? window.CUTE_CONTENT : {};
  const PROFILE = CONTENT.profile || {};
  const ESSAYS = Array.isArray(CONTENT.essays) ? CONTENT.essays.slice() : [];
  const IMAGES_RAW = (window.CUTE_IMAGES && typeof window.CUTE_IMAGES === 'object') ? window.CUTE_IMAGES : {};
  const IMAGE_BASE = IMAGES_RAW.imageBase || CONTENT.imageBase || 'material-library/image/';
  const MUSIC_BASE = IMAGES_RAW.musicBase || CONTENT.musicBase || 'material-library/music/';
  const SITE_NAME = `${PROFILE.name || 'lll'} 的小站`;

  const QUOTES = [
    {
      text: '我们总是要不断地前行，然后抵达我们观念中的目的地，尽管我们为此会迂回许多次。',
      source: 'lll'
    }
  ];

  const ICONS = {
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevronLeft: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevronRight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.2-4.4-7.2-9.4A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.2 3C19.2 15.6 12 20 12 20Z"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.2 17.5h9.9a3.4 3.4 0 0 0 .4-6.8 5 5 0 0 0-9.6-1.3 3.9 3.9 0 0 0-.7 8.1Z"/><path d="M9 20.4h.01M13 20.4h.01M17 20.4h.01"/></svg>',
    book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.4C10.4 5 8.2 4.4 4.5 4.5v13.2c3.7-.1 5.9.5 7.5 1.9 1.6-1.4 3.8-2 7.5-1.9V4.5c-3.7-.1-5.9.5-7.5 1.9Z"/><path d="M12 6.4v13.2"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.4"/><path d="M12 7.6V12l3 1.8"/></svg>'
  };

  /* ---------- 状态 ---------- */
  const state = {
    all: [],
    view: [],
    sort: 'new',
    month: 'all',
    favOnly: false,
    query: '',
    current: 0,
    playing: false,
    timer: 0,
    live: false,
    route: { name: 'welcome', file: null, slug: null },
    deepLinkFile: null
  };
  const favorites = new Set(readJSON(STORE.favs, []));

  /* ---------- DOM ---------- */
  const dom = {
    welcome: $('#welcome'),
    welcomeStack: $('#welcomeStack'),
    welcomeQuoteWrap: $('.welcome-quote'),
    welcomeQuote: $('#welcomeQuote'),
    welcomeQuoteSrc: $('#welcomeQuoteSrc'),
    app: $('#app'),
    nav: $('#nav'),
    navLinks: $('#navLinks'),
    navToggle: $('#navToggle'),
    views: {
      profile: $('#view-profile'),
      gallery: $('#view-gallery'),
      essays: $('#view-essays'),
      essay: $('#view-essay'),
      can: $('#view-can')
    },
    readProgress: $('#readProgress'),
    grid: $('#grid'),
    empty: $('#empty'),
    emptyText: $('#emptyText'),
    chips: $('#chips'),
    search: $('#search'),
    countPill: $('#countPill'),
    favCount: $('#favCount'),
    favBtn: $('#favBtn'),
    resetBtn: $('#resetBtn'),
    folderBtn: $('#folderBtn'),
    toast: $('#toast'),
    lb: $('#lb'),
    lbImg: $('#lbImg'),
    lbName: $('#lbName'),
    lbIndex: $('#lbIndex'),
    lbMeta: $('#lbMeta'),
    lbStrip: $('#lbStrip'),
    lbFav: $('#lbFav'),
    lbPlay: $('#lbPlay'),
    lbPrev: $('#lbPrev'),
    lbNext: $('#lbNext'),
    lbProgress: $('#lbProgress'),
    lbLoading: $('#lbLoading'),
    profile: $('#view-profile'),
    essays: $('#view-essays'),
    essay: $('#view-essay')
  };

  /* ---------- 主题 ---------- */
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme(theme, persist) {
    document.documentElement.setAttribute('data-theme', theme);
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0d0b14' : '#fdf8fb');
    if (persist) writeJSON(STORE.theme, theme);
  }
  function initTheme() {
    const saved = readJSON(STORE.theme, null);
    applyTheme(saved || (media.matches ? 'dark' : 'light'), false);
    if (media.addEventListener) {
      media.addEventListener('change', (e) => {
        if (!readJSON(STORE.theme, null)) applyTheme(e.matches ? 'dark' : 'light', false);
      });
    }
    $$('.js-theme').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next, true);
      });
    });
  }

  /* ---------- 图集数据 ---------- */
  function normalize(raw, prev) {
    const file = raw.file;
    const stem = raw.stem || file.replace(FILE_EXT, '');
    const ts = Number(raw.timestamp) || Date.parse(raw.date) || 0;
    const date = raw.date ? new Date(raw.date) : new Date(ts || Date.now());
    const thumb = raw.thumb || (prev && prev.thumb) || null;
    const colors = raw.colors || (prev && prev.colors) || {};
    return {
      file,
      stem,
      title: raw.title || stem,
      source: raw.source || 'VRChat',
      date,
      ts,
      bytes: Number(raw.bytes) || 0,
      width: Number(raw.width) || (prev && prev.width) || 0,
      height: Number(raw.height) || (prev && prev.height) || 0,
      thumb: thumb ? encodePath(thumb) : '',
      lqip: (prev && prev.lqip) || raw.lqip || '',
      accent: colors.accent || hashAccent(file),
      dominant: colors.dominant || '#7a6b8a',
      full: IMAGE_BASE + encodePath(file)
    };
  }
  function buildImages(source, fallback) {
    const byFile = new Map((fallback || []).map((i) => [i.file, i]));
    return (source || [])
      .filter((i) => i && i.file && FILE_EXT.test(i.file))
      .map((i) => normalize(i, byFile.get(i.file)));
  }
  function signature(list) {
    return list.map((i) => `${i.file}|${i.ts}|${i.bytes}|${i.thumb}`).join('~');
  }
  function thumbOf(item) { return item.thumb || item.full; }

  function buildInitialImages() {
    const fallback = Array.isArray(IMAGES_RAW.images) ? IMAGES_RAW.images : [];
    state.all = buildImages(fallback, fallback);
    syncStats();
  }

  async function loadLiveImages() {
    if (location.protocol === 'file:') return;
    // GitHub Pages 之类的纯静态托管没有 /api/images，直接用 data.js 的清单就行
    const host = location.hostname;
    const isLocalServer = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    if (!isLocalServer) return;
    const fallback = Array.isArray(IMAGES_RAW.images) ? IMAGES_RAW.images : [];
    try {
      const res = await fetch('api/images', { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      if (!json || !Array.isArray(json.images)) return;
      state.live = true;
      dom.folderBtn.hidden = false;
      const next = buildImages(json.images, fallback);
      const wasInLightbox = !dom.lb.hidden;
      const currentFile = currentItem() ? currentItem().file : null;
      state.all = next;
      syncStats();
      if (wasInLightbox && currentFile) {
        const idx = state.view.findIndex((i) => i.file === currentFile);
        if (idx >= 0) { state.current = idx; buildStrip(); showCurrent(); }
        else closeLightbox({ silent: true });
      }
      if (state.route.name === 'gallery') refresh();
      else if (state.route.name === 'profile') renderProfile();
      else if (state.route.name === 'welcome') renderWelcomeArt();
    } catch (_) { /* 没有服务器就用静态清单，正常 */ }
  }

  function syncStats() {
    const all = state.all;
    const count = all.length;
    const total = all.reduce((s, i) => s + i.bytes, 0);
    const dates = all.map((i) => i.date).sort((a, b) => a - b);
    let span = '—';
    if (dates.length) {
      const a = dates[0], b = dates[dates.length - 1];
      span = a.getFullYear() === b.getFullYear()
        ? `${a.getFullYear()}.${pad2(a.getMonth() + 1)}–${pad2(b.getMonth() + 1)}`
        : `${a.getFullYear()}.${pad2(a.getMonth() + 1)}–${b.getFullYear()}.${pad2(b.getMonth() + 1)}`;
    }
    const latest = dates.length ? formatDate(dates[dates.length - 1]) : '—';
    const set = (key, text) => {
      const el = document.querySelector(`[data-stat="${key}"]`);
      if (el) el.textContent = text;
    };
    set('count', String(count));
    set('size', formatBytes(total));
    set('span', span);
    set('latest', latest);
    dom.countPill.textContent = `${count} 张`;
  }

  /* ---------- 欢迎页 ---------- */
  function renderWelcomeArt() {
    if (!dom.welcomeStack) return;
    const sorted = state.all.slice().sort((a, b) => b.ts - a.ts);
    const picks = pickIndices(sorted.length, 3).map((i) => sorted[i]);
    dom.welcomeStack.innerHTML = '';
    if (!picks.length) {
      if (PROFILE.avatar) {
        const fig = document.createElement('figure');
        fig.className = 'polaroid';
        fig.innerHTML = `<img src="${esc(PROFILE.avatar)}" alt="" /><figcaption><span>lll</span><span>头像</span></figcaption>`;
        dom.welcomeStack.append(fig);
      }
      return;
    }
    picks.forEach((item, i) => {
      const fig = document.createElement('figure');
      fig.className = 'polaroid';
      const img = document.createElement('img');
      img.src = thumbOf(item);
      img.alt = '';
      img.loading = i === 0 ? 'eager' : 'lazy';
      img.decoding = 'async';
      if (item.lqip) img.style.backgroundImage = `url("${item.lqip}")`;
      const cap = document.createElement('figcaption');
      const d = document.createElement('span');
      d.textContent = formatDate(item.date);
      const t = document.createElement('span');
      t.textContent = `#${pad2(state.all.indexOf(item) + 1)}`;
      cap.append(d, t);
      fig.append(img, cap);
      dom.welcomeStack.append(fig);
    });
  }

  let quoteTimer = 0;
  let quoteIndex = -1;
  function paintQuote(index) {
    const quote = QUOTES[index];
    if (!quote) return;
    dom.welcomeQuoteWrap.classList.add('is-swapping');
    clearTimeout(paintQuote.timer);
    paintQuote.timer = setTimeout(() => {
      dom.welcomeQuote.textContent = quote.text;
      dom.welcomeQuoteSrc.textContent = quote.source;
      dom.welcomeQuoteWrap.classList.remove('is-swapping');
    }, 220);
  }
  function startQuoteRotation() {
    stopQuoteRotation();
    if (!QUOTES.length) return;
    if (quoteIndex < 0) quoteIndex = Math.floor(Math.random() * QUOTES.length);
    else quoteIndex = (quoteIndex + 1) % QUOTES.length;
    paintQuote(quoteIndex);
    if (QUOTES.length < 2) return;
    quoteTimer = setInterval(() => {
      quoteIndex = (quoteIndex + 1) % QUOTES.length;
      paintQuote(quoteIndex);
    }, 9000);
  }
  function stopQuoteRotation() {
    clearInterval(quoteTimer);
    quoteTimer = 0;
  }

  /* ---------- 个人简介 ---------- */
  function sortedImages() {
    return state.all.slice().sort((a, b) => b.ts - a.ts);
  }

  function snapHTML(item, cls) {
    if (!item) return '';
    return `<figure class="snap ${cls}">
      <img src="${esc(thumbOf(item))}" alt="" loading="lazy" decoding="async" />
      <figcaption><span>${esc(formatDate(item.date))}</span><span>${esc(item.width + '×' + item.height)}</span></figcaption>
    </figure>`;
  }

  function peekCardHTML(item, index) {
    return `<button class="peek-card" type="button" data-file="${esc(item.file)}" aria-label="在图集中查看 ${esc(formatDate(item.date))} 的图片">
      <img src="${esc(thumbOf(item))}" alt="" loading="lazy" decoding="async" />
      <span class="peek-meta"><b>${esc(formatDate(item.date))}</b><span>${esc(formatTime(item.date))} · ${esc(String(item.width))}×${esc(String(item.height))}</span></span>
    </button>`;
  }

  function profileArtHTML() {
    const sorted = sortedImages();
    const picks = pickIndices(sorted.length, 3).map((i) => sorted[i]);
    const avatar = PROFILE.avatar
      ? `<figure class="avatar-card">
          <img src="${esc(PROFILE.avatar)}" alt="${esc(PROFILE.name)} 的头像" />
          <figcaption><span>${esc(PROFILE.name)}</span><span>头像</span></figcaption>
        </figure>`
      : '';
    return `
      <div class="profile-art" aria-label="头像与图集照片">
        ${avatar}
        ${snapHTML(picks[0], 'ph-a')}
        ${snapHTML(picks[1], 'ph-b')}
        ${snapHTML(picks[2], 'ph-c')}
        <span class="sparkle s1">✦</span>
        <span class="sparkle s2">✧</span>
        <span class="sparkle s3">✦</span>
      </div>`;
  }

  function profileInfoHTML() {
    const tags = (PROFILE.likeTags && PROFILE.likeTags.length ? PROFILE.likeTags : [PROFILE.likes])
      .filter(Boolean)
      .map((tag) => `<span class="info-tag">${esc(tag)}</span>`)
      .join('');
    return `
      <div class="profile-info">
        <article class="info-card">
          <p class="info-label">${ICONS.heart} 喜欢的东西</p>
          <div class="info-tag-row">${tags}</div>
        </article>
        <article class="info-card is-dislike">
          <p class="info-label">${ICONS.cloud} 不喜欢的东西</p>
          <p class="info-value">${esc(PROFILE.dislikes || '—')}</p>
        </article>
        <article class="info-card is-reading">
          <p class="info-label">${ICONS.book} ${esc(PROFILE.readingLabel || '近段时间阅读的书籍')}</p>
          <p class="info-value">${esc(PROFILE.reading || '—')}</p>
        </article>
      </div>`;
  }

  function profileSectionHTML() {
    const sorted = sortedImages();
    const peekPicks = pickIndices(sorted.length, 5).map((i) => sorted[i]);
    const peek = peekPicks.map(peekCardHTML).join('');
    const count = state.all.length;
    const essays = ESSAYS.slice(0, 2).map((essay, i) => `
      <a class="essay-peek-card" href="#/essays/${encodeURIComponent(essay.slug)}">
        <span class="mini-index">${pad2(i + 1)} · 随笔</span>
        <h3 class="mini-title">${esc(essay.title)}</h3>
        <p class="mini-excerpt">${esc(essay.excerpt)}</p>
        <p class="mini-meta"><span>${esc(essay.dateText)}</span><span>${esc(essay.chars)} 字</span><span>约 ${esc(essay.readMin)} 分钟</span></p>
      </a>`).join('');

    const quotes = QUOTES.map((quote, i) => {
      if (i === 0) {
        return `<figure class="quote-card quote-featured">
          <span class="quote-mark" aria-hidden="true">“</span>
          <blockquote>${esc(quote.text)}</blockquote>
          <figcaption>
            ${quote.original ? `<span class="quote-original">${esc(quote.original)}</span>` : ''}
            <span class="quote-source">${esc(quote.source)}</span>
          </figcaption>
        </figure>`;
      }
      return `<figure class="quote-card">
        <span class="quote-mark" aria-hidden="true">“</span>
        <blockquote>${esc(quote.text)}</blockquote>
        <figcaption><span class="quote-source">${esc(quote.source)}</span></figcaption>
      </figure>`;
    }).join('');

    return `
      <section class="profile-section" aria-labelledby="profileGalleryTitle">
        <header class="section-head">
          <h2 id="profileGalleryTitle">游戏图集</h2>
          <p class="section-sub">VRChat 里的一些瞬间，偶尔会来这儿看看。</p>
          <a class="head-link" href="#/gallery">看全部 ${count} 张 ${ICONS.arrow}</a>
        </header>
        <div class="peek-wall">
          ${peek}
          <a class="peek-cta" href="#/gallery">
            <span class="peek-cta-text">
              <strong>翻开整册图集</strong>
              <span>共 ${count} 张 · 可以按月份、文件名慢慢翻</span>
            </span>
            <span class="cta-arrow">${ICONS.arrow}</span>
          </a>
        </div>
      </section>

      <section class="profile-section" aria-labelledby="profileEssaysTitle">
        <header class="section-head">
          <h2 id="profileEssaysTitle">我的文章</h2>
          <p class="section-sub">写下来，才算真的想清楚一点。</p>
          <a class="head-link" href="#/essays">全部文章 ${ICONS.arrow}</a>
        </header>
        <div class="essay-peek">${essays || '<p class="section-sub">文章还在慢慢写。</p>'}</div>
      </section>

      <section class="profile-section quotes" aria-labelledby="quotesTitle">
        <header class="section-head">
          <h2 id="quotesTitle">我的名言</h2>
          <p class="section-sub">留一句给自己的话。</p>
        </header>
        <div class="quote-wall">${quotes}</div>
      </section>`;
  }

  function statusHTML() {
    const status = esc(PROFILE.status || '').replace(/VRChat/g, '<span class="hl">VRChat</span>');
    return `
      <section class="profile-status">
        <div class="status-card">
          <span class="status-icon">${ICONS.clock}</span>
          <div class="status-body">
            <p class="info-label">目前的状态</p>
            <p class="status-text">${status}</p>
          </div>
        </div>
      </section>`;
  }

  function bioHTML() {
    if (!PROFILE.bio) return '';
    return `
      <section class="profile-bio-wrap">
        <figure class="bio-card">
          <span class="bio-mark" aria-hidden="true">“</span>
          <p class="info-label">${ICONS.book} 简介</p>
          <blockquote class="bio-text">${esc(PROFILE.bio)}</blockquote>
        </figure>
      </section>`;
  }

  function renderProfile() {
    const view = dom.profile;
    if (!view) return;
    view.innerHTML = `
      <div class="profile-hero">
        <div class="profile-copy">
          <p class="eyebrow"><span class="dot"></span> 个人简介 · PROFILE</p>
          <h1 id="profileTitle"><span class="profile-name">${esc(PROFILE.name || 'lll')}</span><span class="profile-name-dot">.</span></h1>
          <div class="profile-meta">
            <span class="meta-chip"><span class="meta-k">性别</span><span class="meta-v">${esc(PROFILE.gender || '—')}</span></span>
            <span class="meta-chip"><span class="meta-k">MBTI</span><span class="meta-v">${esc(PROFILE.mbti || '—')}</span></span>
            <span class="meta-chip is-mono"><span class="meta-k">QQ</span><span class="meta-v">${esc(PROFILE.qq || '—')}</span></span>
          </div>
          <div class="profile-actions">
            <a class="btn btn-primary" href="#/gallery">翻看图集 ${ICONS.arrow}</a>
            <a class="btn btn-ghost" href="#/essays">读我的文章</a>
          </div>
        </div>
        ${profileArtHTML()}
      </div>
      ${profileInfoHTML()}
      ${statusHTML()}
      ${bioHTML()}
      ${profileSectionHTML()}`;
  }

  /* ---------- 图集 ---------- */
  function monthKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
  function monthLabel(d) { return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`; }

  function renderChips() {
    const groups = new Map();
    state.all.forEach((item) => {
      const key = monthKey(item.date);
      const g = groups.get(key) || { key, label: monthLabel(item.date), count: 0, ts: item.ts };
      g.count += 1;
      g.ts = Math.max(g.ts, item.ts);
      groups.set(key, g);
    });
    const months = Array.from(groups.values()).sort((a, b) => b.ts - a.ts);

    dom.chips.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'month-chip' + (state.month === 'all' ? ' is-on' : '');
    allBtn.dataset.month = 'all';
    allBtn.textContent = `全部 ${state.all.length}`;
    dom.chips.append(allBtn);

    months.forEach((m) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'month-chip' + (state.month === m.key ? ' is-on' : '');
      btn.dataset.month = m.key;
      btn.textContent = `${m.label.replace(' 年 ', '.').replace(' 月', '').replace(/\.(\d)$/, '.0$1')} · ${m.count}`;
      dom.chips.append(btn);
    });
  }

  function matches(item) {
    if (state.month !== 'all' && monthKey(item.date) !== state.month) return false;
    if (state.favOnly && !favorites.has(item.file)) return false;
    const q = state.query.trim().toLowerCase();
    if (q) {
      const hay = `${item.file} ${formatFull(item.date)} ${formatDate(item.date)} ${item.source}`.toLowerCase();
      const tokens = q.split(/\s+/).filter(Boolean);
      if (!tokens.every((t) => hay.includes(t))) return false;
    }
    return true;
  }

  function sortItems(list) {
    const arr = list.slice();
    if (state.sort === 'old') arr.sort((a, b) => a.ts - b.ts);
    else if (state.sort === 'name') arr.sort((a, b) => a.file.localeCompare(b.file, 'zh-Hans-CN', { numeric: true }));
    else arr.sort((a, b) => b.ts - a.ts);
    return arr;
  }

  let io = null;
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '80px 0px', threshold: 0.01 });
  }

  function cardEl(item) {
    const indexAll = state.all.indexOf(item);
    const card = document.createElement('article');
    card.className = 'card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.style.setProperty('--glow', item.accent);
    card.dataset.file = item.file;
    card.setAttribute('aria-label', `查看 ${formatFull(item.date)} 的图片`);

    const img = document.createElement('img');
    img.className = 'card-img';
    img.src = thumbOf(item);
    img.alt = `${formatFull(item.date)} · ${item.width}×${item.height}`;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.draggable = false;
    if (item.lqip) img.style.backgroundImage = `url("${item.lqip}")`;
    if (img.complete) img.classList.add('is-loaded');
    img.addEventListener('load', () => img.classList.add('is-loaded'));
    img.addEventListener('error', () => {
      if (item.thumb && img.dataset.fallback !== '1') {
        img.dataset.fallback = '1';
        img.src = item.full;
      }
    });

    const shade = document.createElement('div');
    shade.className = 'card-shade';

    const no = document.createElement('span');
    no.className = 'card-no';
    no.textContent = `#${pad2(indexAll + 1)}`;

    const fav = document.createElement('button');
    fav.type = 'button';
    fav.className = 'card-fav' + (favorites.has(item.file) ? ' is-fav' : '');
    fav.setAttribute('aria-label', '收藏这张图片');
    fav.setAttribute('aria-pressed', favorites.has(item.file) ? 'true' : 'false');
    fav.innerHTML = ICONS.heart;
    fav.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFav(item.file, true);
    });

    const info = document.createElement('div');
    info.className = 'card-info';
    const left = document.createElement('div');
    const dateEl = document.createElement('span');
    dateEl.className = 'card-date';
    dateEl.textContent = formatDate(item.date);
    const subEl = document.createElement('span');
    subEl.className = 'card-sub';
    subEl.textContent = `${formatTime(item.date)} · ${item.width}×${item.height}`;
    left.append(dateEl, subEl);
    const sizeEl = document.createElement('span');
    sizeEl.className = 'card-size';
    sizeEl.textContent = formatBytes(item.bytes);
    info.append(left, sizeEl);

    card.append(img, shade, no, fav, info);
    card.addEventListener('click', () => openLightbox(state.view.indexOf(item)));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openLightbox(state.view.indexOf(item));
      }
    });
    return card;
  }

  function renderGrid() {
    const list = sortItems(state.all.filter(matches));
    state.view = list;
    dom.grid.innerHTML = '';
    const frag = document.createDocumentFragment();
    list.forEach((item, i) => {
      const card = cardEl(item);
      card.style.transitionDelay = `${Math.min(i, 12) * 35}ms`;
      frag.append(card);
    });
    dom.grid.append(frag);
    $$('.card', dom.grid).forEach((c) => {
      if (io) io.observe(c);
      else c.classList.add('in');
    });

    const empty = list.length === 0;
    dom.empty.hidden = !empty;
    dom.grid.hidden = empty;
    if (empty) {
      dom.emptyText.textContent = state.all.length === 0
        ? '图集里还没有图片，往 material-library/image/ 里放几张再刷新吧～'
        : '没有匹配的图片，换个关键词或清除筛选试试～';
    }
  }

  function refresh() {
    renderChips();
    renderGrid();
    dom.favCount.textContent = String(favorites.size);
    dom.favBtn.classList.toggle('is-on', state.favOnly);
    dom.favBtn.setAttribute('aria-pressed', state.favOnly ? 'true' : 'false');
    $$('.seg button').forEach((b) => b.classList.toggle('is-on', b.dataset.sort === state.sort));
  }

  /* ---------- 收藏 ---------- */
  function toggleFav(file, withToast) {
    if (favorites.has(file)) {
      favorites.delete(file);
      if (withToast) toast('已取消收藏');
    } else {
      favorites.add(file);
      if (withToast) toast('已加入收藏 ♥');
      vibrate(8);
    }
    writeJSON(STORE.favs, Array.from(favorites));
    dom.favCount.textContent = String(favorites.size);
    syncFavButtons();
    if (state.favOnly) {
      const wasOpen = !dom.lb.hidden;
      const currentFile = wasOpen && currentItem() ? currentItem().file : null;
      renderGrid();
      if (wasOpen) {
        const idx = currentFile ? state.view.findIndex((i) => i.file === currentFile) : -1;
        if (idx >= 0) { state.current = idx; buildStrip(); showCurrent(); }
        else closeLightbox({ silent: true });
      }
    }
  }

  function syncFavButtons() {
    const isFav = favorites.has(currentItem() ? currentItem().file : '');
    dom.lbFav.classList.toggle('is-fav', isFav);
    $$('.card', dom.grid).forEach((card) => {
      const on = favorites.has(card.dataset.file);
      const btn = $('.card-fav', card);
      if (btn) {
        btn.classList.toggle('is-fav', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    });
  }

  /* ---------- 灯箱 ---------- */
  const currentItem = () => state.view[state.current] || null;
  let lastFocus = null;
  let closeToken = 0;

  function photoHash(file) {
    return '#/gallery/' + encodeURIComponent(file);
  }

  function openLightbox(index, opts) {
    if (index < 0 || index >= state.view.length) return;
    closeToken += 1;
    if (dom.lb.hidden) lastFocus = document.activeElement;
    state.current = index;
    dom.lb.hidden = false;
    document.body.style.overflow = 'hidden';
    const sbw = window.innerWidth - document.documentElement.clientWidth;
    if (sbw > 0) document.body.style.paddingRight = sbw + 'px';
    requestAnimationFrame(() => dom.lb.classList.add('is-open'));
    buildStrip();
    showCurrent();
    if (!(opts && opts.skipHash) && state.route.name === 'gallery') {
      try { history.replaceState(null, '', photoHash(currentItem().file)); } catch (_) {}
    }
    setTimeout(() => {
      const on = $('.lb-strip button.is-on', dom.lbStrip);
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
    }, 80);
    setTimeout(() => { const btn = $('#lbClose'); if (btn) btn.focus({ preventScroll: true }); }, 40);
  }

  function closeLightbox(opts) {
    if (dom.lb.hidden) return;
    stopSlideshow();
    dom.lb.classList.remove('is-open');
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
    if (!(opts && opts.silent) && state.route.name === 'gallery') {
      try { history.replaceState(null, '', '#/gallery'); } catch (_) {}
    }
    const token = ++closeToken;
    setTimeout(() => {
      if (token !== closeToken) return;
      dom.lb.hidden = true;
      dom.lbImg.removeAttribute('src');
      dom.lbImg.classList.remove('is-loaded');
    }, 320);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  function preloadNeighbors() {
    [state.current - 1, state.current + 1].forEach((i) => {
      const item = state.view[i];
      if (item) { const im = new Image(); im.src = item.full; }
    });
  }

  function showCurrent() {
    const item = currentItem();
    if (!item) return;
    dom.lb.style.setProperty('--glow', item.accent);
    dom.lbIndex.textContent = `${pad2(state.current + 1)} / ${pad2(state.view.length)}`;
    dom.lbName.textContent = item.file;
    dom.lbName.title = item.file;

    dom.lbImg.classList.remove('is-loaded');
    dom.lbLoading.classList.remove('is-done');
    const token = String(state.current) + item.file;
    dom.lbImg.dataset.token = token;
    dom.lbImg.onload = () => {
      if (dom.lbImg.dataset.token !== token) return;
      dom.lbImg.classList.add('is-loaded');
      dom.lbLoading.classList.add('is-done');
      preloadNeighbors();
    };
    dom.lbImg.onerror = () => {
      dom.lbLoading.classList.add('is-done');
      toast('这张原图加载失败了…');
    };
    dom.lbImg.src = item.full;
    dom.lbImg.alt = `${formatFull(item.date)} · ${item.file}`;
    if (dom.lbImg.complete && dom.lbImg.naturalWidth) {
      dom.lbImg.classList.add('is-loaded');
      dom.lbLoading.classList.add('is-done');
      preloadNeighbors();
    }

    dom.lbMeta.innerHTML = '';
    [formatFull(item.date), `${item.width}×${item.height}`, formatBytes(item.bytes), item.source]
      .forEach((text) => {
        const span = document.createElement('span');
        span.textContent = text;
        dom.lbMeta.append(span);
      });

    dom.lbPrev.disabled = state.current <= 0;
    dom.lbNext.disabled = state.current >= state.view.length - 1;
    syncFavButtons();
    markStrip();
    restartProgress();
  }

  function step(delta) {
    const next = state.current + delta;
    if (next < 0 || next >= state.view.length) return;
    state.current = next;
    showCurrent();
    if (state.route.name === 'gallery') {
      try { history.replaceState(null, '', photoHash(currentItem().file)); } catch (_) {}
    }
    if (state.playing) scheduleNextSlide();
    const on = $('.lb-strip button.is-on', dom.lbStrip);
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }

  function buildStrip() {
    dom.lbStrip.innerHTML = '';
    state.view.forEach((item, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.index = String(i);
      btn.setAttribute('aria-label', `第 ${i + 1} 张`);
      const img = document.createElement('img');
      img.src = thumbOf(item);
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      btn.append(img);
      btn.addEventListener('click', () => {
        state.current = i;
        showCurrent();
        if (state.route.name === 'gallery') {
          try { history.replaceState(null, '', photoHash(currentItem().file)); } catch (_) {}
        }
      });
      dom.lbStrip.append(btn);
    });
    markStrip();
  }

  function markStrip() {
    $$('.lb-strip button', dom.lbStrip).forEach((btn, i) => {
      btn.classList.toggle('is-on', i === state.current);
    });
  }

  /* ---------- 幻灯片 ---------- */
  function restartProgress() {
    const bar = $('i', dom.lbProgress);
    if (!bar) return;
    bar.style.transition = 'none';
    bar.style.width = '0%';
    void bar.offsetWidth;
    if (state.playing) {
      bar.style.transition = 'width 5s linear';
      bar.style.width = '100%';
    }
  }
  function scheduleNextSlide() {
    clearInterval(state.timer);
    if (!state.playing) return;
    state.timer = setInterval(() => {
      if (!state.view.length) return;
      state.current = (state.current + 1) % state.view.length;
      showCurrent();
      if (state.route.name === 'gallery') {
        try { history.replaceState(null, '', photoHash(currentItem().file)); } catch (_) {}
      }
    }, 5000);
  }
  function startSlideshow() {
    if (state.view.length < 2) { toast('至少要有两张图才能放幻灯片哦'); return; }
    state.playing = true;
    dom.lb.classList.add('is-playing');
    dom.lbPlay.classList.add('is-playing');
    dom.lbPlay.setAttribute('aria-pressed', 'true');
    scheduleNextSlide();
    restartProgress();
    toast('开始播放，每 5 秒一张');
  }
  function stopSlideshow() {
    state.playing = false;
    clearInterval(state.timer);
    state.timer = 0;
    dom.lb.classList.remove('is-playing');
    dom.lbPlay.classList.remove('is-playing');
    dom.lbPlay.setAttribute('aria-pressed', 'false');
    const bar = $('i', dom.lbProgress);
    if (bar) { bar.style.transition = 'none'; bar.style.width = '0%'; }
  }

  /* ---------- 提示 ---------- */
  let toastTimer = 0;
  function toast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom.toast.classList.remove('show'), 2200);
  }

  /* ---------- 文章 ---------- */
  function essayBySlug(slug) {
    return ESSAYS.find((e) => e.slug === slug) || null;
  }

  function renderEssaysList() {
    const view = dom.essays;
    if (!view) return;
    const cards = ESSAYS.map((essay, i) => `
      <a class="essay-card" href="#/essays/${encodeURIComponent(essay.slug)}">
        <span class="essay-num">${pad2(i + 1)}</span>
        <div class="essay-main">
          <h2 class="essay-title">${esc(essay.title)}</h2>
          <p class="essay-excerpt">${esc(essay.excerpt)}</p>
          <p class="essay-meta">
            <span>${esc(essay.dateText)}</span>
            <span>${esc(essay.chars)} 字</span>
            <span>约 ${esc(essay.readMin)} 分钟</span>
          </p>
        </div>
        <span class="essay-go" aria-hidden="true">${ICONS.chevronRight}</span>
      </a>`).join('');

    view.innerHTML = `
      <header class="page-head">
        <p class="eyebrow"><span class="dot"></span> 我的文章 · ESSAYS</p>
        <h1 id="essaysTitle">我的<em>文章</em></h1>
        <p class="lede">一些关于世界、穷人、爱和经济的想法。慢慢写，慢慢改；想清楚了，就放在这里。</p>
      </header>
      <div class="essays-wrap">
        <div class="essay-list">${cards || '<p class="section-sub">文章还在写，过阵子再来看看。</p>'}</div>
      </div>`;
  }

  function articleBodyHTML(blocks) {
    let html = '';
    let inList = false;
    (blocks || []).forEach((block) => {
      const text = esc(block.text || '');
      if (block.t === 'li') {
        if (!inList) { html += '<ul>'; inList = true; }
        html += `<li>${text}</li>`;
        return;
      }
      if (inList) { html += '</ul>'; inList = false; }
      if (block.t === 'h3') html += `<h3>${text}</h3>`;
      else if (block.t === 'kicker') html += `<p class="essay-kicker">${text}</p>`;
      else html += `<p>${text}</p>`;
    });
    if (inList) html += '</ul>';
    return html;
  }

  function renderEssay(slug) {
    const view = dom.essay;
    if (!view) return;
    const index = ESSAYS.findIndex((e) => e.slug === slug);
    const essay = index >= 0 ? ESSAYS[index] : null;
    if (!essay) {
      view.innerHTML = `
        <div class="article-wrap">
          <a class="article-back" href="#/essays">${ICONS.chevronLeft} 我的文章</a>
          <header class="article-head">
            <p class="eyebrow">随笔 · ESSAY</p>
            <h1 id="essayTitle">这篇文章不见了</h1>
          </header>
          <p class="lede">可能链接旧了，回文章列表看看吧。</p>
        </div>`;
      return;
    }
    const prev = ESSAYS[index - 1] || null;
    const next = ESSAYS[index + 1] || null;
    const nav = (prev || next) ? `
      <nav class="article-nav" aria-label="文章翻页">
        ${prev ? `<a href="#/essays/${encodeURIComponent(prev.slug)}">
          <span class="nav-label">← 上一篇</span>
          <span class="nav-title">${esc(prev.title)}</span>
        </a>` : '<span></span>'}
        ${next ? `<a class="is-next" href="#/essays/${encodeURIComponent(next.slug)}">
          <span class="nav-label">下一篇 →</span>
          <span class="nav-title">${esc(next.title)}</span>
        </a>` : '<span></span>'}
      </nav>` : '';

    view.innerHTML = `
      <div class="article-wrap">
        <a class="article-back" href="#/essays">${ICONS.chevronLeft} 我的文章</a>
        <header class="article-head">
          <p class="eyebrow"><span class="dot"></span> 随笔 · ESSAY</p>
          <h1 id="essayTitle">${esc(essay.title)}</h1>
          <div class="article-meta">
            <span>${esc(essay.dateText)}</span>
            <span>${esc(essay.chars)} 字</span>
            <span>约 ${esc(essay.readMin)} 分钟</span>
          </div>
          <div class="article-rule" aria-hidden="true"></div>
        </header>
        <article class="article-body">${articleBodyHTML(essay.blocks)}</article>
        ${essay.note ? `<p class="article-note">${esc(essay.note)}</p>` : ''}
        <p class="article-end" aria-hidden="true">· 完 ·</p>
        ${nav}
      </div>`;
    updateReadProgress();
  }

  function updateReadProgress() {
    if (state.route.name !== 'essay') {
      dom.readProgress.hidden = true;
      return;
    }
    dom.readProgress.hidden = false;
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    const bar = $('i', dom.readProgress);
    if (bar) bar.style.width = `${(ratio * 100).toFixed(2)}%`;
  }

  /* ---------- 路由 ---------- */
  function safeDecode(text) {
    try { return decodeURIComponent(text); } catch (_) { return text; }
  }

  function parseHash() {
    const raw = (location.hash || '').replace(/^#/, '');
    const parts = raw.split('?')[0].split('/').filter(Boolean);
    if (!parts.length) return { name: 'welcome', file: null, slug: null };
    const head = parts[0];
    const tail = parts[1] ? safeDecode(parts.slice(1).join('/')) : null;
    if (head === 'profile') return { name: 'profile', file: null, slug: null };
    if (head === 'gallery') return { name: 'gallery', file: tail, slug: null };
    if (head === 'essays') {
      if (tail) return { name: 'essay', file: null, slug: tail };
      return { name: 'essays', file: null, slug: null };
    }
    if (head === 'can') return { name: 'can', file: null, slug: null };
    return { name: 'welcome', file: null, slug: null };
  }

  const TITLES = {
    welcome: '欢迎',
    profile: '个人简介',
    gallery: '游戏图集',
    essays: '我的文章',
    essay: '我的文章',
    can: '我能做什么的'
  };

  function setActiveNav(name) {
    const key = name === 'essay' ? 'essays' : name;
    $$('.nav-links a').forEach((a) => {
      const on = a.dataset.nav === key;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function hideViews() {
    Object.keys(dom.views).forEach((key) => { dom.views[key].hidden = true; });
  }

  function playViewAnimation(view) {
    view.classList.remove('is-enter');
    void view.offsetWidth;
    view.classList.add('is-enter');
  }

  function scrollTop() {
    const root = document.documentElement;
    const prev = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    root.style.scrollBehavior = prev;
  }

  function closeMobileMenu() {
    dom.nav.classList.remove('is-menu-open');
    dom.navToggle.setAttribute('aria-expanded', 'false');
  }

  function setWelcomeMode(on) {
    document.body.classList.toggle('is-welcome', on);
    dom.welcome.hidden = !on;
    dom.app.hidden = on;
    if (on) {
      dom.welcome.classList.remove('is-enter');
      void dom.welcome.offsetWidth;
      dom.welcome.classList.add('is-enter');
      renderWelcomeArt();
      startQuoteRotation();
      stopSlideshow();
      if (!dom.lb.hidden) closeLightbox({ silent: true });
      dom.readProgress.hidden = true;
    } else {
      stopQuoteRotation();
    }
  }

  function renderRoute(route, opts) {
    opts = opts || {};
    state.route = route;
    closeMobileMenu();
    document.title = `${TITLES[route.name] || '小站'} · ${SITE_NAME}`;

    if (route.name === 'welcome') {
      setWelcomeMode(true);
      scrollTop();
      return;
    }
    setWelcomeMode(false);
    hideViews();
    const view = dom.views[route.name];
    if (!view) return;
    setActiveNav(route.name);

    if (route.name === 'profile') {
      renderProfile();
    } else if (route.name === 'gallery') {
      refresh();
    } else if (route.name === 'essays') {
      renderEssaysList();
    } else if (route.name === 'essay') {
      renderEssay(route.slug);
      const essay = essayBySlug(route.slug);
      if (essay) document.title = `${essay.title} · ${SITE_NAME}`;
    }

    view.hidden = false;
    playViewAnimation(view);
    dom.readProgress.hidden = route.name !== 'essay';
    if (!opts.keepScroll) scrollTop();
    updateReadProgress();

    if (route.name === 'gallery') {
      if (route.file) {
        const index = state.view.findIndex((i) => i.file === route.file);
        if (index >= 0) openLightbox(index, { skipHash: true });
        else if (!dom.lb.hidden) closeLightbox({ silent: true });
      } else if (!dom.lb.hidden) {
        closeLightbox({ silent: true });
      }
    } else if (!dom.lb.hidden) {
      closeLightbox({ silent: true });
    }
  }

  /* ---------- 事件 ---------- */
  function initEvents() {
    dom.search.addEventListener('input', () => {
      state.query = dom.search.value;
      renderGrid();
    });
    dom.search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        dom.search.value = '';
        state.query = '';
        renderGrid();
        dom.search.blur();
      }
    });

    $$('.seg button').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.sort = btn.dataset.sort;
        refresh();
      });
    });

    dom.chips.addEventListener('click', (e) => {
      const btn = e.target.closest('.month-chip');
      if (!btn) return;
      state.month = btn.dataset.month;
      renderChips();
      renderGrid();
    });

    dom.favBtn.addEventListener('click', () => {
      state.favOnly = !state.favOnly;
      refresh();
    });

    dom.resetBtn.addEventListener('click', () => {
      state.month = 'all';
      state.favOnly = false;
      state.query = '';
      dom.search.value = '';
      refresh();
      toast('筛选已清除');
    });

    $('#lbClose').addEventListener('click', () => closeLightbox());
    $('#lbBackdrop').addEventListener('click', () => closeLightbox());
    dom.lbPrev.addEventListener('click', () => step(-1));
    dom.lbNext.addEventListener('click', () => step(1));
    dom.lbFav.addEventListener('click', () => {
      const item = currentItem();
      if (item) toggleFav(item.file, true);
    });
    $('#lbOpen').addEventListener('click', () => {
      const item = currentItem();
      if (item) window.open(item.full, '_blank', 'noopener');
    });
    $('#lbDownload').addEventListener('click', () => {
      const item = currentItem();
      if (!item) return;
      const a = document.createElement('a');
      a.href = item.full;
      a.download = item.file;
      document.body.append(a);
      a.click();
      a.remove();
      toast('开始下载原图');
    });
    $('#lbLink').addEventListener('click', async () => {
      const item = currentItem();
      const base = location.href.split('#')[0];
      const url = item ? `${base}${photoHash(item.file)}` : location.href;
      try {
        await navigator.clipboard.writeText(url);
        toast('链接已复制');
      } catch (_) {
        window.prompt('复制这个链接：', url);
      }
    });
    dom.lbPlay.addEventListener('click', () => {
      if (state.playing) { stopSlideshow(); toast('已暂停'); }
      else startSlideshow();
    });

    /* 导航 */
    dom.navToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !dom.nav.classList.contains('is-menu-open');
      dom.nav.classList.toggle('is-menu-open', open);
      dom.navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', (e) => {
      if (!dom.nav.classList.contains('is-menu-open')) return;
      if (dom.nav.contains(e.target)) return;
      closeMobileMenu();
    });
    dom.navLinks.addEventListener('click', (e) => {
      if (e.target.closest('a')) closeMobileMenu();
    });

    /* 图集预览：点开某张就跳到图集里的大图 */
    document.addEventListener('click', (e) => {
      const peek = e.target.closest('.peek-card');
      if (!peek || !peek.dataset.file) return;
      e.preventDefault();
      const next = photoHash(peek.dataset.file);
      if (location.hash === next) renderRoute(parseHash());
      else location.hash = next;
    });

    /* 键盘 */
    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (!dom.lb.hidden) {
        if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); return; }
        if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); step(1); return; }
        if (e.key === 'Home') { e.preventDefault(); state.current = 0; showCurrent(); return; }
        if (e.key === 'End') { e.preventDefault(); state.current = state.view.length - 1; showCurrent(); return; }
        if ((e.key === 'f' || e.key === 'F') && !typing) {
          const item = currentItem();
          if (item) toggleFav(item.file, true);
          return;
        }
        if (e.key === ' ' && !typing) {
          e.preventDefault();
          if (state.playing) { stopSlideshow(); toast('已暂停'); } else startSlideshow();
          return;
        }
        if (e.key === 'Tab') {
          const focusables = $$('button, [href], input, [tabindex]:not([tabindex="-1"])', dom.lb)
            .filter((el) => !el.disabled && el.offsetParent !== null);
          if (!focusables.length) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
        return;
      }
      if (typing) return;
      if (state.route.name === 'gallery' && e.key === '/') {
        e.preventDefault();
        dom.search.focus();
        dom.search.select();
      }
      if (e.key === 'Escape') closeMobileMenu();
    });

    /* 触屏左右滑动 */
    let touchStart = null;
    const stage = $('.lb-stage');
    stage.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      touchStart = { x: e.clientX, y: e.clientY };
    });
    stage.addEventListener('pointerup', (e) => {
      if (!touchStart) return;
      const dx = e.clientX - touchStart.x;
      const dy = e.clientY - touchStart.y;
      touchStart = null;
      if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) step(dx > 0 ? -1 : 1);
    });
    stage.addEventListener('pointercancel', () => { touchStart = null; });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.playing) stopSlideshow();
      if (document.hidden) stopQuoteRotation();
      else if (state.route.name === 'welcome') startQuoteRotation();
    });

    window.addEventListener('scroll', updateReadProgress, { passive: true });
    window.addEventListener('resize', updateReadProgress);

    /* 打开图片文件夹（仅在本地服务器下可用） */
    dom.folderBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('api/openfolder', { method: 'GET' });
        if (!res.ok) throw new Error('no');
        toast('已在资源管理器中打开图片文件夹');
      } catch (_) {
        toast('需要用「启动网站.bat」打开网站才能使用这个按钮');
      }
    });
  }

  /* ---------- 背景音乐 ---------- */
  const musicList = (Array.isArray(IMAGES_RAW.music) ? IMAGES_RAW.music : []).filter((m) => m && m.file);
  const playerEl = $('#player');
  const bgm = $('#bgm');
  const seekEl = $('#playerSeek');
  const volEl = $('#playerVolume');
  const lyricEl = $('#trackLyric');
  const playState = { index: 0, volume: 0.2, lastNonZero: 0.2, lyricPos: -1 };
  let fadeTimer = 0;
  let lyricFade = 0;

  function paintRange(input, ratio) {
    const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
    input.style.background = `linear-gradient(to right, var(--accent), var(--accent-2) ${pct}%, var(--line-strong) ${pct}%, var(--line-strong) 100%)`;
  }
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    return `${Math.floor(sec / 60)}:${pad2(Math.floor(sec % 60))}`;
  }
  function currentTrack() { return musicList[playState.index] || null; }
  function setPlayingUI(on) {
    playerEl.classList.toggle('is-playing', on);
    $('#playerPlay').setAttribute('aria-label', on ? '暂停背景音乐' : '播放背景音乐');
  }
  function applyVolume(pct, persist) {
    const value = Math.max(0, Math.min(100, Number(pct) || 0));
    playState.volume = value / 100;
    if (value > 0) playState.lastNonZero = playState.volume;
    bgm.volume = playState.volume;
    volEl.value = String(Math.round(value));
    paintRange(volEl, value / 100);
    playerEl.classList.toggle('is-muted', value === 0);
    if (persist) writeJSON(MUSIC_STORE.volume, Math.round(value));
  }
  function fadeTo(target, ms) {
    clearInterval(fadeTimer);
    const from = bgm.volume;
    const started = performance.now();
    fadeTimer = setInterval(() => {
      const k = Math.min(1, (performance.now() - started) / ms);
      const v = from + (target - from) * k;
      bgm.volume = v;
      volEl.value = String(Math.round(v * 100));
      paintRange(volEl, v);
      if (k >= 1) clearInterval(fadeTimer);
    }, 60);
  }
  function tryPlay(withFade) {
    if (!bgm.paused) return;
    const target = playState.volume;
    if (withFade) {
      bgm.volume = 0;
      paintRange(volEl, 0);
    }
    const promise = bgm.play();
    if (!promise || typeof promise.then !== 'function') {
      setPlayingUI(true);
      bgm.volume = target;
      paintRange(volEl, target);
      return;
    }
    promise.then(() => {
      setPlayingUI(true);
      if (withFade) fadeTo(target, 1600);
      else {
        bgm.volume = target;
        paintRange(volEl, target);
      }
    }).catch(() => {
      bgm.volume = target;
      paintRange(volEl, target);
      setPlayingUI(false);
      toast('播放没成功，再点一次试试～');
    });
  }
  function pauseMusic() {
    clearInterval(fadeTimer);
    bgm.pause();
    setPlayingUI(false);
  }
  function updateLyric(t) {
    const track = currentTrack();
    if (!track || !Array.isArray(track.lrc) || !track.lrc.length) return;
    const lrc = track.lrc;
    let lo = 0;
    let hi = lrc.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lrc[mid].t <= t) { idx = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    if (idx === playState.lyricPos) return;
    playState.lyricPos = idx;
    const line = idx >= 0 ? lrc[idx].s : '♪ 前奏';
    lyricEl.style.opacity = '0';
    clearTimeout(lyricFade);
    lyricFade = setTimeout(() => {
      lyricEl.textContent = line;
      lyricEl.style.opacity = '1';
    }, 120);
  }
  function loadTrack(index, autoplay) {
    const track = musicList[index];
    if (!track) return;
    playState.index = index;
    playState.lyricPos = -1;
    bgm.src = MUSIC_BASE + encodePath(track.file);
    $('#trackTitle').textContent = track.title || track.file;
    $('#trackArtist').textContent = track.artist ? `${track.artist} · 背景音乐` : '背景音乐';
    const cover = $('#trackCover');
    if (track.cover) {
      cover.src = encodePath(track.cover);
      cover.hidden = false;
    } else {
      cover.hidden = true;
      cover.removeAttribute('src');
    }
    $('#trackNow').textContent = '0:00';
    $('#trackDur').textContent = '0:00';
    seekEl.value = '0';
    paintRange(seekEl, 0);
    lyricEl.textContent = (Array.isArray(track.lrc) && track.lrc.length) ? '♪ 轻轻放着' : '轻轻放着的背景音乐';
    if (autoplay) tryPlay(true);
  }
  function setCollapsed(on) {
    playerEl.classList.toggle('is-min', on);
    document.body.classList.toggle('player-expanded', !on);
  }
  function initPlayer() {
    if (!musicList.length) return;
    playerEl.hidden = false;

    const savedVolume = Number(readJSON(MUSIC_STORE.volume, 20));
    const volumePct = isFinite(savedVolume) ? Math.max(0, Math.min(100, savedVolume)) : 20;
    applyVolume(volumePct, false);

    // 播放器默认收成左下角的小圆钮，绝不自动展开、也不会自动播放
    setCollapsed(true);

    loadTrack(0, false);

    bgm.addEventListener('loadedmetadata', () => {
      $('#trackDur').textContent = fmtTime(bgm.duration);
    });
    bgm.addEventListener('timeupdate', () => {
      if (!bgm.duration) return;
      const ratio = bgm.currentTime / bgm.duration;
      seekEl.value = String(Math.round(ratio * 1000));
      paintRange(seekEl, ratio);
      $('#trackNow').textContent = fmtTime(bgm.currentTime);
      updateLyric(bgm.currentTime);
    });
    bgm.addEventListener('ended', () => {
      if (musicList.length > 1) {
        loadTrack((playState.index + 1) % musicList.length, true);
        return;
      }
      bgm.currentTime = 0;
      setPlayingUI(false);
    });
    bgm.addEventListener('play', () => setPlayingUI(true));
    bgm.addEventListener('pause', () => setPlayingUI(false));

    $('#playerPlay').addEventListener('click', () => {
      if (bgm.paused) tryPlay(false);
      else pauseMusic();
    });
    $('#playerMute').addEventListener('click', () => {
      if (bgm.volume > 0) applyVolume(0, true);
      else applyVolume(playState.lastNonZero * 100, true);
    });
    volEl.addEventListener('input', () => {
      clearInterval(fadeTimer);
      applyVolume(Number(volEl.value), true);
    });
    seekEl.addEventListener('input', () => {
      if (!bgm.duration) return;
      bgm.currentTime = (Number(seekEl.value) / 1000) * bgm.duration;
      paintRange(seekEl, Number(seekEl.value) / 1000);
    });
    $('#playerCollapse').addEventListener('click', () => setCollapsed(true));
    $('#playerMini').addEventListener('click', () => setCollapsed(false));
  }

  /* ---------- 启动 ---------- */
  function boot() {
    initTheme();
    buildInitialImages();
    initPlayer();
    initEvents();
    renderRoute(parseHash(), { initial: true });
    window.addEventListener('hashchange', () => renderRoute(parseHash()));
    loadLiveImages();
    window.__siteReady = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
