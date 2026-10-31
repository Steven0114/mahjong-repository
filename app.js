/* 台灣麻將計分器 — UI 層（計算全部在 core.js） */
(function () {
  'use strict';

  var KEY = 'mahjongCounter.game.v1';
  var UI_KEY = 'mahjongCounter.ui.v1';
  var C = window.MahjongCore;

  var game = null;
  var ui = null;
  var fixDirty = false;
  var toastTimer = null;
  var toastUndo = false;
  var modalResolve = null;
  var wakeLock = null;

  function $(id) { return document.getElementById(id); }
  function setText(id, t) { var el = $(id); if (el) el.textContent = t; }
  function setHTML(id, h) { var el = $(id); if (el) el.innerHTML = h; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nm(i) { return game && game.names && game.names[i] != null ? game.names[i] : '?'; }
  function signed(n) { return C.formatSigned(n); }
  function cls(n) { return n > 0 ? 'pos' : (n < 0 ? 'neg' : 'zero'); }
  function sumOf(a) { return C.round1(a.reduce(function (x, y) { return x + y; }, 0)); }
  function num(n) { return C.fmtNum(n); }
  function entryRules(e) { return C.rulesText(e.base != null ? e.base : C.BASE, e.perTai != null ? e.perTai : C.PER_TAI); }
  function streakText(n, sep) { return '連 ' + n + (sep || '・') + '拉 ' + n; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* ---------------- Storage ---------------- */
  function safeGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return e || false; } }

  function save() {
    var r = safeSet(KEY, JSON.stringify(game));
    if (r !== true) {
      // 多半是 QuotaExceeded：縮減 undo/redo 再試一次
      game.undoStack = game.undoStack.slice(-20);
      game.redoStack = [];
      r = safeSet(KEY, JSON.stringify(game));
      if (r !== true) {
        showToast('⚠️ 無法儲存（空間不足或私密瀏覽），請用「匯出／備份」保存紀錄');
        return false;
      }
    }
    return true;
  }
  function saveUI() { safeSet(UI_KEY, JSON.stringify(ui)); }

  function defaultUI() { return { mode: 'discard', winner: null, loser: null, tai: 0, fixMode: 'set' }; }
  function loadUI() {
    var u = defaultUI();
    var raw = safeGet(UI_KEY);
    if (!raw) return u;
    try {
      var p = JSON.parse(raw);
      if (p && typeof p === 'object') {
        if (p.mode === 'discard' || p.mode === 'selfDraw' || p.mode === 'draw') u.mode = p.mode;
        if (C.isIdx(p.winner)) u.winner = p.winner;
        if (C.isIdx(p.loser) && p.loser !== u.winner) u.loser = p.loser;
        var t = C.toInt(p.tai, 0); u.tai = C.clamp(t >= 0 ? t : 0, 0, C.MAX_TAI);
        if (p.fixMode === 'set' || p.fixMode === 'adjust') u.fixMode = p.fixMode;
      }
    } catch (e) { /* 使用預設 */ }
    return u;
  }

  function loadGame() {
    var raw = safeGet(KEY);
    var res = C.parseGameJSON(raw);
    if (res.repaired && raw) {
      safeSet(KEY + '.corrupt.' + Date.now(), raw);
      setTimeout(function () { showToast('⚠️ 儲存資料異常，已自動修復（原始資料已另存備份）'); }, 300);
    }
    return res.game;
  }

  /* ---------------- State changes ---------------- */
  function dispatch(action) {
    var next = C.reduce(game, action);
    if (next === game) return false;
    game = next;
    save();
    render();
    return true;
  }

  /* ---------------- Rendering ---------------- */
  function render() {
    renderHeader();
    renderBoard();
    renderDealer();
    renderPlay();
    renderTools();
  }

  function renderHeader() {
    setText('roundLabel', '第 ' + game.round + ' 局');
    setText('rulesLabel', C.rulesText(game.base, game.perTai));
    var w = $('sumWarning');
    if (w) {
      var s = sumOf(game.scores);
      w.hidden = s === 0;
      w.textContent = s === 0 ? '' : '⚠️ 四人總分目前為 ' + signed(s) + '，並非 0';
    }
  }

  function renderBoard() {
    var h = '';
    for (var i = 0; i < 4; i++) {
      var isD = i === game.dealer;
      var seat = C.seatName(i, game.dealer) + (isD ? '・莊' : '');
      var sc = game.scores[i];
      h += '<div class="pcard' + (isD ? ' is-dealer' : '') + '" data-player="' + i + '">' +
        (isD ? '<span class="badge">' + (game.streak > 0 ? '連' + game.streak : '莊') + '</span>' : '') +
        '<div class="phead"><span class="pname">' + esc(nm(i)) + '</span><span class="pseat">' + seat + '</span></div>' +
        '<div class="pscore ' + cls(sc) + '">' + signed(sc) + '</div></div>';
    }
    setHTML('board', h);
  }

  function renderDealer() {
    var d = game.dealer, n = game.streak;
    setText('dealerLine', '莊家：' + nm(d) + '｜東｜莊');
    setText('bonusLine', '莊家相關 +' + C.dealerBonusTai(n) + ' 台');
    setText('streakValue', n === 0 ? '莊 1（連 0 拉 0）' : streakText(n, ' '));
    var dec = document.querySelector('[data-action="streak-dec"]');
    if (dec) dec.disabled = n <= 0;
  }

  function playerBtns(kind) {
    var h = '';
    for (var i = 0; i < 4; i++) {
      var on = kind === 'winner' ? ui.winner === i : (kind === 'loser' ? ui.loser === i : game.dealer === i);
      var disabled = kind === 'loser' && ui.winner === i;
      var sub = C.seatName(i, game.dealer) + (i === game.dealer ? '・莊' : '');
      h += '<button type="button" class="pbtn ' + kind + (on ? ' on' : '') + '" data-action="' + kind + '" data-i="' + i + '"' +
        (disabled ? ' disabled' : '') + ' aria-pressed="' + on + '"><span class="nm">' + esc(nm(i)) + '</span><small>' + sub + '</small></button>';
    }
    return h;
  }

  function currentCalc() {
    return C.calculateSettlement(game, { type: ui.mode, winner: ui.winner, loser: ui.loser, tai: ui.tai });
  }

  function renderPlay() {
    var btns = document.querySelectorAll('[data-action="mode"]');
    for (var k = 0; k < btns.length; k++) {
      var on = btns[k].getAttribute('data-value') === ui.mode;
      btns[k].classList.toggle('on', on);
      btns[k].setAttribute('aria-pressed', String(on));
    }
    var wb = $('winnerBlock'), lb = $('loserBlock'), tb = $('taiBlock');
    if (wb) wb.hidden = ui.mode === 'draw';
    if (lb) lb.hidden = ui.mode !== 'discard';
    if (tb) tb.hidden = ui.mode === 'draw';
    setHTML('winnerBtns', playerBtns('winner'));
    setHTML('loserBtns', playerBtns('loser'));
    var ti = $('taiInput');
    if (ti && document.activeElement !== ti) ti.value = String(ui.tai);
    var dt = document.querySelector('[data-action="tai-dec"]');
    if (dt) dt.disabled = ui.tai <= 0;

    var pv = $('preview'), sb = $('settleBtn');
    var calc = currentCalc();
    var n = game.streak;
    var h = '';
    if (ui.mode === 'draw') {
      h = '<div class="pv-title">流局｜第 ' + game.round + ' 局</div>' +
        '<div class="pv-line"><span>流局：莊家連莊，下局 連' + (n + 1) + ' 拉' + (n + 1) + '</span></div>' +
        '<div class="pv-next">本局無人輸贏；' + esc(nm(game.dealer)) + ' 繼續坐莊</div>';
    } else if (!calc.ok) {
      h = '<div class="pv-title">本局預計</div><div class="pv-hint">' + esc(calc.error) + '</div>';
    } else {
      var title = ui.mode === 'selfDraw'
        ? esc(nm(ui.winner)) + ' 自摸｜' + calc.tai + ' 台'
        : esc(nm(ui.winner)) + ' 胡 ' + esc(nm(ui.loser)) + '｜' + calc.tai + ' 台';
      if (calc.bonusApplied) title += '（莊相關 +' + calc.bonusTai + ' 台）';
      h = '<div class="pv-title">' + title + '</div>';
      var order = C.seatOrder(game.dealer);
      for (var j = 0; j < 4; j++) {
        var p = order[j], d = calc.deltas[p];
        var label = esc(nm(p)) + (p === game.dealer ? '（莊・連' + n + '拉' + n + '）' : '');
        var pay = null;
        for (var q = 0; q < calc.payments.length; q++) if (calc.payments[q].from === p) pay = calc.payments[q];
        var detail = '';
        if (pay) {
          var taiPart = calc.tai + (pay.dealerInvolved ? '+' + calc.bonusTai : '');
          detail = '<span class="calc">' + num(calc.base) + '+' + (calc.perTai === 1 ? taiPart
            : (pay.dealerInvolved ? '(' + taiPart + ')' : taiPart) + '×' + num(calc.perTai)) + '</span>';
        }
        h += '<div class="pv-line"><span>' + label + detail + '</span><span class="amt ' + cls(d) + '">' + signed(d) + '</span></div>';
      }
      var nx = C.nextDealerState(game, { type: ui.mode, winner: ui.winner });
      h += '<div class="pv-next">下局：' + (nx.dealerStays
        ? esc(nm(nx.dealer)) + ' 連莊（連 ' + nx.streak + ' 拉 ' + nx.streak + '）'
        : esc(nm(nx.dealer)) + ' 當莊（連 0 拉 0）') + '</div>';
    }
    if (pv) { pv.innerHTML = h; pv.classList.toggle('ready', ui.mode === 'draw' || calc.ok); }
    if (sb) {
      sb.disabled = !(ui.mode === 'draw' || calc.ok);
      sb.textContent = ui.mode === 'draw' ? '確認流局' : '確認結算';
    }
  }

  function renderTools() {
    var ub = $('undoBtn'), rb = $('redoBtn');
    var u = game.undoStack[game.undoStack.length - 1];
    var r = game.redoStack[game.redoStack.length - 1];
    if (ub) ub.disabled = !u;
    if (rb) rb.disabled = !r;
    var hint = [];
    if (u) hint.push('可復原：' + u.label);
    if (r) hint.push('可重做：' + r.label);
    setText('undoHint', hint.join('　'));
    setText('historyCount', String(game.history.length));
    renderHistory();
    setHTML('dealerBtns', playerBtns('dealer'));
    setText('dealerHint', '點選玩家設為莊家（東），座位依 ' + game.names.join(' → ') + ' 的順序重排，連莊歸零（可再用 −/+ 調整）。');
    var fb = document.querySelectorAll('[data-action="fix-mode"]');
    for (var k = 0; k < fb.length; k++) fb[k].classList.toggle('on', fb[k].getAttribute('data-value') === ui.fixMode);
    setText('fixHint', ui.fixMode === 'set'
      ? '直接把四人「目前總分」改成輸入的數字（可 1 位小數）。負數請按 ± 切換。'
      : '在目前分數上「再加減」輸入的數字（例：+5 代表加 5）。負數請按 ± 切換。');
    if (!fixDirty) renderFixRows();
  }

  function deltasText(arr) {
    var out = '';
    for (var i = 0; i < 4; i++) out += '<span>' + esc(nm(i)) + ' <b class="' + cls(arr[i]) + '">' + signed(arr[i]) + '</b></span>';
    return out;
  }
  function afterText(arr) {
    return '結算後：' + arr.map(function (s, i) { return esc(nm(i)) + ' ' + signed(s); }).join('・');
  }

  function historyItem(e) {
    var head = '', meta = '', main = '', body = '';
    var time = '<span class="h-time">' + fmtTime(e.ts) + '</span>';
    if (e.kind === 'settle') {
      head = '第 ' + e.round + ' 局';
      meta = '莊：' + esc(nm(e.dealer)) + '｜' + streakText(e.streak, ' ') + '｜' + entryRules(e);
      main = e.mode === 'selfDraw'
        ? esc(nm(e.winner)) + ' 自摸 ' + e.tai + ' 台'
        : esc(nm(e.winner)) + ' 胡 ' + esc(nm(e.loser)) + ' ' + e.tai + ' 台';
      main += e.bonusTai ? '（莊相關 +' + e.bonusTai + ' 台）' : '（無莊家交易）';
    } else if (e.kind === 'draw') {
      head = '第 ' + e.round + ' 局';
      meta = '莊：' + esc(nm(e.dealer)) + '｜' + streakText(e.streak, ' ') + '｜' + entryRules(e);
      main = '流局（莊家連莊 → 連 ' + (e.streak + 1) + ' 拉 ' + (e.streak + 1) + '）';
    } else if (e.kind === 'setScores' || e.kind === 'adjust') {
      head = e.kind === 'setScores' ? '手動設定總分' : '分數加減調整';
      meta = '第 ' + e.round + ' 局前';
    } else if (e.kind === 'rules') {
      head = '修改底／每台';
      meta = '第 ' + e.round + ' 局起適用（過去不重算）';
      main = C.rulesText(e.fromBase, e.fromPerTai) + ' → ' + C.rulesText(e.base, e.perTai);
    } else if (e.kind === 'dealer') {
      head = '更換莊家';
      main = esc(nm(e.fromDealer)) + ' → ' + esc(nm(e.toDealer)) + '（原連 ' + (e.fromStreak || 0) + '，改為連 0）';
    } else {
      head = '紀錄';
    }
    if (Array.isArray(e.deltas) && e.kind !== 'draw' && e.kind !== 'dealer') body += '<div class="h-deltas">' + deltasText(e.deltas) + '</div>';
    if (Array.isArray(e.scoresAfter)) body += '<div class="h-after">' + afterText(e.scoresAfter) + '</div>';
    return '<div class="hitem"><div class="h-head"><span>' + head + '</span>' + time + '</div>' +
      (meta ? '<div class="h-meta">' + meta + '</div>' : '') +
      (main ? '<div class="h-main">' + main + '</div>' : '') + body + '</div>';
  }

  function renderHistory() {
    var list = $('historyList');
    if (!list) return;
    var panel = $('historyPanel');
    if (panel && !panel.open) { list.innerHTML = ''; return; } // 收合時不渲染，保持快速
    if (!game.history.length) { list.innerHTML = '<div class="empty">尚無紀錄</div>'; return; }
    var h = '';
    for (var i = game.history.length - 1; i >= 0; i--) {
      try { h += historyItem(game.history[i]); } catch (e) { /* 單筆異常不影響其他 */ }
    }
    list.innerHTML = h;
  }

  function renderFixRows() {
    var box = $('fixRows');
    if (!box) return;
    var h = '';
    for (var i = 0; i < 4; i++) {
      var val = ui.fixMode === 'set' ? String(game.scores[i]) : '';
      h += '<div class="fix-row"><div class="fname">' + esc(nm(i)) + '<small>目前 ' + signed(game.scores[i]) + '</small></div>' +
        '<button type="button" class="sign-btn" data-action="fix-sign" data-i="' + i + '" aria-label="正負切換">±</button>' +
        '<input id="fix-' + i + '" data-fix="' + i + '" type="text" inputmode="numeric" autocomplete="off" placeholder="0" value="' + esc(val) + '" aria-label="' + esc(nm(i)) + '"></div>';
    }
    box.innerHTML = h;
    updateFixSum();
  }

  function parseIntInput(s, emptyVal) {
    s = String(s == null ? '' : s).trim().replace(/[−－﹣–—]/g, '-').replace(/[＋]/g, '+').replace(/\s+/g, '');
    s = s.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    if (s === '' || s === '-' || s === '+') return emptyVal;
    if (!/^[+-]?\d{1,9}(\.\d)?$/.test(s)) return NaN;
    return C.round1(parseFloat(s));
  }

  function readFix() {
    var vals = [], ok = true;
    for (var i = 0; i < 4; i++) {
      var el = $('fix-' + i);
      var v = parseIntInput(el ? el.value : '', ui.fixMode === 'set' ? NaN : 0);
      if (el) el.classList.toggle('bad', !Number.isFinite(v));
      if (!Number.isFinite(v)) ok = false;
      vals.push(v);
    }
    return { ok: ok, vals: vals };
  }

  function updateFixSum() {
    var r = readFix();
    var el = $('fixSum');
    if (!el) return;
    if (!r.ok) { el.innerHTML = '<span class="neg">請輸入數字（可為負數、最多 1 位小數）</span>'; return; }
    var target = ui.fixMode === 'set' ? r.vals : game.scores.map(function (s, i) { return C.round1(s + r.vals[i]); });
    var s = sumOf(target);
    el.innerHTML = (ui.fixMode === 'set' ? '合計：' : '調整後合計：') +
      (s === 0 ? '<span class="pos">0 ✓</span>' : '<span class="neg">' + signed(s) + ' ⚠️ 並非 0</span>');
  }

  /* ---------------- 底／每台 編輯 ---------------- */
  function parseRuleInput(v) {
    var s = String(v == null ? '' : v).trim().replace(/[０-９．]/g, function (c) {
      return c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    });
    if (!/^\d{1,7}(\.\d)?$/.test(s)) return NaN;
    return C.round1(parseFloat(s));
  }
  function readRules() {
    var bi = $('rulesBase'), pi = $('rulesPerTai');
    var b = parseRuleInput(bi ? bi.value : ''), p = parseRuleInput(pi ? pi.value : '');
    var bOk = Number.isFinite(b) && b >= 0, pOk = Number.isFinite(p) && p > 0;
    if (bi) bi.classList.toggle('bad', !bOk);
    if (pi) pi.classList.toggle('bad', !pOk);
    return { ok: bOk && pOk && C.validRules(b, p), base: b, perTai: p, bOk: bOk, pOk: pOk };
  }
  function updateRulesPreview() {
    var r = readRules();
    var el = $('rulesPreview'), ap = $('rulesApply');
    if (ap) ap.disabled = !r.ok;
    var bs = document.querySelectorAll('[data-action="rules-step"][data-d="-1"]');
    for (var k = 0; k < bs.length; k++) {
      var f = bs[k].getAttribute('data-field');
      bs[k].disabled = f === 'base' ? !(r.bOk && r.base >= 1) : !(r.pOk && r.perTai > 1);
    }
    if (!el) return;
    if (!r.ok) {
      el.innerHTML = '<div class="pv-hint neg">' + (!r.bOk ? '底需為 ≥ 0 的數字（最多 1 位小數）' : '每台需為 > 0 的數字（最多 1 位小數）') + '</div>';
      return;
    }
    var pay = function (t) { return num(C.round1(r.base + t * r.perTai)); };
    var bonus = C.dealerBonusTai(game.streak);
    el.innerHTML = '<div class="pv-title">' + C.rulesText(r.base, r.perTai) + '</div>' +
      '<div class="pv-line"><span>閒家互胡 5 台</span><span class="amt">' + pay(5) + '</span></div>' +
      '<div class="pv-line"><span>與莊家（目前 +' + bonus + ' 台）5 台</span><span class="amt">' + pay(5 + bonus) + '</span></div>' +
      '<div class="pv-next">每筆 = 底 + (台數 + 莊家相關台數) × 每台</div>';
  }
  function openRules() {
    var bi = $('rulesBase'), pi = $('rulesPerTai'), m = $('rulesModal');
    if (!m) return;
    if (bi) bi.value = num(game.base);
    if (pi) pi.value = num(game.perTai);
    m.hidden = false;
    updateRulesPreview();
  }
  function closeRules() { var m = $('rulesModal'); if (m) m.hidden = true; }
  function stepRules(field, d) {
    var el = $(field === 'base' ? 'rulesBase' : 'rulesPerTai');
    if (!el) return;
    var v = parseRuleInput(el.value);
    if (!Number.isFinite(v)) v = field === 'base' ? C.BASE : C.PER_TAI;
    var nv = C.round1(v + d);
    if (field === 'base' && nv < 0) nv = 0;
    if (field === 'perTai' && nv <= 0) return;
    el.value = num(nv);
    updateRulesPreview();
  }
  function applyRules() {
    var r = readRules();
    if (!r.ok) { updateRulesPreview(); return; }
    if (r.base === game.base && r.perTai === game.perTai) { closeRules(); return; }
    var text = C.rulesText(r.base, r.perTai);
    var doIt = function () {
      if (dispatch({ type: 'SET_RULES', base: r.base, perTai: r.perTai, ts: Date.now() })) showToast('已改為 ' + text, true);
    };
    closeRules();
    var inProgress = game.round > 1 || game.scores.some(function (x) { return x !== 0; });
    if (!inProgress) { doIt(); return; }
    confirmModal('確定改為 ' + text + '？',
      '目前為 ' + C.rulesText(game.base, game.perTai) + '，牌局進行中。<br><b>過去的局不會重新計算</b>，只影響之後的結算。<br>之後可用「復原上一步」還原。',
      '確定修改').then(function (yes) { if (yes) doIt(); });
  }

  /* ---------------- Toast / Modal ---------------- */
  function showToast(msg, withUndo) {
    var t = $('toast');
    if (!t) return;
    setText('toastText', msg);
    toastUndo = !!withUndo;
    var a = $('toastAction');
    if (a) a.hidden = !withUndo;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, withUndo ? 5000 : 3500);
  }
  function hideToast() { var t = $('toast'); if (t) t.hidden = true; clearTimeout(toastTimer); }

  function confirmModal(title, bodyHTML, okText, danger) {
    return new Promise(function (resolve) {
      var m = $('modal');
      if (!m) { resolve(window.confirm(title)); return; }
      setText('modalTitle', title);
      setHTML('modalBody', bodyHTML || '');
      var ok = $('modalOk');
      if (ok) {
        ok.textContent = okText || '確定';
        ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-accent');
        ok.style.marginTop = '0';
        ok.style.width = '100%';
      }
      modalResolve = resolve;
      m.hidden = false;
    });
  }
  function closeModal(result) {
    var m = $('modal');
    if (m) m.hidden = true;
    var r = modalResolve; modalResolve = null;
    if (r) r(result);
  }

  /* ---------------- Actions ---------------- */
  function doUndo() {
    var u = game.undoStack[game.undoStack.length - 1];
    if (u && dispatch({ type: 'UNDO' })) showToast('已復原：' + u.label);
  }
  function doRedo() {
    var r = game.redoStack[game.redoStack.length - 1];
    if (r && dispatch({ type: 'REDO' })) showToast('已重做：' + r.label);
  }

  function doSettle() {
    var round = game.round;
    var ok;
    if (ui.mode === 'draw') {
      ok = dispatch({ type: 'DRAW', ts: Date.now() });
      if (ok) showToast('第 ' + round + ' 局流局，莊家連莊', true);
    } else {
      var calc = currentCalc();
      if (!calc.ok) { showToast(calc.error); return; }
      ok = dispatch({ type: 'SETTLE', mode: ui.mode, winner: ui.winner, loser: ui.loser, tai: ui.tai, ts: Date.now() });
      if (ok) showToast('第 ' + round + ' 局已結算', true);
    }
    if (ok) {
      ui.mode = 'discard'; ui.winner = null; ui.loser = null; ui.tai = 0;
      saveUI(); renderPlay();
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
    }
  }

  function doFixApply() {
    var r = readFix();
    if (!r.ok) { updateFixSum(); showToast('請輸入數字（負數請按 ±）'); return; }
    var isSet = ui.fixMode === 'set';
    var target = isSet ? r.vals : game.scores.map(function (s, i) { return C.round1(s + r.vals[i]); });
    var changed = target.some(function (v, i) { return v !== game.scores[i]; });
    if (!changed) { showToast('分數沒有變更'); return; }
    var body = '';
    for (var i = 0; i < 4; i++) {
      body += '<div class="mrow"><span>' + esc(nm(i)) + '</span><span>' + signed(game.scores[i]) + ' → <b class="' + cls(target[i]) + '">' + signed(target[i]) + '</b></span></div>';
    }
    var s = sumOf(target);
    if (s !== 0) body += '<div class="mrow neg"><b>⚠️ 四人總分將為 ' + signed(s) + '，並非 0</b></div>';
    body += '<div class="hint">之後可用「復原上一步」還原。</div>';
    confirmModal(isSet ? '確定設定目前總分？' : '確定套用加減調整？', body, '確定套用').then(function (yes) {
      if (!yes) return;
      var ok = dispatch(isSet ? { type: 'SET_SCORES', scores: target, ts: Date.now() } : { type: 'ADJUST_SCORES', deltas: r.vals, ts: Date.now() });
      if (ok) { fixDirty = false; renderFixRows(); showToast(isSet ? '已設定總分' : '已套用調整', true); }
    });
  }

  function renderNameRows() {
    var box = $('nameRows');
    if (!box) return;
    var h = '';
    for (var i = 0; i < 4; i++) {
      h += '<div class="fix-row names-row"><div class="fname">玩家 ' + (i + 1) + '</div>' +
        '<input id="name-' + i + '" type="text" maxlength="12" autocomplete="off" value="' + esc(nm(i)) + '" aria-label="玩家 ' + (i + 1) + ' 名稱"></div>';
    }
    box.innerHTML = h;
  }
  function doSaveNames() {
    var names = [];
    for (var i = 0; i < 4; i++) { var el = $('name-' + i); names.push(el ? el.value : ''); }
    game = C.reduce(game, { type: 'SET_NAMES', names: names });
    save(); renderNameRows(); render();
    showToast('已儲存玩家名稱');
  }

  function buildExportText() {
    var L = [];
    var now = new Date();
    L.push('🀄 麻將計分器紀錄（目前 ' + C.rulesText(game.base, game.perTai) + '）');
    L.push('匯出時間：' + now.getFullYear() + '/' + fmtTime(now.getTime()));
    L.push('目前：第 ' + game.round + ' 局｜莊：' + nm(game.dealer) + '｜連 ' + game.streak + ' 拉 ' + game.streak);
    L.push('');
    L.push('【目前總分】');
    for (var i = 0; i < 4; i++) L.push(nm(i) + '（' + C.seatName(i, game.dealer) + (i === game.dealer ? '・莊' : '') + '）' + signed(game.scores[i]));
    var s = sumOf(game.scores);
    if (s !== 0) L.push('⚠️ 總和 ' + signed(s) + '，並非 0');
    L.push('');
    L.push('【歷史紀錄】（' + game.history.length + ' 筆）');
    game.history.forEach(function (e) {
      var line = '';
      var d = Array.isArray(e.deltas) ? e.deltas.map(function (x, k) { return nm(k) + ' ' + signed(x); }).join('、') : '';
      if (e.kind === 'settle') {
        line = '第 ' + e.round + ' 局｜莊 ' + nm(e.dealer) + ' 連' + e.streak + '拉' + e.streak + '｜' +
          (e.mode === 'selfDraw' ? nm(e.winner) + ' 自摸' : nm(e.winner) + ' 胡 ' + nm(e.loser)) + ' ' + e.tai + ' 台' +
          (e.bonusTai ? '（莊相關 +' + e.bonusTai + '）' : '') + '｜' + entryRules(e) + '｜' + d;
      } else if (e.kind === 'draw') {
        line = '第 ' + e.round + ' 局｜莊 ' + nm(e.dealer) + ' 連' + e.streak + '拉' + e.streak + '｜流局';
      } else if (e.kind === 'setScores') {
        line = '手動設定總分｜' + d;
      } else if (e.kind === 'adjust') {
        line = '分數調整｜' + d;
      } else if (e.kind === 'rules') {
        line = '修改底／每台｜' + C.rulesText(e.fromBase, e.fromPerTai) + ' → ' + C.rulesText(e.base, e.perTai);
      } else if (e.kind === 'dealer') {
        line = '更換莊家｜' + nm(e.fromDealer) + ' → ' + nm(e.toDealer);
      }
      if (Array.isArray(e.scoresAfter)) line += '｜後：' + e.scoresAfter.map(signed).join(' / ');
      L.push(fmtTime(e.ts) + ' ' + line);
    });
    return L.join('\n');
  }

  function doExport() {
    var text = buildExportText();
    var ta = $('exportText');
    if (ta) { ta.hidden = false; ta.value = text; }
    var fallback = function () {
      var copied = false;
      if (ta) {
        try { ta.focus(); ta.select(); ta.setSelectionRange(0, text.length); copied = document.execCommand('copy'); } catch (e) { copied = false; }
      }
      showToast(copied ? '已複製到剪貼簿' : '無法自動複製，請長按下方文字全選複製');
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { showToast('已複製到剪貼簿'); }, fallback);
      } else fallback();
    } catch (e) { fallback(); }
  }

  function doReset() {
    confirmModal('確定要清除目前牌局嗎？',
      '分數、歷史紀錄、莊家、連拉與局數都會清除，<b>無法復原</b>。<br>（建議先用「匯出／備份」保存紀錄）',
      '清除並重開', true).then(function (yes) {
      if (!yes) return;
      safeSet(KEY + '.lastReset', JSON.stringify(game));
      game = C.reduce(game, { type: 'RESET' });
      ui = defaultUI(); fixDirty = false;
      save(); saveUI(); render(); renderNameRows();
      var ta = $('exportText'); if (ta) { ta.hidden = true; ta.value = ''; }
      var rp = $('resetPanel'); if (rp) rp.open = false;
      try { window.scrollTo(0, 0); } catch (e) { /* ignore */ }
      showToast('已重開一桌');
    });
  }

  function onClick(ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest('[data-action]') : null;
    if (!el || el.disabled) return;
    var a = el.getAttribute('data-action');
    var i = C.toInt(el.getAttribute('data-i'), -1);
    switch (a) {
      case 'mode':
        ui.mode = el.getAttribute('data-value');
        if (ui.mode !== 'discard') ui.loser = null;
        saveUI(); renderPlay(); break;
      case 'winner':
        ui.winner = ui.winner === i ? null : i;
        if (ui.loser === ui.winner) ui.loser = null;
        saveUI(); renderPlay(); break;
      case 'loser':
        if (i === ui.winner) break;
        ui.loser = ui.loser === i ? null : i;
        saveUI(); renderPlay(); break;
      case 'tai-dec': ui.tai = Math.max(0, ui.tai - 1); saveUI(); renderPlay(); break;
      case 'tai-inc': ui.tai = Math.min(C.MAX_TAI, ui.tai + 1); saveUI(); renderPlay(); break;
      case 'settle': doSettle(); break;
      case 'streak-dec': dispatch({ type: 'SET_STREAK', streak: game.streak - 1 }); break;
      case 'streak-inc': dispatch({ type: 'SET_STREAK', streak: game.streak + 1 }); break;
      case 'dealer':
        if (i !== game.dealer && dispatch({ type: 'SET_DEALER', dealer: i, ts: Date.now() })) {
          showToast('莊家改為 ' + nm(i) + '（連莊歸零）', true);
        }
        break;
      case 'undo': doUndo(); break;
      case 'redo': doRedo(); break;
      case 'toast-action': hideToast(); if (toastUndo) doUndo(); break;
      case 'fix-mode':
        ui.fixMode = el.getAttribute('data-value') === 'adjust' ? 'adjust' : 'set';
        fixDirty = false; saveUI(); renderTools(); break;
      case 'fix-sign': {
        var inp = $('fix-' + i);
        if (inp) {
          var v = inp.value.trim().replace(/[−－﹣–—]/g, '-');
          inp.value = v.charAt(0) === '-' ? v.slice(1) : '-' + v.replace(/^\+/, '');
          fixDirty = true; updateFixSum();
        }
        break;
      }
      case 'fix-apply': doFixApply(); break;
      case 'names-save': doSaveNames(); break;
      case 'export': doExport(); break;
      case 'reset': doReset(); break;
      case 'rules-open': openRules(); break;
      case 'rules-cancel': closeRules(); break;
      case 'rules-apply': applyRules(); break;
      case 'rules-step': stepRules(el.getAttribute('data-field'), C.toInt(el.getAttribute('data-d'), 0)); break;
      case 'modal-ok': closeModal(true); break;
      case 'modal-cancel': closeModal(false); break;
      default: break;
    }
  }

  function onInput(ev) {
    var t = ev.target;
    if (!t) return;
    if (t.id === 'taiInput') {
      var digits = String(t.value).replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/\D/g, '').slice(0, 3);
      if (digits !== t.value) t.value = digits;
      ui.tai = digits === '' ? 0 : C.clamp(parseInt(digits, 10), 0, C.MAX_TAI);
      saveUI(); renderPlay();
    } else if (t.hasAttribute && t.hasAttribute('data-fix')) {
      fixDirty = true; updateFixSum();
    } else if (t.hasAttribute && t.hasAttribute('data-rules')) {
      updateRulesPreview();
    }
  }

  function selectAll(el) {
    try { el.select(); el.setSelectionRange(0, String(el.value).length); } catch (e) { /* ignore */ }
  }

  /* ---------------- Wake lock ---------------- */
  function requestWake() {
    try {
      if (!('wakeLock' in navigator) || wakeLock || document.visibilityState !== 'visible') return;
      navigator.wakeLock.request('screen').then(function (lock) {
        wakeLock = lock;
        try { lock.addEventListener('release', function () { wakeLock = null; }); } catch (e) { /* ignore */ }
      }).catch(function () { wakeLock = null; });
    } catch (e) { wakeLock = null; }
  }

  /* ---------------- Boot ---------------- */
  function showFatal(err) {
    var app = $('app') || document.body;
    var box = document.createElement('div');
    box.className = 'fatal';
    box.innerHTML = '<b>載入時發生錯誤</b><p>' + esc(err && err.message ? err.message : err) + '</p>' +
      '<p>資料仍保留在瀏覽器中。可重新整理再試，或清除資料重新開始。</p>';
    var btn = document.createElement('button');
    btn.className = 'btn btn-danger';
    btn.textContent = '清除資料並重新開始';
    btn.onclick = function () {
      if (!window.confirm('確定要清除目前牌局嗎？')) return;
      var raw = safeGet(KEY); if (raw) safeSet(KEY + '.corrupt.' + Date.now(), raw);
      try { localStorage.removeItem(KEY); localStorage.removeItem(UI_KEY); } catch (e) { /* ignore */ }
      location.reload();
    };
    box.appendChild(btn);
    app.insertBefore(box, app.firstChild);
  }

  function init() {
    if (!C) throw new Error('core.js 未載入');
    game = loadGame();
    ui = loadUI();
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('focusin', function (ev) {
      var t = ev.target;
      if (t && (t.id === 'taiInput' || (t.hasAttribute && (t.hasAttribute('data-fix') || t.hasAttribute('data-rules'))))) {
        selectAll(t);
        setTimeout(function () { if (document.activeElement === t) selectAll(t); }, 0); // iOS Safari
      }
    });
    document.addEventListener('focusout', function (ev) {
      if (ev.target && ev.target.id === 'taiInput') { ev.target.value = String(ui.tai); renderPlay(); }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && ev.target && ev.target.id === 'taiInput') ev.target.blur();
      if (ev.key === 'Escape' && modalResolve) closeModal(false);
      else if (ev.key === 'Escape') closeRules();
      if (ev.key === 'Enter' && ev.target && ev.target.hasAttribute && ev.target.hasAttribute('data-rules')) ev.target.blur();
    });
    var modal = $('modal');
    if (modal) modal.addEventListener('click', function (ev) { if (ev.target === modal) closeModal(false); });
    var rm = $('rulesModal');
    if (rm) rm.addEventListener('click', function (ev) { if (ev.target === rm) closeRules(); });
    var hp = $('historyPanel');
    if (hp) hp.addEventListener('toggle', renderHistory);
    var fp = $('fixPanel');
    if (fp) fp.addEventListener('toggle', function () { if (fp.open && !fixDirty) renderFixRows(); });
    window.addEventListener('storage', function (ev) {
      // 另一個分頁修改資料時同步
      if (ev.key === KEY) { game = C.parseGameJSON(ev.newValue).game; render(); renderNameRows(); }
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') requestWake(); else save();
    });
    window.addEventListener('pagehide', function () { save(); saveUI(); });
    document.addEventListener('pointerdown', requestWake, { passive: true });
    render();
    renderNameRows();
    save(); // 寫回已修復／遷移的資料
    requestWake();
  }

  try { init(); } catch (err) {
    try { console.warn('init failed', err); } catch (e) { /* ignore */ }
    showFatal(err);
  }
})();
