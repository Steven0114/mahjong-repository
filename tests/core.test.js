// 執行：node tests/core.test.js
'use strict';
const assert = require('assert');
const C = require('../core.js');

const A = 0, B = 1, Cc = 2, D = 3; // Steven, 豐, 詠, 美女
const results = [];
function test(name, fn) {
  try { fn(); results.push([name, true]); console.log('PASS', name); }
  catch (e) { results.push([name, false]); console.log('FAIL', name, '\n   ', e && e.message); }
}
const sum = a => a.reduce((x, y) => x + y, 0);
function game(dealer, streak, scores) {
  const g = C.createInitialGame();
  g.dealer = dealer; g.streak = streak; if (scores) g.scores = scores.slice();
  return g;
}

test('Case 1 無莊家交易 A 胡 B 5 台 → A+8 B-8', () => {
  // 莊家為 D，A、B 皆閒家
  const r = C.calculateSettlement({ dealer: D, streak: 0 }, { type: 'discard', winner: A, loser: B, tai: 5 });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.deltas, [8, -8, 0, 0]);
  assert.strictEqual(sum(r.deltas), 0);
});

test('Case 2 莊 A 連0 A 胡 B 5 台 → A+9 B-9', () => {
  const r = C.calculateSettlement({ dealer: A, streak: 0 }, { type: 'discard', winner: A, loser: B, tai: 5 });
  assert.deepStrictEqual(r.deltas, [9, -9, 0, 0]);
  assert.strictEqual(C.dealerBonusTai(0), 1);
});

test('Case 3 莊 A 連1拉1 A 胡 B 5 台 → A+11 B-11', () => {
  const r = C.calculateSettlement({ dealer: A, streak: 1 }, { type: 'discard', winner: A, loser: B, tai: 5 });
  assert.strictEqual(C.dealerBonusTai(1), 3);
  assert.deepStrictEqual(r.deltas, [11, -11, 0, 0]);
});

test('Case 4 莊 A 連2拉2 B 胡 A 5 台 → B+13 A-13', () => {
  const r = C.calculateSettlement({ dealer: A, streak: 2 }, { type: 'discard', winner: B, loser: A, tai: 5 });
  assert.deepStrictEqual(r.deltas, [-13, 13, 0, 0]);
});

test('Case 5 莊 A 連2拉2 B 自摸 5 台 → A-13 C-8 D-8 B+29', () => {
  const r = C.calculateSettlement({ dealer: A, streak: 2 }, { type: 'selfDraw', winner: B, tai: 5 });
  assert.deepStrictEqual(r.deltas, [-13, 29, -8, -8]);
  assert.strictEqual(sum(r.deltas), 0);
});

test('Case 6 莊 A 連2拉2 A 自摸 5 台 → A+39 BCD 各-13', () => {
  const r = C.calculateSettlement({ dealer: A, streak: 2 }, { type: 'selfDraw', winner: A, tai: 5 });
  assert.deepStrictEqual(r.deltas, [39, -13, -13, -13]);
  assert.strictEqual(sum(r.deltas), 0);
});

test('Case 7 莊 A 胡牌後繼續坐莊 連2→連3', () => {
  assert.deepStrictEqual(C.nextDealerState({ dealer: A, streak: 2 }, { type: 'discard', winner: A }).dealer, A);
  assert.strictEqual(C.nextDealerState({ dealer: A, streak: 2 }, { type: 'discard', winner: A }).streak, 3);
  // 透過 reducer：莊家自摸也連莊
  let g = game(A, 2);
  g = C.reduce(g, { type: 'SETTLE', mode: 'selfDraw', winner: A, tai: 5 });
  assert.strictEqual(g.dealer, A); assert.strictEqual(g.streak, 3); assert.strictEqual(g.round, 2);
  g = C.reduce(g, { type: 'SETTLE', mode: 'discard', winner: A, loser: Cc, tai: 0 });
  assert.strictEqual(g.dealer, A); assert.strictEqual(g.streak, 4);
});

