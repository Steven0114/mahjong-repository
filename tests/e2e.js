// 瀏覽器端煙霧測試（iPhone 14 模擬）
// 需要 playwright：NODE_PATH=<含 playwright 的 node_modules> node tests/e2e.js [baseURL] [screenshotDir]
'use strict';
const { chromium, devices } = require('playwright');
const assert = require('assert');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/mahjong-counter/';
const SHOTS = process.argv[3] || '/workspace/mahjong-counter-shots';
const fs = require('fs'); fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
async function step(name, fn) {
  try { await fn(); results.push([name, true]); console.log('PASS', name); }
  catch (e) { results.push([name, false]); console.log('FAIL', name, '\n   ', e && e.message); }
}

(async () => {
  const browser = await chromium.launch();
  const dev = devices['iPhone 14'];
  const errors = [];
  const ctx = await browser.newContext({ ...dev, colorScheme: 'light' });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => errors.push('requestfailed: ' + r.url()));
  page.on('response', r => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url()); });

  const scores = async () => page.$$eval('#board .pscore', els => els.map(e => e.textContent.trim()));
  const click = sel => page.locator(sel).first().click();
  const pick = (kind, i) => click(`#${kind}Btns [data-i="${i}"]`);
  // 確保為選取狀態（按鈕為切換式）
  const ensure = async (kind, i) => {
    const on = await page.locator(`#${kind}Btns [data-i="${i}"]`).evaluate(e => e.classList.contains('on'));
    if (!on) await pick(kind, i);
  };

  await step('載入頁面（子路徑）、零 console error、資源 200', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    assert.strictEqual(await page.textContent('#roundLabel'), '第 1 局');
    assert.deepStrictEqual(await scores(), ['0', '0', '0', '0']);
    for (const f of ['manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'core.js', 'app.js', 'styles.css']) {
      const r = await page.request.get(new URL(f, BASE).href);
      assert.strictEqual(r.status(), 200, f);
    }
    const vw = await page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth]);
    assert.ok(vw[1] <= vw[0], 'no horizontal overflow ' + vw);
    assert.deepStrictEqual(errors, []);
  });

  await step('選擇莊家：豐 → 豐東 詠南 美女西 Steven北', async () => {
    await page.locator('#dealerPanel > summary').click();
    await pick('dealer', 1);
    const seats = await page.$$eval('#board .pseat', els => els.map(e => e.textContent));
    assert.deepStrictEqual(seats, ['北', '東・莊', '南', '西']);
    assert.match(await page.textContent('#dealerLine'), /豐｜東｜莊/);
    // 用 + 把連莊調到 2
    await click('[data-action="streak-inc"]'); await click('[data-action="streak-inc"]');
    assert.strictEqual(await page.textContent('#streakValue'), '連 2 拉 2');
    assert.strictEqual(await page.textContent('#bonusLine'), '莊家相關 +5 台');
    await page.locator('#dealerPanel > summary').click();
  });

  await step('放槍：Steven 胡 豐(莊 連2) 5 台 → Steven +13 豐 -13，換莊給詠', async () => {
    await click('[data-action="mode"][data-value="discard"]');
    await pick('winner', 0); await pick('loser', 1);
    // 台數：直接輸入 + 按鈕
    await page.fill('#taiInput', '4'); await click('[data-action="tai-inc"]');
    assert.strictEqual(await page.inputValue('#taiInput'), '5');
    const pv = await page.textContent('#preview');
    assert.ok(pv.includes('+13') && pv.includes('-13'), pv);
    await page.screenshot({ path: SHOTS + '/light-preview.png' });
    await click('#settleBtn');
    assert.deepStrictEqual(await scores(), ['+13', '-13', '0', '0']);
    assert.strictEqual(await page.textContent('#roundLabel'), '第 2 局');
    assert.match(await page.textContent('#dealerLine'), /詠｜東｜莊/);
    assert.ok((await page.textContent('#streakValue')).includes('連 0 拉 0'));
  });

  await step('自摸：美女 自摸 3 台（莊詠 連0）→ 詠 -7、其他 -6、美女 +19', async () => {
    await click('[data-action="mode"][data-value="selfDraw"]');
    assert.ok(await page.locator('#loserBlock').isHidden());
    await pick('winner', 3);
    await page.fill('#taiInput', '3');
    await click('#settleBtn');
    assert.deepStrictEqual(await scores(), ['+7', '-19', '-7', '+19']);
    assert.match(await page.textContent('#dealerLine'), /美女｜東｜莊/);
  });

  await step('Undo 自摸 → 分數、莊家、局數恢復；Redo 再 Undo', async () => {
    await click('#undoBtn');
    assert.deepStrictEqual(await scores(), ['+13', '-13', '0', '0']);
    assert.match(await page.textContent('#dealerLine'), /詠｜東｜莊/);
    assert.strictEqual(await page.textContent('#roundLabel'), '第 2 局');
    await click('#redoBtn');
    assert.deepStrictEqual(await scores(), ['+7', '-19', '-7', '+19']);
    await click('#undoBtn');
    assert.deepStrictEqual(await scores(), ['+13', '-13', '0', '0']);
  });

  await step('流局：預覽文字、莊家連莊、分數不變', async () => {
    await click('[data-action="mode"][data-value="draw"]');
    assert.ok((await page.textContent('#preview')).includes('流局：莊家連莊，下局 連1 拉1'));
    await click('#settleBtn');
    assert.deepStrictEqual(await scores(), ['+13', '-13', '0', '0']);
    assert.strictEqual(await page.textContent('#streakValue'), '連 1 拉 1');
    await click('#undoBtn');
    assert.ok((await page.textContent('#streakValue')).includes('連 0 拉 0'));
  });

  await step('手動設定總分 +28/-12/+5/-21（含 ± 按鈕），確認視窗', async () => {
    await page.locator('#fixPanel > summary').click();
    await click('[data-action="fix-mode"][data-value="set"]');
    await page.fill('#fix-0', '28');
    await page.fill('#fix-1', '12'); await click('[data-action="fix-sign"][data-i="1"]');
    await page.fill('#fix-2', '+5');
    await page.fill('#fix-3', '-21');
    assert.match(await page.textContent('#fixSum'), /0 ✓/);
    await click('#fixApply');
    assert.ok(await page.locator('#modal').isVisible());
    await click('#modalOk');
    assert.deepStrictEqual(await scores(), ['+28', '-12', '+5', '-21']);
    assert.ok(await page.locator('#sumWarning').isHidden());
  });

  await step('Reload 後分數、莊家、局數完全保留', async () => {
    const before = [await scores(), await page.textContent('#dealerLine'), await page.textContent('#roundLabel')];
    await page.reload({ waitUntil: 'networkidle' });
    const after = [await scores(), await page.textContent('#dealerLine'), await page.textContent('#roundLabel')];
    assert.deepStrictEqual(after, before);
    assert.deepStrictEqual(after[0], ['+28', '-12', '+5', '-21']);
  });

  await step('非零和警告', async () => {
    await page.locator('#fixPanel').evaluate(d => { d.open = true; });
    await click('[data-action="fix-mode"][data-value="adjust"]');
    await page.fill('#fix-0', '3');
    await click('#fixApply'); await click('#modalOk');
    assert.ok((await page.textContent('#sumWarning')).includes('四人總分目前為 +3，並非 0'));
    await click('#undoBtn');
    assert.ok(await page.locator('#sumWarning').isHidden());
    await page.locator('#fixPanel > summary').click();
  });

  await step('截圖（淺色）', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.locator('#historyPanel').evaluate(d => { d.open = true; });
    await click('[data-action="mode"][data-value="selfDraw"]'); await pick('winner', 0); await page.fill('#taiInput', '5');
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
    await page.waitForTimeout(5200); // 等 toast 消失
    await page.screenshot({ path: SHOTS + '/light-main.png' });
    await page.screenshot({ path: SHOTS + '/light-full.png', fullPage: true });
  });

  await step('匯出：顯示文字（剪貼簿或 fallback）', async () => {
    await page.locator('#exportPanel > summary').click();
    await click('[data-action="export"]');
    const t = await page.inputValue('#exportText');
    assert.ok(t.includes('【目前總分】') && t.includes('Steven（') && t.includes('【歷史紀錄】'), t);
    await page.waitForFunction(() => /複製/.test(document.getElementById('toastText').textContent), null, { timeout: 3000 });
  });

  await step('重開一桌需確認（取消不清除）', async () => {
    await page.locator('#resetPanel > summary').click();
    await click('[data-action="reset"]');
    assert.match(await page.textContent('#modalTitle'), /確定要清除目前牌局嗎/);
    await click('[data-action="modal-cancel"]');
    assert.deepStrictEqual(await scores(), ['+28', '-12', '+5', '-21']);
  });

  await step('修改底／每台：50 底 20 台 → 確認 → 結算 150 → reload 保留 → undo', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.strictEqual(await page.textContent('#rulesLabel'), '3 底・1 台');
    await click('#rulesBtn');
    assert.ok(await page.locator('#rulesModal').isVisible());
    assert.strictEqual(await page.inputValue('#rulesBase'), '3');
    // 無效值：每台 0 → 不能套用
    await page.fill('#rulesPerTai', '0');
    assert.ok(await page.locator('#rulesApply').isDisabled());
    await page.fill('#rulesPerTai', '1.25');
    assert.ok(await page.locator('#rulesApply').isDisabled());
    // stepper + 直接輸入
    await page.fill('#rulesPerTai', '19');
    await click('[data-action="rules-step"][data-field="perTai"][data-d="1"]');
    assert.strictEqual(await page.inputValue('#rulesPerTai'), '20');
    await page.fill('#rulesBase', '49');
    await click('[data-action="rules-step"][data-field="base"][data-d="1"]');
    assert.strictEqual(await page.inputValue('#rulesBase'), '50');
    assert.ok((await page.textContent('#rulesPreview')).includes('150'));
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.screenshot({ path: SHOTS + '/light-rules-editor.png' });
    await click('#rulesApply');
    // 牌局進行中 → 需確認
    assert.ok(await page.locator('#modal').isVisible());
    assert.match(await page.textContent('#modalBody'), /過去的局不會重新計算/);
    await click('#modalOk');
    assert.strictEqual(await page.textContent('#rulesLabel'), '50 底・20 台');
    // 莊家 = 詠（連0）；Steven 胡 豐（閒胡閒）5 台 → 50 + 5×20 = 150
    await click('[data-action="mode"][data-value="discard"]');
    await ensure('winner', 0); await ensure('loser', 1);
    await page.fill('#taiInput', '5');
    assert.ok((await page.textContent('#preview')).includes('+150'));
    await click('#settleBtn');
    assert.deepStrictEqual(await scores(), ['+178', '-162', '+5', '-21']);
    // 閒胡 → 莊家換成美女（連0）。詠 自摸 2 台 → 莊 美女付 50+(2+1)×20=110，其他 50+2×20=90
    assert.match(await page.textContent('#dealerLine'), /美女｜東｜莊/);
    await click('[data-action="mode"][data-value="selfDraw"]');
    await ensure('winner', 2); await page.fill('#taiInput', '2');
    const pv = await page.textContent('#preview');
    assert.ok(pv.includes('-110') && pv.includes('-90') && pv.includes('+290'), pv);
    assert.ok((await page.textContent('#bonusLine')).includes('莊家相關 +1 台'));
    await click('[data-action="mode"][data-value="discard"]'); await pick('winner', 3);
    await page.reload({ waitUntil: 'networkidle' });
    assert.strictEqual(await page.textContent('#rulesLabel'), '50 底・20 台');
    assert.deepStrictEqual(await scores(), ['+178', '-162', '+5', '-21']);
    await page.locator('#historyPanel').evaluate(d => { d.open = true; });
    const hist = await page.textContent('#historyList');
    assert.ok(hist.includes('50 底・20 台') && hist.includes('修改底／每台') && hist.includes('3 底・1 台 → 50 底・20 台'), hist);
    // Undo 結算、Undo 設定 → 回 3 底 1 台
    await click('#undoBtn'); await click('#undoBtn');
    assert.strictEqual(await page.textContent('#rulesLabel'), '3 底・1 台');
    assert.deepStrictEqual(await scores(), ['+28', '-12', '+5', '-21']);
    await click('#redoBtn');
    assert.strictEqual(await page.textContent('#rulesLabel'), '50 底・20 台');
    await page.reload({ waitUntil: 'networkidle' });
    assert.strictEqual(await page.textContent('#rulesLabel'), '50 底・20 台');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(5200);
    await page.screenshot({ path: SHOTS + '/light-rules-50-20.png' });
  });

  await step('v1 舊資料載入 → 遷移為 v2（3 底 1 台），不白屏', async () => {
    const c4 = await browser.newContext({ ...dev });
    const p4 = await c4.newPage();
    const errs4 = [];
    p4.on('pageerror', e => errs4.push(e.message));
    p4.on('console', m => { if (m.type() === 'error') errs4.push(m.text()); });
    await p4.goto(new URL('manifest.json', BASE).href);
    await p4.evaluate(() => localStorage.setItem('mahjongCounter.game.v1', JSON.stringify({
      version: 1, names: ['Steven', '豐', '詠', '美女'], scores: [28, -12, 5, -21], dealer: 2, streak: 1, round: 5, seq: 0,
      history: [], undoStack: [], redoStack: []
    })));
    await p4.goto(BASE, { waitUntil: 'networkidle' });
    assert.strictEqual(await p4.textContent('#rulesLabel'), '3 底・1 台');
    assert.deepStrictEqual(await p4.$$eval('#board .pscore', e => e.map(x => x.textContent)), ['+28', '-12', '+5', '-21']);
    const v = await p4.evaluate(() => JSON.parse(localStorage.getItem('mahjongCounter.game.v1')));
    assert.strictEqual(v.version, 2); assert.strictEqual(v.base, 3); assert.strictEqual(v.perTai, 1);
    assert.ok(await p4.locator('#toast').isHidden(), 'v1 遷移不應顯示損毀提示');
    assert.deepStrictEqual(errs4, []);
    await c4.close();
  });

  await step('整體 console error 為零', async () => { assert.deepStrictEqual(errors, []); });

  // ---- 損毀資料 ----
  await step('損毀 localStorage JSON → 不白屏、可操作', async () => {
    const c2 = await browser.newContext({ ...dev });
    const p2 = await c2.newPage();
    const errs2 = [];
    p2.on('pageerror', e => errs2.push(e.message));
    p2.on('console', m => { if (m.type() === 'error') errs2.push(m.text()); });
    // 在不執行 app 的同源頁面寫入資料，避免 app 的 pagehide 儲存覆蓋
    await p2.goto(new URL('manifest.json', BASE).href);
    await p2.evaluate(() => {
      localStorage.setItem('mahjongCounter.game.v1', '{"version":1,"scores":[1,2,');
      localStorage.setItem('mahjongCounter.ui.v1', 'not json');
    });
    await p2.goto(BASE, { waitUntil: 'networkidle' });
    assert.strictEqual(await p2.locator('#board .pcard').count(), 4);
    assert.ok(await p2.locator('#settleBtn').isVisible());
    await p2.waitForFunction(() => document.getElementById('toastText').textContent.includes('已自動修復'), null, { timeout: 3000 });
    assert.ok(await p2.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('mahjongCounter.game.v1.corrupt.'))));
    await p2.screenshot({ path: SHOTS + '/corrupt-recovered.png' });
    // 結構錯誤的 JSON
    await p2.goto(new URL('manifest.json', BASE).href);
    await p2.evaluate(() => localStorage.setItem('mahjongCounter.game.v1', '{"version":7,"scores":"x","dealer":42,"history":"bad","undoStack":[1,2]}'));
    await p2.goto(BASE, { waitUntil: 'networkidle' });
    assert.strictEqual(await p2.locator('#board .pcard').count(), 4);
    await p2.locator('#winnerBtns [data-i="2"]').click();
    await p2.locator('[data-action="mode"][data-value="selfDraw"]').click();
    await p2.locator('#settleBtn').click();
    assert.deepStrictEqual(await p2.$$eval('#board .pscore', e => e.map(x => x.textContent)), ['-4', '-3', '+10', '-3']);
    assert.deepStrictEqual(errs2, []);
    await c2.close();
  });

  // ---- 深色模式 ----
  await step('深色模式：背景深、文字淺、對比足夠', async () => {
    const c3 = await browser.newContext({ ...dev, colorScheme: 'dark' });
    const p3 = await c3.newPage();
    await p3.goto(BASE, { waitUntil: 'networkidle' });
    const seed = await p3.evaluate(() => JSON.stringify(Object.assign(MahjongCore.createInitialGame(), { scores: [28, -12, 5, -21], dealer: 0, streak: 2, round: 8 })));
    await p3.goto(new URL('manifest.json', BASE).href);
    await p3.evaluate(v => localStorage.setItem('mahjongCounter.game.v1', v), seed);
    await p3.goto(BASE, { waitUntil: 'networkidle' });
    const ratio = await p3.evaluate(() => {
      function rgb(s) { return s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number); }
      function lum(c) { const a = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; }
      function cr(f, b) { const L1 = lum(rgb(f)), L2 = lum(rgb(b)); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); }
      const out = {};
      const bodyBg = getComputedStyle(document.body).backgroundColor;
      out.bodyLum = lum(rgb(bodyBg));
      const card = document.querySelector('.pcard');
      const cardBg = getComputedStyle(card).backgroundColor;
      out.name = cr(getComputedStyle(card.querySelector('.pname')).color, cardBg);
      out.pos = cr(getComputedStyle(document.querySelector('.pscore.pos')).color, cardBg);
      out.neg = cr(getComputedStyle(document.querySelector('.pscore.neg')).color, cardBg);
      const btn = document.querySelector('.seg-btn');
      out.btn = cr(getComputedStyle(btn).color, getComputedStyle(btn).backgroundColor);
      return out;
    });
    console.log('    dark contrast', JSON.stringify(ratio));
    assert.ok(ratio.bodyLum < 0.05, 'dark background');
    for (const k of ['name', 'pos', 'neg', 'btn']) assert.ok(ratio[k] >= 4.5, k + ' contrast ' + ratio[k]);
    await p3.locator('#winnerBtns [data-i="1"]').click();
    await p3.locator('#loserBtns [data-i="0"]').click();
    await p3.fill('#taiInput', '5');
    await p3.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
    await p3.screenshot({ path: SHOTS + '/dark-main.png' });
    await p3.screenshot({ path: SHOTS + '/dark-full.png', fullPage: true });
    assert.ok((await p3.textContent('#preview')).includes('+13'));
    await c3.close();
  });

  await browser.close();
  const failed = results.filter(r => !r[1]).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
