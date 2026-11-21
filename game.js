'use strict';

(() => {
  /* ================= 常量与工具 ================= */

  const $ = (id) => document.getElementById(id);

  const SVG = {
    flag:
      '<svg viewBox="0 0 24 24"><path d="M7 21V3" stroke="#1b1b1b" stroke-width="2.6" stroke-linecap="round"/><path d="M7.2 3.2 19.6 8.6 7.2 14z" fill="currentColor"/><path d="M4 21h6" stroke="#1b1b1b" stroke-width="2.6" stroke-linecap="round"/></svg>',
    mine:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1"/></svg>',
    trophy:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v3.6a4 4 0 0 1-8 0V4Z"/><path d="M8 5H5v1.8A3 3 0 0 0 8 9.8M16 5h3v1.8a3 3 0 0 1-3 3"/><path d="M12 11.6V16M9 20h6M9.6 20l.4-4h4l.4 4"/></svg>',
    clock:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  };

  const PRESETS = [
    { key: 'beginner', name: '初级', rows: 9, cols: 9, mines: 10 },
    { key: 'intermediate', name: '中级', rows: 16, cols: 16, mines: 40 },
    { key: 'expert', name: '高级', rows: 16, cols: 30, mines: 99 },
    { key: 'custom', name: '自定义', rows: 12, cols: 12, mines: 24 },
  ];

  const LS_BEST = 'ms.best.v1';
  const LS_CUSTOM = 'ms.custom.v1';
  const LS_HISTORY = 'ms.history.v1';
  const LS_SOUND = 'ms.sound.v1';
  const DEFAULT_CUSTOM = { rows: 12, cols: 12, mines: 24 };
  const LONG_PRESS_MS = 360;

  // iOS 下 Web Audio 默认跟随静音键，用一段循环静音音频把会话切到播放模式
  const IS_IOS =
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const SILENT_WAV =
    'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';

  const state = {
    selected: 'beginner',
    custom: loadJSON(LS_CUSTOM, DEFAULT_CUSTOM),
    flagMode: false,
    sound: loadSound(),
    game: null,
    lastTouchAt: 0,
    touchHandled: false,
    longFired: false,
    pressMoved: false,
    pressScrollX: 0,
    pressScrollY: 0,
    scrolledAt: 0,
    pressTimer: null,
    pressIndex: null,
    pressX: 0,
    pressY: 0,
  };

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return { ...fallback };
      const parsed = JSON.parse(raw);
      return { ...fallback, ...parsed };
    } catch (err) {
      return { ...fallback };
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* 隐私模式下忽略存储失败 */
    }
  }

  function loadSound() {
    try {
      return localStorage.getItem(LS_SOUND) !== '0';
    } catch (err) {
      return true;
    }
  }

  /* ================= 音效（Web Audio 合成，无外部音频文件） ================= */

  const audio = {
    ctx: null,
    unlocked: false,
    silentEl: null,

    ensure() {
      if (!state.sound) return null;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (!this.ctx) {
        try {
          this.ctx = new Ctx();
        } catch (err) {
          return null;
        }
      }
      if (this.ctx.state !== 'running') {
        const resumed = this.ctx.resume();
        if (resumed && resumed.catch) resumed.catch(() => {});
      }
      return this.ctx;
    },

    /* 移动端必须在用户手势里解锁音频，iOS 还要求先播放一次音频 */
    unlock() {
      if (!state.sound) return;
      const ctx = this.ensure();
      if (!ctx) return;

      if (IS_IOS) {
        if (!this.silentEl) {
          const el = document.createElement('audio');
          el.setAttribute('playsinline', '');
          el.loop = true;
          el.preload = 'auto';
          el.volume = 0.01;
          el.src = SILENT_WAV;
          this.silentEl = el;
        }
        const played = this.silentEl.paused ? this.silentEl.play() : null;
        if (played && played.catch) played.catch(() => {});
      }

      if (this.unlocked) return;
      this.unlocked = true;

      try {
        const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
      } catch (err) {
        /* 解锁失败时忽略 */
      }
    },

    tone(freq, dur, opts = {}) {
      const ctx = this.ensure();
      if (!ctx) return;

      const start = ctx.currentTime + (opts.delay || 0);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      // 手机扬声器偏小，整体提升音量
      const level = Math.min(0.4, (opts.gain || 0.05) * 2.2);

      osc.type = opts.type || 'sine';
      osc.frequency.setValueAtTime(freq, start);
      if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, start + dur);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(level, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    },

    noise(dur, gainValue) {
      const ctx = this.ensure();
      if (!ctx) return;

      const length = Math.floor(ctx.sampleRate * dur);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
      }

      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      source.buffer = buffer;
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      gain.gain.value = Math.min(0.5, gainValue * 1.8);

      source.connect(filter).connect(gain).connect(ctx.destination);
      source.start();
    },

    reveal(count) {
      this.tone(520 + Math.random() * 60, 0.07, { type: 'triangle', gain: 0.035 });
      if (count >= 6) this.tone(380, 0.18, { type: 'sine', gain: 0.03, delay: 0.03 });
    },

    flag() {
      this.tone(760, 0.06, { type: 'square', gain: 0.022 });
      this.tone(1140, 0.05, { type: 'sine', gain: 0.018, delay: 0.05 });
    },

    unflag() {
      this.tone(430, 0.07, { type: 'triangle', gain: 0.022 });
    },

    tap() {
      this.tone(480 + Math.random() * 40, 0.04, { type: 'sine', gain: 0.015 });
    },

    pause() {
      this.tone(520, 0.14, { type: 'sine', gain: 0.035 });
      this.tone(360, 0.18, { type: 'sine', gain: 0.03, delay: 0.09 });
    },

    resume() {
      this.tone(400, 0.12, { type: 'sine', gain: 0.03 });
      this.tone(600, 0.16, { type: 'sine', gain: 0.035, delay: 0.08 });
    },

    undo() {
      this.tone(560, 0.1, { type: 'sine', gain: 0.03 });
      this.tone(390, 0.15, { type: 'sine', gain: 0.025, delay: 0.07 });
    },

    boom() {
      this.noise(0.55, 0.14);
      this.tone(170, 0.6, { to: 40, type: 'sawtooth', gain: 0.1 });
    },

    win() {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => {
        this.tone(freq, 0.22, { type: 'triangle', gain: 0.045, delay: index * 0.09 });
      });
    },
  };

  const SOUND_ON_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3L12 5.5v13L7 14.5H4z"/><path d="M16 8.5a5 5 0 0 1 0 7"/><path d="M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>';
  const SOUND_OFF_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3L12 5.5v13L7 14.5H4z"/><path d="M16 9.5l4 5M20 9.5l-4 5"/></svg>';

  function setSound(on, playTest) {
    state.sound = on;
    try {
      localStorage.setItem(LS_SOUND, on ? '1' : '0');
    } catch (err) {
      /* 忽略存储失败 */
    }

    const btn = $('btn-sound');
    btn.innerHTML = on ? SOUND_ON_ICON : SOUND_OFF_ICON;
    btn.classList.toggle('is-off', !on);
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? '音效：开' : '音效：关';

    if (on) {
      audio.unlock();
    } else if (audio.silentEl) {
      audio.silentEl.pause();
    }

    if (on && playTest) audio.tone(660, 0.09, { type: 'sine', gain: 0.04 });
  }

  let toastTimer = null;

  function showToast(message) {
    const node = $('toast');
    node.textContent = message;
    node.hidden = true;
    void node.offsetWidth;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      node.hidden = true;
    }, 1600);
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function formatClock(totalSeconds) {
    const sec = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  function bestMap() {
    return loadJSON(LS_BEST, {});
  }

  function bestKey(rows, cols, mines) {
    return `${rows}x${cols}x${mines}`;
  }

  function bestOf(diff) {
    const value = bestMap()[bestKey(diff.rows, diff.cols, diff.mines)];
    return Number.isFinite(value) ? value : null;
  }

  function diffOf(key) {
    if (key === 'custom') {
      return { key: 'custom', name: '自定义', ...state.custom };
    }
    const preset = PRESETS.find((item) => item.key === key) || PRESETS[0];
    return { key: preset.key, name: preset.name, rows: preset.rows, cols: preset.cols, mines: preset.mines };
  }

  /* ================= 对局记录 ================= */

  function loadHistory() {
    try {
      const raw = localStorage.getItem(LS_HISTORY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }

  function addRecord(game, win, secs) {
    const list = loadHistory();
    const record = {
      name: game.name,
      rows: game.rows,
      cols: game.cols,
      mines: game.mines,
      win,
      secs,
      at: Date.now(),
    };
    list.unshift(record);
    saveJSON(LS_HISTORY, list.slice(0, 100));
    return record;
  }

  function removeRecord(record) {
    if (!record) return;
    const list = loadHistory().filter(
      (item) => !(item.at === record.at && item.win === record.win && item.secs === record.secs)
    );
    saveJSON(LS_HISTORY, list);
  }

  function formatDateTime(timestamp) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function renderRecords() {
    const list = loadHistory();
    const total = list.length;
    const wins = list.filter((item) => item.win).length;
    const rate = total ? Math.round((wins / total) * 100) : 0;

    $('record-summary').innerHTML =
      '<div class="rs-card"><span>总场次</span><b>' + total + '</b></div>' +
      '<div class="rs-card"><span>胜利</span><b>' + wins + '</b></div>' +
      '<div class="rs-card"><span>胜率</span><b>' + rate + '%</b></div>';

    const wrap = $('record-list');
    if (!total) {
      wrap.innerHTML = '<p class="empty">还没有对局记录，先来一局吧</p>';
    } else {
      wrap.innerHTML = list
        .map((item) => {
          const badge = item.win
            ? '<span class="r-badge win">胜</span>'
            : '<span class="r-badge loss">负</span>';
          return (
            '<div class="record-item">' +
            badge +
            '<div class="r-main">' +
            '<span class="r-name">' + item.name +
            '<small>' + item.cols + ' × ' + item.rows + ' · ' + item.mines + ' 雷</small></span>' +
            '<span class="r-date">' + formatDateTime(item.at) + '</span>' +
            '</div>' +
            '<span class="r-time">' + formatClock(item.secs) + '</span>' +
            '</div>'
          );
        })
        .join('');
    }

    $('btn-clear-records').disabled = total === 0;
  }

  function resetClearButton() {
    clearArmed = false;
    clearTimeout(clearTimer);
    clearTimer = null;
    const btn = $('btn-clear-records');
    btn.textContent = '清空';
    btn.classList.remove('is-danger');
  }

  function handleClearRecords() {
    if (!loadHistory().length) return;
    const btn = $('btn-clear-records');

    if (!clearArmed) {
      clearArmed = true;
      btn.textContent = '再次点击清空';
      btn.classList.add('is-danger');
      clearTimer = setTimeout(resetClearButton, 3000);
      return;
    }

    saveJSON(LS_HISTORY, []);
    resetClearButton();
    renderRecords();
  }

  let clearArmed = false;
  let clearTimer = null;

  /* ================= 主界面 ================= */

  function renderDiffs() {
    const wrap = $('difficulty-list');
    wrap.innerHTML = '';

    PRESETS.forEach((preset) => {
      const diff = diffOf(preset.key);
      const best = bestOf(diff);
      const card = document.createElement('button');
      const selected = state.selected === preset.key;

      card.type = 'button';
      card.className = `diff-card${selected ? ' is-selected' : ''}`;
      card.dataset.key = preset.key;
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', String(selected));
      card.innerHTML =
        `<span class="d-name">${diff.name}</span>` +
        `<span class="d-meta">${diff.cols} × ${diff.rows} · ${diff.mines} 雷</span>` +
        `<span class="d-best">${SVG.clock} 最佳 <b>${best == null ? '--:--' : formatClock(best)}</b></span>`;

      card.addEventListener('click', () => {
        if (preset.key === 'custom') {
          state.selected = 'custom';
          renderDiffs();
          openCustom();
          return;
        }
        state.selected = preset.key;
        renderDiffs();
      });

      wrap.appendChild(card);
    });
  }

  const SCREENS = ['home', 'difficulty', 'records', 'game'];

  function showScreen(name) {
    SCREENS.forEach((key) => {
      $(`screen-${key}`).classList.toggle('is-active', key === name);
    });
    window.scrollTo(0, 0);
  }

  /* ================= 游戏构建 ================= */

  function startGame(diff) {
    const rows = diff.rows;
    const cols = diff.cols;
    const maxMines = Math.max(1, rows * cols - 9);
    const mines = Math.min(Math.max(1, diff.mines), maxMines);

    const g = {
      rows,
      cols,
      mines,
      name: diff.name || '自定义',
      cells: [],
      els: [],
      status: 'ready',
      prevStatus: null,
      revealed: 0,
      flags: 0,
      elapsed: 0,
      startAt: 0,
      running: false,
      timerId: null,
      history: [],
      lossRecord: null,
    };

    for (let i = 0; i < rows * cols; i++) {
      g.cells.push({ mine: false, adj: 0, state: 'hidden', exploded: false });
    }
    state.game = g;

    $('game-diff-name').textContent = g.name;
    $('game-diff-meta').textContent = `${cols} × ${rows} · ${mines} 雷`;
    $('stat-time').textContent = '00:00';
    $('game-tip').textContent = '首次点击不会踩雷';
    $('pause-overlay').hidden = true;
    $('result-overlay').hidden = true;
    $('btn-pause').classList.remove('is-active');
    $('board-wrap').classList.remove('is-paused');
    $('board').classList.remove('is-won', 'is-shaking');

    buildBoard(g);
    updateStats();
    updateUndo();
    showScreen('game');
    $('board-wrap').scrollLeft = 0;
    $('board-wrap').scrollTop = 0;
    requestAnimationFrame(fitBoard);
  }

  function buildBoard(g) {
    const board = $('board');
    board.innerHTML = '';
    g.els = new Map();
    g.view = { r0: -1, r1: -1, c0: -1, c1: -1 };
  }

  function fitBoard() {
    const g = state.game;
    if (!g) return;

    const wrap = $('board-wrap');
    const gap = 1;
    const pad = 3;
    const availW = wrap.clientWidth - 16 - gap * (g.cols - 1);
    const availH = wrap.clientHeight - 16 - gap * (g.rows - 1);
    const size = Math.max(16, Math.min(44, Math.floor(Math.min(availW / g.cols, availH / g.rows))));

    document.documentElement.style.setProperty('--cell', `${size}px`);

    // 大棋盘只渲染可视区域，棋盘本体用固定尺寸撑开滚动条
    const board = $('board');
    board.style.setProperty('--gap', `${gap}px`);
    board.style.width = `${g.cols * size + (g.cols - 1) * gap + pad * 2}px`;
    board.style.height = `${g.rows * size + (g.rows - 1) * gap + pad * 2}px`;

    syncView(true);
  }

  /* ================= 计时 ================= */

  function elapsedNow() {
    const g = state.game;
    if (!g) return 0;
    return g.running ? g.elapsed + (performance.now() - g.startAt) / 1000 : g.elapsed;
  }

  function tickTimer() {
    if (!state.game) return;
    $('stat-time').textContent = formatClock(elapsedNow());
  }

  function startTimer() {
    const g = state.game;
    if (!g) return;
    g.elapsed = 0;
    g.startAt = performance.now();
    g.running = true;
    clearInterval(g.timerId);
    g.timerId = setInterval(tickTimer, 200);
    tickTimer();
  }

  function pauseTimer() {
    const g = state.game;
    if (!g || !g.running) return;
    g.elapsed = elapsedNow();
    g.running = false;
    clearInterval(g.timerId);
    g.timerId = null;
    tickTimer();
  }

  function resumeTimer() {
    const g = state.game;
    if (!g || g.running) return;
    g.startAt = performance.now();
    g.running = true;
    g.timerId = setInterval(tickTimer, 200);
  }

  /* ================= 棋盘操作 ================= */

  function neighbors(index) {
    const g = state.game;
    const row = Math.floor(index / g.cols);
    const col = index % g.cols;
    const out = [];

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = row + dr;
        const nc = col + dc;
        if (nr >= 0 && nr < g.rows && nc >= 0 && nc < g.cols) {
          out.push(nr * g.cols + nc);
        }
      }
    }
    return out;
  }

  function applyCell(index) {
    const g = state.game;
    const node = g.els.get(index);
    if (!node) return;
    paintCell(index, node);
  }

  function paintCell(index, node) {
    const cell = state.game.cells[index];
    let className = 'cell';
    let html = '';

    if (cell.state === 'revealed') {
      className += ' revealed';
      if (cell.mine) {
        className += cell.exploded ? ' boom' : ' mine';
        html = SVG.mine;
      } else if (cell.adj > 0) {
        className += ` n${cell.adj}`;
        html = String(cell.adj);
      }
    } else if (cell.state === 'flagged') {
      className += ' flagged';
      html = SVG.flag;
    } else if (cell.state === 'wrong') {
      className += ' wrong';
      html = SVG.mine;
    }

    node.className = className;
    node.innerHTML = html;
  }

  let viewFrame = 0;

  function scheduleView() {
    if (viewFrame) return;
    viewFrame = requestAnimationFrame(() => {
      viewFrame = 0;
      syncView(false);
    });
  }

  /* 只渲染滚动可视范围内的格子，1000×1000 也不会卡死 */
  function syncView(force) {
    const g = state.game;
    if (!g || !g.els) return;

    const wrap = $('board-wrap');
    const board = $('board');
    const size = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell')) || 16;
    const gap = 1;
    const pad = 3;
    const step = size + gap;
    const margin = 2;

    const c0 = Math.max(0, Math.floor((wrap.scrollLeft - pad) / step) - margin);
    const c1 = Math.min(g.cols - 1, Math.ceil((wrap.scrollLeft + wrap.clientWidth - pad) / step) + margin);
    const r0 = Math.max(0, Math.floor((wrap.scrollTop - pad) / step) - margin);
    const r1 = Math.min(g.rows - 1, Math.ceil((wrap.scrollTop + wrap.clientHeight - pad) / step) + margin);

    const view = g.view;
    const same = view && view.r0 === r0 && view.r1 === r1 && view.c0 === c0 && view.c1 === c1;
    if (same) {
      if (force) g.els.forEach((node, index) => paintCell(index, node));
      return;
    }
    g.view = { r0, r1, c0, c1 };

    g.els.forEach((node, index) => {
      const r = Math.floor(index / g.cols);
      const c = index % g.cols;
      if (r < r0 || r > r1 || c < c0 || c > c1) {
        node.remove();
        g.els.delete(index);
      }
    });

    const frag = document.createDocumentFragment();
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const index = r * g.cols + c;
        if (g.els.has(index)) continue;
        const node = document.createElement('div');
        node.className = 'cell';
        node.dataset.i = String(index);
        node.style.setProperty('--r', String(r));
        node.style.setProperty('--c', String(c));
        g.els.set(index, node);
        paintCell(index, node);
        frag.appendChild(node);
      }
    }
    board.appendChild(frag);
  }

  function updateStats() {
    const g = state.game;
    if (!g) return;

    const node = $('stat-mines');
    const next = String(g.mines - g.flags);
    if (node.textContent !== next) {
      node.textContent = next;
      node.classList.remove('is-bump');
      void node.offsetWidth;
      node.classList.add('is-bump');
    }
  }

  /* ================= 撤销 ================= */

  const STATE_CODE = { hidden: 0, revealed: 1, flagged: 2, wrong: 3 };
  const STATE_NAMES = ['hidden', 'revealed', 'flagged', 'wrong'];
  const STATE_EXPLODED = 4;

  function pushHistory(g) {
    const snaps = new Uint8Array(g.cells.length);
    for (let i = 0; i < g.cells.length; i++) {
      const cell = g.cells[i];
      snaps[i] = cell.exploded ? STATE_EXPLODED : STATE_CODE[cell.state];
    }
    g.history.push({
      cells: snaps,
      revealed: g.revealed,
      flags: g.flags,
      status: g.status,
      elapsed: elapsedNow(),
    });
    // 大棋盘快照体积大，按格子数动态限制可撤销步数
    const maxKeep = Math.max(6, Math.min(150, Math.floor(12e6 / g.cells.length)));
    while (g.history.length > maxKeep) g.history.shift();
    updateUndo();
  }

  function updateUndo() {
    const g = state.game;
    const can = Boolean(g) && g.history.length > 0 && g.status !== 'won' && g.status !== 'paused';
    $('btn-undo').disabled = !can;
  }

  function undo() {
    const g = state.game;
    if (!g || !g.history.length) return;
    if (g.status === 'paused' || g.status === 'won') return;

    const wasLost = g.status === 'lost';
    const snap = g.history.pop();

    if (wasLost) {
      removeRecord(g.lossRecord);
      g.lossRecord = null;
      $('result-overlay').hidden = true;
      $('board').classList.remove('is-shaking');
      $('board-wrap').classList.remove('is-paused');
    }

    for (let i = 0; i < g.cells.length; i++) {
      const code = snap.cells[i];
      const cell = g.cells[i];
      cell.state = code === STATE_EXPLODED ? 'revealed' : STATE_NAMES[code];
      cell.exploded = code === STATE_EXPLODED;
    }
    syncView(true);

    g.revealed = snap.revealed;
    g.flags = snap.flags;
    g.status = snap.status;
    g.prevStatus = null;

    g.running = false;
    clearInterval(g.timerId);
    g.timerId = null;
    g.elapsed = snap.elapsed;
    g.startAt = 0;
    if (g.status === 'playing') {
      resumeTimer();
    }
    tickTimer();

    $('game-tip').textContent =
      g.status === 'ready' ? '首次点击不会踩雷' : '双击数字可快速展开周围';
    updateStats();
    updateUndo();
    audio.undo();
    showToast('已撤销上一步');
  }

  function placeMines(safeIndex) {
    const g = state.game;
    const total = g.rows * g.cols;
    const safeZone = new Set([safeIndex, ...neighbors(safeIndex)]);

    const candidates = [];
    const outside = [];
    for (let i = 0; i < total; i++) {
      if (i === safeIndex) continue;
      candidates.push(i);
      if (!safeZone.has(i)) outside.push(i);
    }
    const pool = outside.length >= g.mines ? outside : candidates;

    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (let k = 0; k < g.mines; k++) {
      g.cells[pool[k]].mine = true;
    }

    for (let i = 0; i < total; i++) {
      if (g.cells[i].mine) continue;
      let count = 0;
      for (const n of neighbors(i)) {
        if (g.cells[n].mine) count++;
      }
      g.cells[i].adj = count;
    }
  }

  function floodReveal(start) {
    const g = state.game;
    const stack = [start];
    let count = 0;

    while (stack.length) {
      const index = stack.pop();
      const cell = g.cells[index];
      if (cell.state !== 'hidden' || cell.mine) continue;

      cell.state = 'revealed';
      g.revealed++;
      count++;
      applyCell(index);

      if (cell.adj === 0) {
        for (const n of neighbors(index)) {
          if (g.cells[n].state === 'hidden') stack.push(n);
        }
      }
    }
    return count;
  }

  function revealAt(index) {
    const g = state.game;
    if (!g || g.status === 'paused' || g.status === 'won' || g.status === 'lost') return;

    const cell = g.cells[index];
    if (!cell || cell.state !== 'hidden') return;

    if (g.status === 'ready') {
      placeMines(index);
      g.status = 'playing';
      startTimer();
      $('game-tip').textContent = '双击数字可快速展开周围';
    }

    pushHistory(g);

    if (cell.mine) {
      boom(index);
      return;
    }

    const opened = floodReveal(index);
    audio.reveal(opened);
    checkWin();
  }

  function toggleFlag(index) {
    const g = state.game;
    if (!g || g.status === 'paused' || g.status === 'won' || g.status === 'lost') return;

    const cell = g.cells[index];
    if (!cell || cell.state === 'revealed') return;

    pushHistory(g);

    if (cell.state === 'flagged') {
      cell.state = 'hidden';
      g.flags--;
      audio.unflag();
    } else {
      cell.state = 'flagged';
      g.flags++;
      audio.flag();
    }
    applyCell(index);
    updateStats();
  }

  function chord(index) {
    const g = state.game;
    if (!g || g.status !== 'playing') return;

    const cell = g.cells[index];
    if (!cell || cell.state !== 'revealed' || cell.adj === 0) return;

    const around = neighbors(index);
    let flags = 0;
    for (const n of around) {
      if (g.cells[n].state === 'flagged') flags++;
    }
    if (flags !== cell.adj) return;

    let hidden = 0;
    for (const n of around) {
      if (g.cells[n].state === 'hidden') hidden++;
    }
    if (!hidden) return;

    pushHistory(g);

    let opened = 0;
    for (const n of around) {
      if (g.cells[n].state !== 'hidden') continue;
      if (g.cells[n].mine) {
        boom(n);
        return;
      }
      opened += floodReveal(n);
    }
    if (opened) audio.reveal(opened);
    checkWin();
  }

  function boom(index) {
    const g = state.game;
    if (!g || g.status === 'lost' || g.status === 'won') return;

    g.status = 'lost';
    pauseTimer();
    audio.boom();
    $('board').classList.add('is-shaking');

    g.cells[index].state = 'revealed';
    g.cells[index].exploded = true;
    applyCell(index);

    g.cells.forEach((cell, i) => {
      if (cell.mine && cell.state !== 'flagged' && cell.state !== 'revealed') {
        cell.state = 'revealed';
        applyCell(i);
      } else if (!cell.mine && cell.state === 'flagged') {
        cell.state = 'wrong';
        applyCell(i);
      }
    });

    const secs = Math.floor(elapsedNow());
    g.lossRecord = addRecord(g, false, secs);
    updateUndo();
    scheduleResult(g, false, secs, bestOf(g), false, 620);
  }

  function checkWin() {
    const g = state.game;
    if (!g || g.status === 'won' || g.status === 'lost') return;
    if (g.revealed < g.rows * g.cols - g.mines) return;

    g.status = 'won';
    const secs = Math.floor(elapsedNow());
    pauseTimer();
    audio.win();
    $('board').classList.add('is-won');

    for (let i = 0; i < g.cells.length; i++) {
      const cell = g.cells[i];
      if (cell.mine && cell.state !== 'flagged') {
        cell.state = 'flagged';
        g.flags++;
        applyCell(i);
      }
    }
    updateStats();

    const map = bestMap();
    const key = bestKey(g.rows, g.cols, g.mines);
    const previous = Number.isFinite(map[key]) ? map[key] : null;
    const isNew = previous == null || secs < previous;
    if (isNew) {
      map[key] = secs;
      saveJSON(LS_BEST, map);
    }

    renderDiffs();
    addRecord(g, true, secs);
    updateUndo();
    scheduleResult(g, true, secs, isNew ? secs : previous, isNew, 720);
  }

  function scheduleResult(game, isWin, secs, bestSec, isNew, delay) {
    setTimeout(() => {
      if (state.game !== game) return;
      if (isWin ? game.status !== 'won' : game.status !== 'lost') return;
      showResult(isWin, secs, bestSec, isNew);
    }, delay);
  }

  function showResult(isWin, secs, bestSec, isNew) {
    $('result-icon').innerHTML = isWin ? SVG.trophy : SVG.mine;
    $('result-icon').classList.toggle('is-win', isWin);
    $('result-title').textContent = isWin ? '全部清空' : '踩到地雷';
    $('result-sub').textContent = isWin
      ? isNew
        ? '新纪录！这是目前最快的成绩'
        : '排雷成功，再挑战一次？'
      : '差一点点，换个思路再来一局';
    $('result-time').textContent = formatClock(secs);
    $('result-best').textContent = bestSec == null ? '--:--' : formatClock(bestSec);
    $('result-best').classList.toggle('is-new', Boolean(isNew));
    $('result-best-label').textContent = isNew ? '新纪录' : '最佳';
    $('btn-undo-result').hidden = isWin;
    $('btn-undo-result').style.display = isWin ? 'none' : '';
    $('result-overlay').hidden = false;

    if (isWin) playConfetti();
  }

  function playConfetti() {
    const overlay = $('result-overlay');
    const layer = document.createElement('div');
    const colors = ['#4f8cff', '#8a5cff', '#35d399', '#ffb454', '#ff5d6c'];

    layer.className = 'confetti-layer';
    for (let i = 0; i < 70; i++) {
      const piece = document.createElement('i');
      piece.className = 'confetti';
      piece.style.left = Math.random() * 100 + '%';
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = (Math.random() * 0.5).toFixed(2) + 's';
      piece.style.animationDuration = (1.3 + Math.random() * 1.1).toFixed(2) + 's';
      piece.style.setProperty('--drift', (Math.random() * 140 - 70).toFixed(0) + 'px');
      layer.appendChild(piece);
    }

    overlay.appendChild(layer);
    setTimeout(() => layer.remove(), 3000);
  }

  /* ================= 暂停 / 退出 ================= */

  function pauseGame() {
    const g = state.game;
    if (!g || (g.status !== 'playing' && g.status !== 'ready')) return;

    g.prevStatus = g.status;
    g.status = 'paused';
    pauseTimer();
    audio.pause();
    $('board-wrap').classList.add('is-paused');
    $('btn-pause').classList.add('is-active');
    $('pause-overlay').hidden = false;
    updateUndo();
  }

  function resumeGame() {
    const g = state.game;
    if (!g || g.status !== 'paused') return;

    const wasPlaying = g.prevStatus === 'playing';
    g.status = wasPlaying ? 'playing' : 'ready';
    g.prevStatus = null;
    audio.resume();
    $('board-wrap').classList.remove('is-paused');
    $('btn-pause').classList.remove('is-active');
    $('pause-overlay').hidden = true;
    updateUndo();
    if (wasPlaying) resumeTimer();
  }

  function restart() {
    const g = state.game;
    if (!g) return;
    startGame({ name: g.name, rows: g.rows, cols: g.cols, mines: g.mines });
  }

  function goHome() {
    const g = state.game;
    if (g) {
      clearInterval(g.timerId);
      g.timerId = null;
      g.running = false;
    }
    state.game = null;
    $('pause-overlay').hidden = true;
    $('result-overlay').hidden = true;
    $('board-wrap').classList.remove('is-paused');
    $('btn-pause').classList.remove('is-active');
    $('board').innerHTML = '';
    renderDiffs();
    showScreen('home');
  }

  /* ================= 自定义难度 ================= */

  function validateCustom() {
    const rows = parseInt($('inp-rows').value, 10);
    const cols = parseInt($('inp-cols').value, 10);
    const mines = parseInt($('inp-mines').value, 10);
    const hint = $('custom-hint');
    let message = '';

    if (![rows, cols, mines].every(Number.isFinite)) {
      message = '请填写完整的数字';
    } else if (rows < 5 || rows > 1000) {
      message = '行数需在 5 - 1000 之间';
    } else if (cols < 5 || cols > 1000) {
      message = '列数需在 5 - 1000 之间';
    } else if (mines < 1) {
      message = '地雷数量至少为 1';
    } else if (mines > rows * cols - 9) {
      message = `地雷最多 ${rows * cols - 9} 个（需保留安全区）`;
    }

    hint.textContent = message || `共 ${cols} × ${rows} = ${rows * cols} 格，${mines} 颗雷`;
    hint.classList.toggle('is-error', Boolean(message));

    return message ? null : { rows, cols, mines };
  }

  function openCustom() {
    $('inp-rows').value = state.custom.rows;
    $('inp-cols').value = state.custom.cols;
    $('inp-mines').value = state.custom.mines;
    validateCustom();
    $('custom-modal').hidden = false;
    $('inp-rows').focus();
    $('inp-rows').select();
  }

  function closeCustom() {
    $('custom-modal').hidden = true;
  }

  function confirmCustom() {
    const config = validateCustom();
    if (!config) return;

    state.custom = config;
    saveJSON(LS_CUSTOM, config);
    state.selected = 'custom';
    renderDiffs();
    closeCustom();
    startGame(diffOf('custom'));
  }

  /* ================= 输入事件 ================= */

  function setFlagMode(on) {
    state.flagMode = on;
    $('btn-flag').setAttribute('aria-pressed', String(on));
    $('flag-label').textContent = on ? '插旗模式：开' : '插旗模式：关';
  }

  function clearPress() {
    if (state.pressTimer) {
      clearTimeout(state.pressTimer);
      state.pressTimer = null;
    }
  }

  function bindBoard() {
    const board = $('board');

    $('board-wrap').addEventListener(
      'scroll',
      () => {
        state.scrolledAt = Date.now();
        scheduleView();
      },
      { passive: true }
    );

    board.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      if (Date.now() - state.lastTouchAt < 800) return;
      const node = event.target.closest('.cell');
      if (!node) return;
      toggleFlag(Number(node.dataset.i));
    });

    board.addEventListener('click', (event) => {
      if (state.touchHandled) {
        state.touchHandled = false;
        return;
      }
      // 触屏刚滑动过棋盘时，忽略浏览器补发的 click
      if (Date.now() - state.scrolledAt < 300 && Date.now() - state.lastTouchAt < 800) return;
      const node = event.target.closest('.cell');
      if (!node) return;
      const index = Number(node.dataset.i);
      if (state.flagMode) {
        toggleFlag(index);
      } else {
        revealAt(index);
      }
    });

    board.addEventListener('dblclick', (event) => {
      const node = event.target.closest('.cell');
      if (!node) return;
      chord(Number(node.dataset.i));
    });

    board.addEventListener('pointerdown', (event) => {
      state.touchHandled = false;
      state.pressMoved = false;
      if (event.pointerType === 'mouse') return;

      state.lastTouchAt = Date.now();
      const node = event.target.closest('.cell');
      if (!node) return;

      const wrap = $('board-wrap');
      state.pressScrollX = wrap.scrollLeft;
      state.pressScrollY = wrap.scrollTop;

      const index = Number(node.dataset.i);
      state.pressIndex = index;
      state.pressX = event.clientX;
      state.pressY = event.clientY;
      clearPress();

      state.pressTimer = setTimeout(() => {
        if (state.pressMoved) return;
        state.pressTimer = null;
        state.longFired = true;
        toggleFlag(index);
        if (navigator.vibrate) navigator.vibrate(12);
      }, LONG_PRESS_MS);
    });

    board.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'mouse') return;
      if (state.pressIndex == null) return;
      const moved = Math.abs(event.clientX - state.pressX) + Math.abs(event.clientY - state.pressY);
      if (moved > 10) {
        state.pressMoved = true;
        clearPress();
      }
    });

    board.addEventListener('pointerup', (event) => {
      if (event.pointerType === 'mouse') return;

      const fired = state.longFired;
      const index = state.pressIndex;
      const node = event.target.closest('.cell');
      const wrap = $('board-wrap');
      // 滑动（翻看大棋盘）不应触发格子，抬手时再判断一次位移与滚动
      const scrolled =
        Math.abs(wrap.scrollLeft - state.pressScrollX) > 2 ||
        Math.abs(wrap.scrollTop - state.pressScrollY) > 2;
      const moved = state.pressMoved || scrolled;

      state.lastTouchAt = Date.now();
      clearPress();
      state.touchHandled = true;

      const sameCell = node && index != null && Number(node.dataset.i) === index;
      if (!fired && !moved && sameCell && state.game) {
        if (state.flagMode) {
          toggleFlag(index);
        } else {
          revealAt(index);
        }
      }

      state.longFired = false;
      state.pressMoved = false;
      state.pressIndex = null;
    });

    board.addEventListener('pointercancel', () => {
      clearPress();
      state.touchHandled = true;
      state.longFired = false;
      state.pressMoved = true;
      state.pressIndex = null;
    });
  }

  function bindUI() {
    ['pointerdown', 'touchstart', 'click'].forEach((type) => {
      document.addEventListener(type, () => audio.unlock(), { capture: true, passive: true });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (!audio.ctx || audio.ctx.state === 'running') return;
      const resumed = audio.ctx.resume();
      if (resumed && resumed.catch) resumed.catch(() => {});
    });

    $('btn-start').addEventListener('click', () => startGame(diffOf(state.selected)));

    $('btn-goto-difficulty').addEventListener('click', () => showScreen('difficulty'));
    $('btn-goto-records').addEventListener('click', () => {
      resetClearButton();
      renderRecords();
      showScreen('records');
    });
    $('btn-diff-back').addEventListener('click', () => showScreen('home'));
    $('btn-records-back').addEventListener('click', () => showScreen('home'));
    $('btn-clear-records').addEventListener('click', handleClearRecords);

    $('btn-help').addEventListener('click', () => {
      const panel = $('help-panel');
      const willOpen = panel.hidden;
      panel.hidden = !willOpen;
      $('btn-help').setAttribute('aria-expanded', String(willOpen));
    });

    $('btn-home').addEventListener('click', goHome);
    $('btn-pause').addEventListener('click', pauseGame);
    $('btn-restart').addEventListener('click', restart);
    $('btn-restart-foot').addEventListener('click', restart);
    $('btn-undo').addEventListener('click', undo);
    $('btn-undo-result').addEventListener('click', undo);

    $('btn-resume').addEventListener('click', resumeGame);
    $('btn-pause-restart').addEventListener('click', restart);
    $('btn-pause-diff').addEventListener('click', goHome);
    $('btn-pause-home').addEventListener('click', goHome);

    $('btn-again').addEventListener('click', restart);
    $('btn-result-diff').addEventListener('click', goHome);
    $('btn-result-home').addEventListener('click', goHome);

    $('btn-flag').addEventListener('click', () => setFlagMode(!state.flagMode));
    $('btn-sound').addEventListener('click', () => setSound(!state.sound, true));

    $('btn-custom-cancel').addEventListener('click', closeCustom);
    $('btn-custom-ok').addEventListener('click', confirmCustom);
    ['inp-rows', 'inp-cols', 'inp-mines'].forEach((id) => {
      $(id).addEventListener('input', () => validateCustom());
    });
    $('custom-modal').addEventListener('click', (event) => {
      if (event.target === event.currentTarget) closeCustom();
    });

    $('inp-rows').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') confirmCustom();
    });

    document.addEventListener('click', (event) => {
      const btn = event.target.closest('button');
      if (!btn || btn.disabled) return;
      if (btn.id === 'btn-pause' || btn.id === 'btn-resume') return;
      if (btn.id === 'btn-undo' || btn.id === 'btn-undo-result') return;
      audio.tap();
    });

    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        if (!$('screen-game').classList.contains('is-active')) return;
        event.preventDefault();
        undo();
        return;
      }
      if (event.key !== 'Escape') return;
      if ($('custom-modal').hidden === false) {
        closeCustom();
        return;
      }
      if (!$('screen-game').classList.contains('is-active') || !state.game) return;
      if (state.game.status === 'paused') {
        resumeGame();
      } else {
        pauseGame();
      }
    });

    let resizeRaf = 0;
    window.addEventListener('resize', () => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        fitBoard();
      });
    });
  }

  /* ================= 启动 ================= */

  function init() {
    renderDiffs();
    bindUI();
    bindBoard();
    setSound(state.sound, false);
  }

  init();
})();
