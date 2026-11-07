# Ollie Physics Lab

滑板 Ollie 物理實驗室：three.js 畫面 + cannon-es 剛體物理 + IK 人物。
有兩種模式：**練習場**（185 m 直線、24 個障礙）和**自由滑**（60 × 60 m 滑板公園、16 個道具，可以自由轉向）。

```bash
npm install
npm run dev        # http://localhost:5180 （練習場）、http://localhost:5180/?mode=park （自由滑）
npm run build      # 輸出單一檔案 dist/index.html
npm run sim:park   # 無畫面的公園物理檢查（推、煞車、轉向、每個道具、招式、圍牆）
```

## 部署

公開網址（不用登入）：**https://ethan628.github.io/ollie-lab/** （自由滑：網址後面加 `#park`）

```bash
npm run deploy   # 打包並推到 gh-pages 分支，GitHub Pages 約一分鐘內更新
```

另外也發布在 claude.ai：https://claude.ai/artifact/AwXxSWEpsWSV2fFdH4pLKf

```bash
npm run build:artifact   # 輸出 dist-artifact/index.html：只含網站程式，three.js 和 cannon-es 從 jsDelivr 載入
```

再把 `dist-artifact/index.html` 發布到同一個 artifact 就能更新。

根目錄的 `index.html` 是原始碼入口，直接雙擊打開只會看到沒有樣式的文字。
要不開伺服器直接玩，請先 `npm run build`，再雙擊 `dist/index.html`（所有 JS/CSS 都已內嵌；切到自由滑會在網址加上 `?mode=park`）。

- `src/mode.ts`：讀網址的 `?mode=park`，決定要建練習場還是公園
- `src/course.ts`：道具資料格式和練習場的障礙（位置、高度、建議起跳區）
- `src/park.ts`：公園的道具配置（中心、角度、尺寸），以及座標換算、最近道具
- `src/physics.ts`：物理世界、道具碰撞體、板子剛體、Ollie 狀態機；公園模式的推、煞車、轉向和側向抓地
- `src/scene.ts`：場景、地面、道具與板子模型、亮/暗色主題
- `src/rider.ts`：程序生成人物、兩段式 IK 腿、摔車動畫（跟著板子的方向轉）
- `src/joystick.ts`：左下角虛擬搖桿
- `src/main.ts`：相機（練習場側面跟拍、公園追尾）、按鍵、施力箭頭、UI、主迴圈
- `tools/park-sim.ts`：公園的無畫面檢查

## 練習場

場地長 185 m，共 24 個障礙：路緣、花台、角錐、欄杆、木箱、護欄、跳台、Funbox。板子會自動往前推。
地上的綠色區塊是建議起跳區，是用物理模擬掃描「在哪個距離 Ollie 並按住帶平能過去」算出來的。
網址後面加 `?at=距離`，可以從指定位置開始，例如 `?at=145` 直接練高護欄。

| 動作 | 鍵盤 | 手機 / 滑鼠 |
|---|---|---|
| Ollie | 空白鍵 | 按 OLLIE |
| 帶平 / 接板 | 按住空白、↑ 或 W | 按住 OLLIE |
| Kickflip | 按住 ← / A | 按住 Kickflip 按鈕 |
| Heelflip | 按住 → / D | 按住 Heelflip 按鈕 |
| Shove-it | 按住 ↓ / S | 按住 Shove-it 按鈕 |

## 自由滑（滑板公園）

按工具列的「自由滑」切換，或直接開 `?mode=park`。板子不會自己走，要推。

道具：兩座 U 台（quarter pipe，可以衝上去再滑下來）、四階樓梯（從後面斜坡上去、從平台跳下樓梯，旁邊有扶手）、
斜坡平台（上坡後平台盡頭是落差）、Funbox、兩座跳台、Manual 台、花崗岩台、高低欄杆、木箱、護欄、花台、角錐。
四周有矮牆，撞牆會摔；滑出場外會回到中央。網址加 `&prop=編號` 可以直接站在某個道具前面練習（編號照 `src/park.ts` 的順序，從 0 開始）。

| 動作 | 鍵盤 | 手機 / 滑鼠 |
|---|---|---|
| 轉向 | ← → 或 A D | 搖桿左右 |
| 推 / 煞車 | ↑ / ↓ 或 W / S | 搖桿往上 / 往下 |
| Ollie | 空白鍵 | 按 OLLIE |
| 帶平 / 接板 | 按住空白 | 按住 OLLIE |
| Kickflip / Heelflip / Shove-it | 按住 Z / X / C | 按住招式按鈕 |

轉向像真的板橋：速度越快轉得越快，輪子不會側滑。起跳時腳會停止轉向；落地看的是板子相對前進方向歪了多少，在斜坡、U 台上則量板子和地面的夾角。

## 招式

在地上按招式鍵，會同時 Ollie 加出招；在空中按，就只出招。按住不放就會帶平和接板，一放開就接不到。

招式是物理轉動：板子離地後給它繞長軸（翻板）或繞法線（Shove-it）的角速度，鞋子會先抬起來，讓板子在腳下轉。
板子轉開又轉回來接近正的時候，按住帶平鍵，腳就會把板子接住。沒接住、板子翻面或歪著落地都會摔車。

滑桿可以調整彈板力道和前腳帶平；另有慢動作、施力箭頭、回到起點（公園是「回到中央」）、模式切換按鈕。
