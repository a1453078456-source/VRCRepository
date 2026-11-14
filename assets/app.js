/* ============================================================
   CuteImage · 交互逻辑
   ------------------------------------------------------------
   数据来源：优先读取本地服务器 /api/images（可自动发现新增图片），
   读不到就回退到 assets/data.js 里的静态清单。
   两个数据源都拿不到时页面也不会崩，只是显示空状态。
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 小工具 ---------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const pad2 = (n) => String(n).padStart(2, '0');
  const FILE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
  const SORT_LABEL = { new: '最新', old: '最早', name: '文件名' };
  const STORE = { theme: 'cuteimage:theme', favs: 'cuteimage:favs' };

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
  const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

  function hashAccent(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    const hue = (h * 7 + 320) % 360;
    return hslToHex(hue, 0.68, 0.63);
  }
  function hslToHex(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const seg = Math.floor(h / 60) % 6;
    const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg];
    return '#' + rgb.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
  }

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
    ready: false
  };
  const favorites = new Set(readJSON(STORE.favs, []));

  /* ---------- DOM ---------- */
  const dom = {
    grid: $('#grid'),
    empty: $('#empty'),
    emptyText: $('#emptyText'),
    chips: $('#chips'),
    search: $('#search'),
    countPill: $('#countPill'),
    favCount: $('#favCount'),
    favBtn: $('#favBtn'),
    resetBtn: $('#resetBtn'),
    shuffleBtn: $('#shuffleBtn'),
    themeBtn: $('#themeBtn'),
    heroStack: $('#heroStack'),
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
    lbLoading: $('#lbLoading')
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
  }
  dom.themeBtn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next, true);
  });

  /* ---------- 数据 ---------- */
  function normalize(raw, prev) {
    const file = raw.file;
    const stem = raw.stem || file.replace(FILE_EXT, '');
    const ts = Number(raw.timestamp) || Date.parse(raw.date) || 0;
    const date = raw.date ? new Date(raw.date) : new Date(ts || Date.now());
    const full = 'image/' + encodePath(file);
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
      full
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

  function renderAll() {
    renderStats();
    renderHero();
    refresh();
  }

  async function loadImages() {
    const fallback = (window.CUTE_IMAGES && Array.isArray(window.CUTE_IMAGES.images))
      ? window.CUTE_IMAGES.images
      : [];

    // 第一屏先用静态清单渲染，保证瞬间有内容（file:// 打开也能看）
    state.all = buildImages(fallback, fallback);
    const firstSignature = signature(state.all);
    renderAll();

    if (location.protocol === 'file:') return;

    // 再向本地服务器要一份最新清单：新增的图片会自动出现
    try {
      const res = await fetch('api/images', { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      if (!json || !Array.isArray(json.images)) return;
      state.live = true;
      dom.folderBtn.hidden = false;
      const next = buildImages(json.images, fallback);
      if (signature(next) === firstSignature) return;
      const wasInLightbox = !dom.lb.hidden;
      const currentFile = currentItem() ? currentItem().file : null;
      state.all = next;
      renderAll();
      if (wasInLightbox && currentFile) {
        const idx = state.view.findIndex((i) => i.file === currentFile);
        if (idx >= 0) { state.current = idx; buildStrip(); showCurrent(); }
        else closeLightbox();
      }
    } catch (_) { /* 没有服务器就用静态清单，正常 */ }
  }

  /* ---------- 统计与首屏 ---------- */
  function renderStats() {
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
    const set = (key, text) => {
      const el = document.querySelector(`[data-stat="${key}"]`);
      if (el) el.textContent = text;
    };
    set('count', String(count));
    set('size', formatBytes(total));
    set('span', span);
    dom.countPill.textContent = `${count} 张`;
  }

  function renderHero() {
    const picks = [];
    const sortedDesc = state.all.slice().sort((a, b) => b.ts - a.ts);
    const wanted = [0, 2, Math.max(0, sortedDesc.length - 1)];
    wanted.forEach((idx) => {
      const item = sortedDesc[idx];
      if (item && !picks.some((p) => p.file === item.file)) picks.push(item);
    });
    dom.heroStack.innerHTML = '';
    picks.slice(0, 3).forEach((item, i) => {
      const fig = document.createElement('figure');
      fig.className = 'polaroid';
      const img = document.createElement('img');
      img.src = item.thumb || item.full;
      img.alt = '';
      img.loading = i === 0 ? 'eager' : 'lazy';
      img.decoding = 'async';
      img.style.backgroundImage = item.lqip ? `url("${item.lqip}")` : '';
      const cap = document.createElement('figcaption');
      const d = document.createElement('span');
      d.textContent = formatDate(item.date);
      const t = document.createElement('span');
      t.textContent = `#${pad2(state.all.indexOf(item) + 1)}`;
      cap.append(d, t);
      fig.append(img, cap);
      dom.heroStack.append(fig);
    });
  }

  /* ---------- 筛选 / 排序 ---------- */
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

  /* ---------- 网格渲染 ---------- */
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
    img.src = item.thumb || item.full;
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
    fav.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.2-4.4-7.2-9.4A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.2 3C19.2 15.6 12 20 12 20Z"/></svg>';
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
        ? 'image/ 文件夹里还没有图片，放进去几张再刷新吧～'
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
        else closeLightbox();
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

  function openLightbox(index) {
    if (index < 0 || index >= state.view.length) return;
    closeToken += 1;
    lastFocus = document.activeElement;
    state.current = index;
    dom.lb.hidden = false;
    document.body.style.overflow = 'hidden';
    const sbw = window.innerWidth - document.documentElement.clientWidth;
    if (sbw > 0) document.body.style.paddingRight = sbw + 'px';
    requestAnimationFrame(() => dom.lb.classList.add('is-open'));
    buildStrip();
    showCurrent();
    updateHash(currentItem());
    setTimeout(() => {
      const on = $('.lb-strip button.is-on', dom.lbStrip);
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
    }, 80);
    setTimeout(() => $('#lbClose').focus({ preventScroll: true }), 40);
  }

  function closeLightbox() {
    stopSlideshow();
    dom.lb.classList.remove('is-open');
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
    updateHash(null);
    const token = ++closeToken;
    setTimeout(() => {
      if (token !== closeToken) return;
      dom.lb.hidden = true;
      dom.lbImg.removeAttribute('src');
      dom.lbImg.classList.remove('is-loaded');
    }, 320);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  function updateHash(item) {
    const base = location.pathname + location.search;
    try {
      if (item) {
        history.replaceState(null, '', `${base}#${encodeURIComponent(item.file)}`);
      } else if (location.hash) {
        const target = /^#(gallery|quotes|top)$/.test(location.hash) ? location.hash : '';
        history.replaceState(null, '', base + target);
      }
    } catch (_) { /* file:// 下部分浏览器不允许改地址栏，忽略即可 */ }
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
    const meta = [
      formatFull(item.date),
      `${item.width}×${item.height}`,
      formatBytes(item.bytes),
      item.source
    ];
    meta.forEach((text) => {
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
    updateHash(currentItem());
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
      img.src = item.thumb || item.full;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      btn.append(img);
      btn.addEventListener('click', () => {
        state.current = i;
        showCurrent();
        updateHash(currentItem());
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
      updateHash(currentItem());
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

  /* ---------- 事件绑定 ---------- */
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

  dom.shuffleBtn.addEventListener('click', () => {
    const pool = state.all;
    if (!pool.length) { toast('还没有图片呢'); return; }
    if (state.query || state.favOnly || state.month !== 'all') {
      state.query = '';
      state.month = 'all';
      state.favOnly = false;
      dom.search.value = '';
      refresh();
    }
    const pick = Math.floor(Math.random() * pool.length);
    const index = state.view.findIndex((i) => i.file === pool[pick].file);
    openLightbox(index >= 0 ? index : 0);
  });

  $('#lbClose').addEventListener('click', closeLightbox);
  $('#lbBackdrop').addEventListener('click', closeLightbox);
  dom.lbPrev.addEventListener('click', () => step(-1));
  dom.lbNext.addEventListener('click', () => step(1));
  dom.lbFav.addEventListener('click', () => {
    const item = currentItem();
    if (item) { toggleFav(item.file, true); }
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
    const url = location.href;
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
    if (e.key === '/') { e.preventDefault(); dom.search.focus(); dom.search.select(); }
    if (e.key === 'r' || e.key === 'R') dom.shuffleBtn.click();
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
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      step(dx > 0 ? -1 : 1);
    }
  });
  stage.addEventListener('pointercancel', () => { touchStart = null; });

  /* 页面可见性变化时暂停幻灯片 */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.playing) stopSlideshow();
  });

  /* 打开图片文件夹（仅在本地服务器下可用） */
  dom.folderBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('api/openfolder', { method: 'GET' });
      if (!res.ok) throw new Error('no');
      toast('已在资源管理器中打开 image 文件夹');
    } catch (_) {
      toast('需要用「启动网站.bat」打开网站才能使用这个按钮');
    }
  });

  /* ---------- 背景音乐 ---------- */
  const MUSIC_STORE = { volume: 'cuteimage:volume', on: 'cuteimage:musicOn', min: 'cuteimage:playerMin' };
  const musicList = (window.CUTE_IMAGES && Array.isArray(window.CUTE_IMAGES.music))
    ? window.CUTE_IMAGES.music.filter((m) => m && m.file)
    : [];
  const playerEl = $('#player');
  const bgm = $('#bgm');
  const seekEl = $('#playerSeek');
  const volEl = $('#playerVolume');
  const lyricEl = $('#trackLyric');
  const playState = { index: 0, want: readJSON(MUSIC_STORE.on, true) !== false, volume: 0.2, lastNonZero: 0.2, lyricPos: -1 };
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

  function setNeedsTap(on) {
    playerEl.classList.toggle('needs-tap', on);
    if (on) lyricEl.textContent = '点一下播放，放点背景音乐';
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
      setNeedsTap(false);
      playState.want = true;
      writeJSON(MUSIC_STORE.on, true);
      if (withFade) fadeTo(target, 1600);
      else {
        bgm.volume = target;
        paintRange(volEl, target);
      }
    }).catch(() => {
      bgm.volume = target;
      paintRange(volEl, target);
      setPlayingUI(false);
      setNeedsTap(true);
    });
  }

  function pauseMusic() {
    clearInterval(fadeTimer);
    bgm.pause();
    setPlayingUI(false);
    playState.want = false;
    writeJSON(MUSIC_STORE.on, false);
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
    bgm.src = 'music/' + encodePath(track.file);
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
    writeJSON(MUSIC_STORE.min, on);
  }

  function initPlayer() {
    if (!musicList.length) return;
    playerEl.hidden = false;

    const savedVolume = Number(readJSON(MUSIC_STORE.volume, 20));
    const volumePct = isFinite(savedVolume) ? Math.max(0, Math.min(100, savedVolume)) : 20;
    applyVolume(volumePct, false);

    const collapsed = readJSON(MUSIC_STORE.min, window.innerWidth < 640) === true;
    setCollapsed(collapsed);

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
      loadTrack((playState.index + 1) % musicList.length, true);
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

    // 浏览器不允许自动播放时，等用户第一次操作再开始
    const startOnGesture = (e) => {
      if (e.target instanceof Node && playerEl.contains(e.target)) return;
      if (playerEl.classList.contains('needs-tap') && playState.want !== false) tryPlay(false);
      document.removeEventListener('pointerdown', startOnGesture, true);
      document.removeEventListener('keydown', startOnGesture, true);
    };
    document.addEventListener('pointerdown', startOnGesture, true);
    document.addEventListener('keydown', startOnGesture, true);

    if (playState.want) setTimeout(() => tryPlay(true), 350);
  }

  /* ---------- 深链接 ---------- */
  function openFromHash() {
    if (!location.hash || location.hash.length < 2) return;
    const file = decodeURIComponent(location.hash.slice(1));
    if (/^(gallery|quotes|top)$/.test(file)) return;
    const index = state.view.findIndex((i) => i.file === file);
    if (index >= 0) openLightbox(index);
  }
  window.addEventListener('hashchange', () => {
    if (dom.lb.hidden) openFromHash();
  });

  /* ---------- 启动 ---------- */
  async function boot() {
    initTheme();
    initPlayer();
    dom.folderBtn.hidden = true;
    try {
      await loadImages();
    } catch (err) {
      console.error(err);
    }
    state.ready = true;
    dom.folderBtn.hidden = !state.live || !state.all.length;
    openFromHash();
  }

  boot();
})();