let case8Before, case8After;
test('Case 8 莊 A，B 胡牌 → B 東 C 南 D 西 A 北，連0', () => {
  let g = game(A, 2, [5, -3, 1, -3]);
  g.round = 7;
  case8Before = g;
  g = C.reduce(g, { type: 'SETTLE', mode: 'discard', winner: B, loser: Cc, tai: 3 });
  case8After = g;
  assert.strictEqual(g.dealer, B);
  assert.strictEqual(g.streak, 0);
  assert.strictEqual(C.seatName(B, g.dealer), '東');
  assert.strictEqual(C.seatName(Cc, g.dealer), '南');
  assert.strictEqual(C.seatName(D, g.dealer), '西');
  assert.strictEqual(C.seatName(A, g.dealer), '北');
  assert.deepStrictEqual(C.seatOrder(g.dealer), [B, Cc, D, A]);
  assert.deepStrictEqual(g.scores, [5, -3 + 6, 1 - 6, -3]); // 閒胡閒 3+3=6
  assert.strictEqual(g.history.length, 1);
  assert.strictEqual(g.round, 8);
});

test('Case 9 Undo Case 8 → A 莊/東、連2、分數、局數、歷史全部恢復', () => {
  const g = C.reduce(case8After, { type: 'UNDO' });
  assert.strictEqual(g.dealer, A);
  assert.strictEqual(C.seatName(A, g.dealer), '東');
  assert.strictEqual(g.streak, 2);
  assert.deepStrictEqual(g.scores, case8Before.scores);
  assert.strictEqual(g.round, 7);
  assert.strictEqual(g.history.length, 0);
  assert.strictEqual(g.redoStack.length, 1);
});

test('Case 10 手動設定 +28/-12/+5/-21 → 總和 0，JSON 存取（reload）後完全相同', () => {
  let g = C.createInitialGame();
  g = C.reduce(g, { type: 'SET_SCORES', scores: [28, -12, 5, -21] });
  assert.deepStrictEqual(g.scores, [28, -12, 5, -21]);
  assert.strictEqual(sum(g.scores), 0);
  const reloaded = C.parseGameJSON(JSON.stringify(g));
  assert.strictEqual(reloaded.repaired, false);
  assert.deepStrictEqual(reloaded.game.scores, [28, -12, 5, -21]);
  assert.deepStrictEqual(reloaded.game, g);
  // 加減調整模式
  g = C.reduce(g, { type: 'ADJUST_SCORES', deltas: [5, -5, 0, 0] });
  assert.deepStrictEqual(g.scores, [33, -17, 5, -21]);
});

test('流局：無金錢移動，莊家連莊 N+1，局數+1，記錄於歷史且可 Undo', () => {
  const r = C.calculateSettlement({ dealer: Cc, streak: 1 }, { type: 'draw' });
  assert.ok(r.ok); assert.deepStrictEqual(r.deltas, [0, 0, 0, 0]);
  let g = game(Cc, 1, [10, -10, 4, -4]);
  const before = g;
  g = C.reduce(g, { type: 'DRAW' });
  assert.deepStrictEqual(g.scores, [10, -10, 4, -4]);
  assert.strictEqual(g.dealer, Cc); assert.strictEqual(g.streak, 2); assert.strictEqual(g.round, 2);
  assert.strictEqual(g.history.length, 1); assert.strictEqual(g.history[0].kind, 'draw');
  g = C.reduce(g, { type: 'UNDO' });
  assert.strictEqual(g.streak, 1); assert.strictEqual(g.round, 1); assert.strictEqual(g.history.length, 0);
  assert.deepStrictEqual(g.scores, before.scores);
});

