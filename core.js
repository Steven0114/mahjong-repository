/*
 * 台灣 16 張麻將計分器 — 純計算核心（無 DOM）
 * 瀏覽器：window.MahjongCore；Node：module.exports
 *
 * 規則：底、每台金額可設定（預設 3 底 1 台）
 * 每筆付款 = 底 + (牌型台數 + 莊家相關台數〔若莊家參與〕) × 每台
 * 莊家相關額外台數 = 1 + 2N（莊 1、連 N、拉 N），N = 目前連莊數
 * 只要該筆付款的任一方是莊家，就加上莊家額外台數（雙向）。
 * 自摸逐家計算。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (root) { root.MahjongCore = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var VERSION = 2;
  var N_PLAYERS = 4;
  var BASE = 3;          // 預設 3 底
  var PER_TAI = 1;       // 預設每台 1
  var MAX_MONEY = 1000000;
  var MAX_STACK = 200;   // undo / redo 上限
  var MAX_TAI = 999;
  var SEATS = ['東', '南', '西', '北'];
  var DEFAULT_NAMES = ['Steven', '豐', '詠', '美女'];

  function isIdx(i) { return typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < N_PLAYERS; }
  function toInt(v, def) {
    if (v === null || v === undefined || v === '') return def;
    var n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : def;
  }
  /** 四捨五入到小數 1 位，避免浮點誤差 */
  function round1(n) { return Math.round(n * 10) / 10; }
  /** 轉成數字（最多 1 位小數）；無效回傳 def */
  function toNum1(v, def) {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return def;
    var n = Number(v);
    return Number.isFinite(n) ? round1(n) : def;
  }
  /** 底、每台是否合法：底 ≥ 0、每台 > 0、最多 1 位小數 */
  function validRules(base, perTai) {
    var okDec = function (x) { return typeof x === 'number' && Number.isFinite(x) && Math.abs(x * 10 - Math.round(x * 10)) < 1e-9; };
    return okDec(base) && okDec(perTai) && base >= 0 && perTai > 0 && base <= MAX_MONEY && perTai <= MAX_MONEY;
  }
  function fmtNum(n) { return String(round1(Number(n) || 0)); }
  function rulesText(base, perTai) { return fmtNum(base) + ' 底・' + fmtNum(perTai) + ' 台'; }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function dealerBonusTai(streak) { return 1 + 2 * Math.max(0, toInt(streak, 0)); }
  function seatOf(player, dealer) { return ((player - dealer) % N_PLAYERS + N_PLAYERS) % N_PLAYERS; }
  function seatName(player, dealer) { return SEATS[seatOf(player, dealer)]; }
  /** 依東南西北順序回傳玩家 index（從莊家開始，依原始順序） */
  function seatOrder(dealer) {
    var out = [];
    for (var k = 0; k < N_PLAYERS; k++) out.push((dealer + k) % N_PLAYERS);
    return out;
  }

  function formatSigned(n) {
    n = toNum1(n, 0);
    if (n > 0) return '+' + fmtNum(n);
    if (n < 0) return '-' + fmtNum(Math.abs(n));
    return '0';
  }

  /**
   * 計算本局付款（純函式）
   * state:  { dealer, streak, base?, perTai? }（base/perTai 預設 3/1）
   * action: { type: 'discard' | 'selfDraw' | 'draw', winner, loser, tai }
   * 回傳: { ok, error, type, deltas[4], payments[{from,to,tai,amount,dealerInvolved}], tai, bonusTai, bonusApplied }
   */
  function calculateSettlement(state, action) {
    state = state || {};
    action = action || {};
    var dealer = state.dealer;
    var streak = Math.max(0, toInt(state.streak, 0));
    var bonus = dealerBonusTai(streak);
    var base = state.base === undefined ? BASE : toNum1(state.base, NaN);
    var perTai = state.perTai === undefined ? PER_TAI : toNum1(state.perTai, NaN);
    var res = {
      base: base, perTai: perTai,
      ok: false, error: '', type: action.type, deltas: [0, 0, 0, 0], payments: [],
      tai: 0, bonusTai: bonus, bonusApplied: false, dealer: dealer, streak: streak
    };
    if (!isIdx(dealer)) { res.error = '尚未設定莊家'; return res; }
    if (!validRules(base, perTai)) { res.error = '底／每台設定不正確'; return res; }

    if (action.type === 'draw') { res.ok = true; return res; }
    if (action.type !== 'discard' && action.type !== 'selfDraw') { res.error = '請選擇放槍、自摸或流局'; return res; }

    var winner = action.winner;
    if (!isIdx(winner)) { res.error = '請選擇胡牌者'; return res; }
    var tai = toInt(action.tai, NaN);
    if (!(tai >= 0)) { res.error = '台數不正確'; return res; }
    if (tai > MAX_TAI) { res.error = '台數過大'; return res; }
    res.tai = tai;

    var payers;
    if (action.type === 'discard') {
      var loser = action.loser;
      if (!isIdx(loser)) { res.error = '請選擇放槍者'; return res; }
      if (loser === winner) { res.error = '胡牌者與放槍者不能相同'; return res; }
      payers = [loser];
    } else {
      payers = [];
      for (var p = 0; p < N_PLAYERS; p++) if (p !== winner) payers.push(p);
    }

    payers.forEach(function (from) {
      var involved = (winner === dealer) || (from === dealer);
      var t = tai + (involved ? bonus : 0);
      var amount = round1(base + t * perTai);
      if (involved) res.bonusApplied = true;
      res.payments.push({ from: from, to: winner, tai: t, amount: amount, dealerInvolved: involved });
      res.deltas[from] = round1(res.deltas[from] - amount);
      res.deltas[winner] = round1(res.deltas[winner] + amount);
    });
    res.ok = true;
    return res;
  }

  /**
   * 下一局莊家狀態
   * 莊家胡／自摸，或流局 → 連莊 N+1
   * 閒家胡 → 下一位（原始順序）當莊，N = 0
   */
  function nextDealerState(state, action) {
    var dealer = state.dealer;
    var streak = Math.max(0, toInt(state.streak, 0));
    if (!action || action.type === 'draw' || action.winner === dealer) {
      return { dealer: dealer, streak: streak + 1, dealerStays: true };
    }
    return { dealer: (dealer + 1) % N_PLAYERS, streak: 0, dealerStays: false };
  }

  function createInitialGame(names) {
    return {
      version: VERSION,
      names: sanitizeNames(names),
      scores: [0, 0, 0, 0],
      dealer: 0,
      streak: 0,
      round: 1,
      base: BASE,
      perTai: PER_TAI,
      history: [],
      undoStack: [],
      redoStack: [],
      seq: 0
    };
  }

  function sanitizeNames(names) {
    var out = DEFAULT_NAMES.slice();
    if (Array.isArray(names)) {
      for (var i = 0; i < N_PLAYERS; i++) {
        var s = typeof names[i] === 'string' ? names[i].trim().slice(0, 12) : '';
        if (s) out[i] = s;
      }
    }
    return out;
  }

  function coreOf(g) { return { scores: g.scores.slice(), dealer: g.dealer, streak: g.streak, round: g.round, base: g.base, perTai: g.perTai }; }
  function applyCore(g, c) {
    g.scores = c.scores.slice(); g.dealer = c.dealer; g.streak = c.streak; g.round = c.round;
    g.base = c.base; g.perTai = c.perTai;
  }
  /** 以目前狀態為基礎，覆寫部分欄位 */
  function withCore(g, patch) {
    var c = coreOf(g);
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) c[k] = patch[k];
    return c;
  }

  function validCore(c) {
    return !!c && Array.isArray(c.scores) && c.scores.length === N_PLAYERS &&
      c.scores.every(function (x) { return typeof x === 'number' && Number.isFinite(x); }) &&
      isIdx(c.dealer) && Number.isInteger(c.streak) && c.streak >= 0 &&
      Number.isInteger(c.round) && c.round >= 1 && validRules(c.base, c.perTai);
  }

  function commit(g, label, newCore, entry) {
    var after = coreOf(g);
    for (var k in newCore) if (Object.prototype.hasOwnProperty.call(newCore, k)) after[k] = newCore[k];
    after.scores = after.scores.slice();
    var rec = { label: label, before: coreOf(g), after: after, entry: entry || null };
    applyCore(g, rec.after);
    if (entry) g.history.push(entry);
    g.undoStack.push(rec);
    if (g.undoStack.length > MAX_STACK) g.undoStack.splice(0, g.undoStack.length - MAX_STACK);
    g.redoStack = [];
    return g;
  }

  function addScores(a, b) { return a.map(function (x, i) { return round1(x + b[i]); }); }

  /**
   * 狀態 reducer（純函式，回傳新物件；無效動作回傳原物件）
   * actions:
   *  { type:'SETTLE', mode:'discard'|'selfDraw', winner, loser, tai, ts }
   *  { type:'DRAW', ts }
   *  { type:'SET_DEALER', dealer, ts }
   *  { type:'SET_STREAK', streak }
   *  { type:'SET_SCORES', scores, ts }
   *  { type:'ADJUST_SCORES', deltas, ts }
   *  { type:'UNDO' } / { type:'REDO' }
   *  { type:'RESET' }
   *  { type:'SET_NAMES', names }
   */
  function reduce(game, action) {
    if (!game || !action) return game;
    var g, ts = typeof action.ts === 'number' ? action.ts : Date.now();
    switch (action.type) {
      case 'SETTLE': {
        var calc = calculateSettlement(game, { type: action.mode, winner: action.winner, loser: action.loser, tai: action.tai });
        if (!calc.ok || action.mode === 'draw') return game;
        g = clone(game);
        var nxt = nextDealerState(game, { type: action.mode, winner: action.winner });
        var after = withCore(game, { scores: addScores(game.scores, calc.deltas), dealer: nxt.dealer, streak: nxt.streak, round: game.round + 1 });
        g.seq = (g.seq || 0) + 1;
        var entry = {
          id: g.seq, kind: 'settle', round: game.round, mode: action.mode,
          dealer: game.dealer, streak: game.streak,
          winner: action.winner, loser: action.mode === 'discard' ? action.loser : null,
          tai: calc.tai, bonusTai: calc.bonusApplied ? calc.bonusTai : 0, base: calc.base, perTai: calc.perTai,
          payments: calc.payments, deltas: calc.deltas, scoresAfter: after.scores.slice(),
          nextDealer: nxt.dealer, nextStreak: nxt.streak, ts: ts
        };
        return commit(g, '第 ' + game.round + ' 局結算', after, entry);
      }
      case 'DRAW': {
        g = clone(game);
        var nd = nextDealerState(game, { type: 'draw' });
        var afterD = withCore(game, { dealer: nd.dealer, streak: nd.streak, round: game.round + 1 });
        g.seq = (g.seq || 0) + 1;
        var entryD = {
          id: g.seq, kind: 'draw', round: game.round, dealer: game.dealer, streak: game.streak, base: game.base, perTai: game.perTai,
          deltas: [0, 0, 0, 0], scoresAfter: afterD.scores.slice(), nextDealer: nd.dealer, nextStreak: nd.streak, ts: ts
        };
        return commit(g, '第 ' + game.round + ' 局流局', afterD, entryD);
      }
      case 'SET_DEALER': {
        if (!isIdx(action.dealer) || action.dealer === game.dealer) return game;
        g = clone(game);
        g.seq = (g.seq || 0) + 1;
        var entryS = { id: g.seq, kind: 'dealer', round: game.round, fromDealer: game.dealer, toDealer: action.dealer, fromStreak: game.streak, ts: ts };
        entryS.base = game.base; entryS.perTai = game.perTai;
        return commit(g, '更換莊家', { dealer: action.dealer, streak: 0 }, entryS);
      }
      case 'SET_STREAK': {
        var s = toInt(action.streak, NaN);
        if (!(s >= 0) || s === game.streak) return game;
        s = Math.min(s, 99);
        g = clone(game);
        return commit(g, '修改連莊為 ' + s, { streak: s }, null);
      }
      case 'SET_SCORES':
      case 'ADJUST_SCORES': {
        var arr = action.type === 'SET_SCORES' ? action.scores : action.deltas;
        if (!Array.isArray(arr) || arr.length !== N_PLAYERS) return game;
        var nums = arr.map(function (x) { return toNum1(x, NaN); });
        if (!nums.every(function (x) { return Number.isFinite(x) && Math.abs(x) <= 1e9; })) return game;
        var newScores = action.type === 'SET_SCORES' ? nums : addScores(game.scores, nums);
        var deltas = newScores.map(function (x, i) { return round1(x - game.scores[i]); });
        if (deltas.every(function (d) { return d === 0; })) return game;
        g = clone(game);
        g.seq = (g.seq || 0) + 1;
        var entryM = {
          id: g.seq, kind: action.type === 'SET_SCORES' ? 'setScores' : 'adjust', round: game.round,
          scoresBefore: game.scores.slice(), deltas: deltas, scoresAfter: newScores.slice(),
          base: game.base, perTai: game.perTai, ts: ts
        };
        return commit(g, action.type === 'SET_SCORES' ? '手動設定總分' : '分數加減調整', { scores: newScores }, entryM);
      }
      case 'SET_RULES': {
        // 修改底／每台。不重算過去的局。
        var nb = toNum1(action.base, NaN), np = toNum1(action.perTai, NaN);
        if (Number(action.base) !== nb || Number(action.perTai) !== np) return game; // 超過 1 位小數
        if (!validRules(nb, np) || (nb === game.base && np === game.perTai)) return game;
        g = clone(game);
        g.seq = (g.seq || 0) + 1;
        var entryR = {
          id: g.seq, kind: 'rules', round: game.round,
          fromBase: game.base, fromPerTai: game.perTai, base: nb, perTai: np, ts: ts
        };
        return commit(g, '修改為 ' + rulesText(nb, np), { base: nb, perTai: np }, entryR);
      }
      case 'UNDO': {
        if (!game.undoStack.length) return game;
        g = clone(game);
        var rec = g.undoStack.pop();
        applyCore(g, rec.before);
        if (rec.entry) g.history.pop();
        g.redoStack.push(rec);
        if (g.redoStack.length > MAX_STACK) g.redoStack.splice(0, g.redoStack.length - MAX_STACK);
        return g;
      }
      case 'REDO': {
        if (!game.redoStack.length) return game;
        g = clone(game);
        var r = g.redoStack.pop();
        applyCore(g, r.after);
        if (r.entry) g.history.push(r.entry);
        g.undoStack.push(r);
        if (g.undoStack.length > MAX_STACK) g.undoStack.splice(0, g.undoStack.length - MAX_STACK);
        return g;
      }
      case 'RESET':
        return createInitialGame(game.names);
      case 'SET_NAMES': {
        g = clone(game);
        g.names = sanitizeNames(action.names);
        return g;
      }
      default:
        return game;
    }
  }

  /**
   * 載入／遷移資料。任何異常都回傳可用的狀態，不丟例外。
   * 回傳 { game, repaired: bool, reason }
   */
  /** v1 歷史紀錄沒有 base/perTai → 當時一定是 3 底 1 台 */
  function migrateEntry(e) {
    if (e && typeof e === 'object' && e.kind !== 'rules' && e.base === undefined && e.perTai === undefined) {
      e.base = BASE; e.perTai = PER_TAI;
    }
    return e;
  }

  function sanitizeGame(raw) {
    var fresh = createInitialGame();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { game: fresh, repaired: raw != null, reason: 'invalid' };
    var repaired = false;
    var v = raw.version;
    // v1 → v2：加入 base/perTai（預設 3 底 1 台）。未知/較新版本 → 盡量保留可辨識的欄位
    if (v !== 1 && v !== 2) repaired = true;
    var g = createInitialGame(raw.names);
    if (Array.isArray(raw.scores) && raw.scores.length === N_PLAYERS && raw.scores.every(function (x) { return Number.isFinite(Number(x)) && x !== null && x !== ''; })) {
      g.scores = raw.scores.map(function (x) { return round1(Number(x)); });
    } else if (raw.scores !== undefined) repaired = true;
    if (isIdx(raw.dealer)) g.dealer = raw.dealer; else if (raw.dealer !== undefined) repaired = true;
    var st = toInt(raw.streak, 0); g.streak = st >= 0 ? Math.min(st, 99) : 0;
    var rd = toInt(raw.round, 1); g.round = rd >= 1 ? rd : 1;
    g.seq = Math.max(0, toInt(raw.seq, 0));
    var rb = toNum1(raw.base, NaN), rp = toNum1(raw.perTai, NaN);
    if (validRules(rb, rp)) { g.base = rb; g.perTai = rp; }
    else if (raw.base !== undefined || raw.perTai !== undefined) repaired = true;
    if (Array.isArray(raw.history)) {
      g.history = raw.history.filter(function (e) { return e && typeof e === 'object' && typeof e.kind === 'string'; });
      g.history.forEach(migrateEntry);
      if (g.history.length !== raw.history.length) repaired = true;
    }
    // v1 的 undo/redo 快照沒有 base/perTai → 補上 3 底 1 台
    var migrateCore = function (c) {
      if (c && typeof c === 'object' && c.base === undefined && c.perTai === undefined) { c.base = BASE; c.perTai = PER_TAI; }
      return c;
    };
    var okRec = function (r) {
      var ok = r && typeof r === 'object' && validCore(migrateCore(r.before)) && validCore(migrateCore(r.after));
      if (ok && r.entry) migrateEntry(r.entry);
      return ok;
    };
    if (Array.isArray(raw.undoStack)) g.undoStack = raw.undoStack.filter(okRec).slice(-MAX_STACK);
    if (Array.isArray(raw.redoStack)) g.redoStack = raw.redoStack.filter(okRec).slice(-MAX_STACK);
    if ((raw.undoStack && g.undoStack.length !== raw.undoStack.length) || (raw.redoStack && g.redoStack.length !== raw.redoStack.length)) {
      // 堆疊不一致時，丟掉堆疊比錯誤復原安全
      g.undoStack = []; g.redoStack = []; repaired = true;
    }
    g.version = VERSION;
    return { game: g, repaired: repaired, reason: repaired ? 'repaired' : '' };
  }

  function parseGameJSON(text) {
    if (text == null) return { game: createInitialGame(), repaired: false, reason: 'empty' };
    var raw;
    try { raw = JSON.parse(text); } catch (e) { return { game: createInitialGame(), repaired: true, reason: 'parse' }; }
    try { return sanitizeGame(raw); } catch (e2) { return { game: createInitialGame(), repaired: true, reason: 'sanitize' }; }
  }

  return {
    VERSION: VERSION, BASE: BASE, PER_TAI: PER_TAI, MAX_STACK: MAX_STACK, MAX_TAI: MAX_TAI,
    SEATS: SEATS, DEFAULT_NAMES: DEFAULT_NAMES, N_PLAYERS: N_PLAYERS,
    isIdx: isIdx, toInt: toInt, toNum1: toNum1, round1: round1, clamp: clamp,
    validRules: validRules, fmtNum: fmtNum, rulesText: rulesText,
    dealerBonusTai: dealerBonusTai, seatOf: seatOf, seatName: seatName, seatOrder: seatOrder,
    formatSigned: formatSigned,
    calculateSettlement: calculateSettlement, nextDealerState: nextDealerState,
    createInitialGame: createInitialGame, sanitizeNames: sanitizeNames,
    reduce: reduce, sanitizeGame: sanitizeGame, parseGameJSON: parseGameJSON
  };
});
