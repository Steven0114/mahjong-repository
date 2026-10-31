# 🀄 台灣麻將計分器（16 張）

四人現場記帳用的 iPhone Safari Web App。純靜態（HTML + CSS + JS），不需登入、後端或 build，所有資料存在瀏覽器 `localStorage`。

## 計分規則

- **底與每台金額可設定**（預設 3 底 1 台）。每筆付款：

  ```
  付款 = 底 + (牌型台數 + 莊家相關台數〔莊家有參與時〕) × 每台
  ```

  例：50 底 20 台，閒胡閒 5 台 = 50 + 5×20 = 150；莊家連二（+5 台）自摸 5 台，每家付 50 + 10×20 = 250，莊家 +750。
- 點標題列的「X 底・Y 台／修改」可修改：底 ≥ 0、每台 > 0，整數或 1 位小數。牌局進行中修改會先確認；**過去的局不重算**，只影響之後的結算，可用「復原上一步」還原。每筆歷史紀錄都會記下當時的底／台。
- **莊 1、連 N、拉 N**：只要付款的任一方是莊家，加上莊家相關台數 `1 + 2N`（N = 連莊數）。莊家贏或莊家付都要加。
- **自摸逐家計算**：莊家那一份可能不同（閒家自摸時莊家多付；莊家自摸時三家都加）。
- **連莊**：莊家胡牌／自摸 → 繼續坐莊，N + 1。
- **流局**：無人輸贏，莊家連莊 N + 1（常見台灣家規）。
- **下莊**：閒家胡牌 → 下一位（依原始順序）當莊，N 歸零，東南西北重排。

## 功能

- 2×2 計分板（名字、東南西北、莊家標示、累積輸贏、零和警告）
- 放槍／自摸／流局、胡牌者、放槍者、台數 −/+ 與直接輸入（聚焦自動全選）
- 結算前即時預覽每人金額與下局莊家，按「確認結算」才入帳
- 手動連莊 −/+、更換莊家
- 手動分數修正：「設定總分」與「加減調整」兩種模式（± 按鈕輸入負數），套用前確認
- 歷史紀錄、多步復原（Undo）與重做（Redo，各上限 200 步）
- 匯出／備份：把目前分數與全部歷史複製成文字
- 可編輯玩家名稱（預設 Steven、豐、詠、美女）
- 重開一桌（需確認；清除前另存一份到 `mahjongCounter.game.v1.lastReset`）
- 深色模式、Safe Area（Dynamic Island / Home Indicator）、PWA（加入主畫面）
- 螢幕常亮（支援 Wake Lock 的瀏覽器，iOS 16.4+）
- 資料含 `version`（目前 v2；v1 舊資料自動遷移為 3 底 1 台），所有 JSON 解析皆 try/catch；損毀資料會自動修復並另存備份，不會白屏

## 檔案

| 檔案 | 說明 |
| --- | --- |
| `index.html` | 頁面結構、PWA meta |
| `styles.css` | 版面、深色模式、Safe Area |
| `core.js` | 純計算核心：`calculateSettlement`、`nextDealerState`、`seatOrder`、`reduce`（含 undo/redo）、資料遷移。瀏覽器為 `window.MahjongCore`，Node 可 `require` |
| `app.js` | UI 與 localStorage |
| `manifest.json`、`icon-192.png`、`icon-512.png`、`apple-touch-icon.png` | PWA 與圖示 |
| `tests/core.test.js` | 計算核心測試（規格 Case 1–10、流局、多步 Undo/Redo、可設定底／台、v1→v2 遷移等） |
| `tests/e2e.js` | Playwright 瀏覽器測試（iPhone 14 模擬） |

所有路徑皆為相對路徑，可部署在 GitHub Pages 子路徑（例如 `https://<user>.github.io/mahjong-counter/`）。

## 測試

```bash
node tests/core.test.js

# 瀏覽器測試（需先安裝 playwright 與 chromium，勿提交 node_modules）
python3 -m http.server 8000 &
NODE_PATH=/path/to/node_modules node tests/e2e.js http://127.0.0.1:8000/ ./shots
```

## 部署到 GitHub Pages

1. 推送到 GitHub repository `mahjong-counter` 的 `main` branch
2. Settings → Pages → Source：Deploy from a branch → `main` / `(root)`
3. 等待部署完成後開啟 `https://<user>.github.io/mahjong-counter/`

## 加入 iPhone 主畫面

1. 用 **Safari** 開啟網址
2. 點下方「分享」按鈕
3. 選「加入主畫面」→「加入」
4. 從主畫面圖示開啟即為全螢幕 App；資料存在該 App 的儲存空間

> 注意：iOS 上「Safari 分頁」與「主畫面 App」的 localStorage 是分開的。請固定用同一個入口記帳，或用「匯出／備份」轉移紀錄。