test('多步 Undo / Redo（含換莊、手動、流局），且新動作會清除 Redo', () => {
  const s0 = C.createInitialGame();
  const steps = [
    { type: 'SETTLE', mode: 'discard', winner: A, loser: B, tai: 2 },   // 莊 A 胡 → 連1
    { type: 'SETTLE', mode: 'selfDraw', winner: Cc, tai: 4 },            // 閒自摸 → 豐當莊
    { type: 'DRAW' },                                                    // 豐 連1
    { type: 'SET_STREAK', streak: 3 },
    { type: 'ADJUST_SCORES', deltas: [1, -1, 2, -2] },
    { type: 'SET_DEALER', dealer: D },
    { type: 'SETTLE', mode: 'discard', winner: B, loser: D, tai: 1 }
  ];
  const states = [s0];
  let g = s0;
  for (const a of steps) { g = C.reduce(g, a); states.push(g); }
  assert.strictEqual(g.undoStack.length, steps.length);
  // 檢查中間結果
  assert.deepStrictEqual(states[1].scores, [6, -6, 0, 0]);        // 3+2+1
  assert.deepStrictEqual(states[2].scores, [6 - 10, -6 - 7, 24, -7]); // 莊A連1→額外3：A付3+4+3=10
  assert.strictEqual(states[2].dealer, B); assert.strictEqual(states[2].streak, 0);
  assert.strictEqual(states[3].dealer, B); assert.strictEqual(states[3].streak, 1);
  const core = s => JSON.stringify([s.scores, s.dealer, s.streak, s.round, s.history]);
  // 全部 Undo
  for (let i = steps.length - 1; i >= 0; i--) {
    g = C.reduce(g, { type: 'UNDO' });
    assert.strictEqual(core(g), core(states[i]), 'undo to step ' + i);
  }
  assert.strictEqual(C.reduce(g, { type: 'UNDO' }), g); // 無可 undo → 不變
  // 全部 Redo
  for (let i = 1; i <= steps.length; i++) {
    g = C.reduce(g, { type: 'REDO' });
    assert.strictEqual(core(g), core(states[i]), 'redo to step ' + i);
  }
  // undo 2 步後做新動作 → redo 清空
  g = C.reduce(C.reduce(g, { type: 'UNDO' }), { type: 'UNDO' });
  assert.strictEqual(g.redoStack.length, 2);
  g = C.reduce(g, { type: 'DRAW' });
  assert.strictEqual(g.redoStack.length, 0);
});

test('Undo 堆疊上限 200', () => {
  let g = C.createInitialGame();
  for (let i = 0; i < 230; i++) g = C.reduce(g, { type: 'DRAW' });
  assert.strictEqual(g.undoStack.length, C.MAX_STACK);
  assert.strictEqual(g.history.length, 230);
  for (let i = 0; i < 250; i++) g = C.reduce(g, { type: 'UNDO' });
  assert.strictEqual(g.history.length, 30);
  assert.strictEqual(g.round, 31);
});

test('驗證：無效輸入不結算、台數不可負、胡牌者≠放槍者', () => {
  const st = { dealer: A, streak: 0 };
  assert.ok(!C.calculateSettlement(st, { type: 'discard', winner: A, loser: A, tai: 1 }).ok);
  assert.ok(!C.calculateSettlement(st, { type: 'discard', winner: A, tai: 1 }).ok);
  assert.ok(!C.calculateSettlement(st, { type: 'discard', winner: A, loser: B, tai: -1 }).ok);
  assert.ok(!C.calculateSettlement(st, { type: 'selfDraw', tai: 1 }).ok);
  const g = C.createInitialGame();
  assert.strictEqual(C.reduce(g, { type: 'SETTLE', mode: 'discard', winner: A, loser: A, tai: 1 }), g);
  // 0 台：3 底
  assert.deepStrictEqual(C.calculateSettlement({ dealer: D, streak: 0 }, { type: 'discard', winner: A, loser: B, tai: 0 }).deltas, [3, -3, 0, 0]);
});

test('座位：豐當莊 → 豐東 詠南 美女西 Steven北', () => {
  assert.deepStrictEqual([0, 1, 2, 3].map(p => C.seatName(p, B)), ['北', '東', '南', '西']);
});

test('損毀資料：壞 JSON / 錯誤結構 不丟例外並回到可用狀態', () => {
  for (const t of ['{bad json', 'null', '"str"', '[]', '{"scores":"x","dealer":9}', '{"version":99,"scores":[1,2,3,-6],"dealer":2,"undoStack":[{"x":1}]}']) {
    const r = C.parseGameJSON(t);
    assert.ok(r.game && r.game.scores.length === 4 && C.isIdx(r.game.dealer), t);
  }
  const r = C.parseGameJSON('{"version":99,"scores":[1,2,3,-6],"dealer":2,"undoStack":[{"x":1}]}');
  assert.deepStrictEqual(r.game.scores, [1, 2, 3, -6]); assert.strictEqual(r.game.dealer, 2); assert.ok(r.repaired);
});

