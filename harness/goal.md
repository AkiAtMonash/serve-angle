# ゴール：お手本の追加を、撮影の邪魔をしない形にする

対象リポジトリ: `C:\Users\knak3\Desktop\PJ_serve-angle`（ブランチ `feat/court-angle-picker`）

## 前提（もう決まっていること・変えない）

- お手本の追加は**スマホだけで完結**する。`estimate.js` で端末内の骨格推定、`clips.js` の IndexedDB `refs` に動画ごと保存。PC もサーバーも使わない。
- 角度は `azimuth`（45/90/135/180/225/270/315）で持つ。保存時に 7 方位から選ばせ、ホームのその角度に並べる。
- ホームは案C（コートを上から見て目のアイコンで角度を選ぶ）。設定欄は無い。

## 今回やること（この4つだけ）

1. **録画中は推定を止める**
   - `estimate.js` の待ち判定 `hidden` を `paused` に改名する。意味は「今は進めない」。挙動は変えない（待って、戻ったら同じコマから続ける）。
   - `app.js` で `poseFrames(...)` に `paused: () => document.hidden || rec !== null` を渡す（`rec` は録画中の状態。録画中でなければ `null`）。
   - `onWait` の文面は「画面を消したか録画中なので待っている。戻ると続きから進む」に変える。
2. **推定が終わっても画面を勝手に切り替えない**
   - いまは終わると `openConfirm(...)` が `show("confirm")` まで進めてしまう。終わったら結果を変数に置くだけにして、ホームの `#addStatus` に「お手本の準備ができたのだ（押して確認）」を出す。
   - `#addStatus` を押す（またはタップする）と `openConfirm(置いた結果)` を呼ぶ。押すまで画面は動かさない。
3. **保存時に角度を選ばせ、端末内に残す**
   - 既存の `askAngle(addAz)` をそのまま使う（新しく作らない）。
   - 保存は `putRef({ ...r, azimuth }, cf.blob)`。`r` は `reference(cf.doc, cf.serves[cf.sel], {...})`。保存後は `refs` に積んで `pick = { az: azimuth, ref: entry }`、`renderEyes(); renderSheet();`。
   - これは**もう入っている**。動いているか確認して、壊れていたら直す。
4. **確認画面から戻る道を壊さない**
   - 確認画面を閉じたら、ホームに戻って `#addStatus` の案内が消えること。

## 触ってよいファイル

`app.js`、`estimate.js`、`test/estimate.test.mjs`。これ以外に変更が必要になったら、手を止めて理由を報告する。

## 受け入れ条件（`node harness/check.mjs` が全部 PASS）

1. 競合マーカー（`<<<<<<<` / `=======` / `>>>>>>>`）がどのファイルにも残っていない。
2. `git diff --check` が無音。
3. `npm test` が全件通る。とくに `test/estimate.test.mjs` の新しいテスト「waits while paused, then carries on from the same frame」が通る。
4. `app.js` の `poseFrames(` の呼び出しに `paused:` が入っていて、録画中の状態（`rec`）を見ている。
5. 推定が終わった時点で `show("confirm")` が呼ばれない（`openConfirm` は押されたときだけ）。

## やらないこと

- Web Worker 化（推定を別スレッドへ移す）。
- PC 経由の追加フロー（`uploadRef` / `watchRefs` / `pendingRefs`）の復活。消したままにする。
- 角度ピッカー（`#anglePick` / `askAngle`）の作り直し。既存のものを使う。
- `server.mjs`、`refs.json`、`refs_user.json` の変更。
- 画面の見た目・文言の変更（上の `#addStatus` の案内を除く）。
- 新しい依存パッケージ。

## 止まる条件（実装を止めて報告する）

- 指示とコードが食い違って、どちらを残すか自分で決められない。
- テストが、指示と関係ない理由で落ちる。
- 上の「触ってよいファイル」の外に変更が必要になった。
- 同じテストを2回直しても通らない（3回目はやらない）。

## 報告の形

1. 変えたファイルと、それぞれ何をしたか（1行ずつ）。
2. `node harness/check.mjs` の出力。
3. 判断に迷った点、指示から外れた点（あれば）。