// ---------------- v2：可設定底／每台 ----------------
const R = { base: 50, perTai: 20 };
test('底50 每台20：閒胡閒 5 台 → 150', () => {
  const r = C.calculateSettlement({ dealer: D, streak: 0, ...R }, { type: 'discard', winner: A, loser: B, tai: 5 });
  assert.deepStrictEqual(r.deltas, [150, -150, 0, 0]);
});

test('底50 每台20：莊連二自摸 5 台 → 每家 50+10×20=250，莊 +750', () => {
  const r = C.calculateSettlement({ dealer: A, streak: 2, ...R }, { type: 'selfDraw', winner: A, tai: 5 });
  assert.deepStrictEqual(r.deltas, [750, -250, -250, -250]);
});

test('底50 每台20：閒自摸（莊連二）→ 莊付 250、其他 150', () => {
  const r = C.calculateSettlement({ dealer: A, streak: 2, ...R }, { type: 'selfDraw', winner: B, tai: 5 });
  assert.deepStrictEqual(r.deltas, [-250, 550, -150, -150]);
  assert.strictEqual(sum(r.deltas), 0);
});

test('底50 每台20：閒胡莊（連二）5 台 → 250', () => {
  const r = C.calculateSettlement({ dealer: A, streak: 2, ...R }, { type: 'discard', winner: B, loser: A, tai: 5 });
  assert.deepStrictEqual(r.deltas, [-250, 250, 0, 0]);
});

test('小數：底 0.5 每台 0.1，莊連1 自摸 2 台 → 每家 0.5+(2+3)×0.1=1，無浮點誤差', () => {
  const r = C.calculateSettlement({ dealer: A, streak: 1, base: 0.5, perTai: 0.1 }, { type: 'selfDraw', winner: A, tai: 2 });
  assert.deepStrictEqual(r.deltas, [3, -1, -1, -1]);
  const r2 = C.calculateSettlement({ dealer: A, streak: 0, base: 0.3, perTai: 0.1 }, { type: 'selfDraw', winner: B, tai: 1 });
  assert.deepStrictEqual(r2.deltas, [-0.5, 1.3, -0.4, -0.4]); // 莊付 0.3+2×0.1，閒付 0.3+0.1
  assert.strictEqual(C.formatSigned(1.3), '+1.3');
  assert.strictEqual(C.formatSigned(-0.5), '-0.5');
});

test('SET_RULES：驗證（底≥0、每台>0、最多 1 位小數）', () => {
  const g = C.createInitialGame();
  assert.strictEqual(g.base, 3); assert.strictEqual(g.perTai, 1);
  assert.strictEqual(C.reduce(g, { type: 'SET_RULES', base: 5, perTai: 0 }), g);
  assert.strictEqual(C.reduce(g, { type: 'SET_RULES', base: -1, perTai: 1 }), g);
  assert.strictEqual(C.reduce(g, { type: 'SET_RULES', base: 1.25, perTai: 1 }), g);
  assert.strictEqual(C.reduce(g, { type: 'SET_RULES', base: 'x', perTai: 1 }), g);
  assert.strictEqual(C.reduce(g, { type: 'SET_RULES', base: 3, perTai: 1 }), g); // 無變更
  const g2 = C.reduce(g, { type: 'SET_RULES', base: 0, perTai: 0.5 });
  assert.strictEqual(g2.base, 0); assert.strictEqual(g2.perTai, 0.5);
});

test('SET_RULES → 結算使用新值、歷史記錄當時底/台、Undo 恢復設定、Redo 再套用', () => {
  let g = C.createInitialGame(); // 莊 A 連0
  g = C.reduce(g, { type: 'SETTLE', mode: 'discard', winner: B, loser: Cc, tai: 5 }); // 3+5=8；莊換 B
  assert.deepStrictEqual(g.scores, [0, 8, -8, 0]);
  g = C.reduce(g, { type: 'SET_RULES', base: 50, perTai: 20 });
  assert.strictEqual(g.history[g.history.length - 1].kind, 'rules');
  assert.deepStrictEqual(g.scores, [0, 8, -8, 0]); // 不重算過去
  g = C.reduce(g, { type: 'SETTLE', mode: 'discard', winner: A, loser: D, tai: 5 }); // 閒胡閒 → 150
  assert.deepStrictEqual(g.scores, [150, 8, -8, -150]);
  const settles = g.history.filter(e => e.kind === 'settle');
  assert.deepStrictEqual(settles.map(e => [e.base, e.perTai]), [[3, 1], [50, 20]]);
  g = C.reduce(g, { type: 'UNDO' }); // 回到設定後
  assert.strictEqual(g.base, 50);
  g = C.reduce(g, { type: 'UNDO' }); // 撤銷設定
  assert.strictEqual(g.base, 3); assert.strictEqual(g.perTai, 1);
  assert.deepStrictEqual(g.scores, [0, 8, -8, 0]);
  assert.strictEqual(g.history.length, 1);
  g = C.reduce(g, { type: 'REDO' });
  assert.strictEqual(g.base, 50); assert.strictEqual(g.perTai, 20);
  // 存取後保留
  const re = C.parseGameJSON(JSON.stringify(g));
  assert.strictEqual(re.repaired, false);
  assert.deepStrictEqual(re.game, g);
  assert.strictEqual(re.game.version, 2);
});

test('v1 → v2 遷移：補 base=3/perTai=1（狀態、歷史、undo 快照），Undo 仍可用', () => {
  const v1 = {
    version: 1, names: ['Steven', '豐', '詠', '美女'], scores: [13, -13, 0, 0], dealer: 1, streak: 0, round: 2, seq: 1,
    history: [{ id: 1, kind: 'settle', round: 1, mode: 'discard', dealer: 0, streak: 0, winner: 0, loser: 1, tai: 4, bonusTai: 1, deltas: [8, -8, 0, 0], scoresAfter: [8, -8, 0, 0], ts: 1 }],
    undoStack: [{ label: '第 1 局結算', before: { scores: [5, -5, 0, 0], dealer: 0, streak: 0, round: 1 }, after: { scores: [13, -13, 0, 0], dealer: 1, streak: 0, round: 2 }, entry: { id: 1, kind: 'settle', round: 1 } }],
    redoStack: []
  };
  const r = C.parseGameJSON(JSON.stringify(v1));
  assert.strictEqual(r.repaired, false);
  const g = r.game;
  assert.strictEqual(g.version, 2); assert.strictEqual(g.base, 3); assert.strictEqual(g.perTai, 1);
  assert.deepStrictEqual(g.scores, [13, -13, 0, 0]);
  assert.strictEqual(g.history[0].base, 3); assert.strictEqual(g.history[0].perTai, 1);
  assert.strictEqual(g.undoStack.length, 1);
  assert.strictEqual(g.undoStack[0].before.base, 3);
  const u = C.reduce(g, { type: 'UNDO' });
  assert.deepStrictEqual(u.scores, [5, -5, 0, 0]); assert.strictEqual(u.dealer, 0); assert.strictEqual(u.base, 3);
  // 遷移後算錢與 v1 相同
  assert.deepStrictEqual(C.calculateSettlement(g, { type: 'selfDraw', winner: 2, tai: 5 }).deltas, [-8, -9, 25, -8]); // 莊=豐 連0
});

test('損毀 base/perTai → 回到 3/1，不丟例外', () => {
  for (const t of ['{"version":2,"base":"abc","perTai":0}', '{"version":2,"base":-5,"perTai":null}', '{"version":2,"base":1e99,"perTai":2}']) {
    const r = C.parseGameJSON(t);
    assert.strictEqual(r.game.base, 3); assert.strictEqual(r.game.perTai, 1); assert.ok(r.repaired, t);
  }
});

const failed = results.filter(r => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
