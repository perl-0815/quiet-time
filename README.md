# 余白

広告ゲームを遊ばずに過ごした時間を表示する、小さな PWA です。Google Material Symbols のメニューから、カレンダー・ダークモード・リセットを使えます。

## ローカル起動

Node.js 22.13 以上、pnpm 10 を使用します。

```sh
pnpm install
pnpm dev
```

http://localhost:3000 を開きます。pnpm がない場合は `npm install -g pnpm@10` で導入できます。

## ビルドと PWA の確認

```sh
pnpm build
pnpm start
```

`out/` に静的ファイルと Service Worker を生成します。`pnpm start` は、このファイルをローカルの http://localhost:3000 で配信します。アプリのバックエンドはありません。

Service Worker は本番ビルドでのみ登録します。開発中の古いファイルのキャッシュを避けるため、`pnpm dev` では登録しません。PWA 確認時は開発用と別のポートかブラウザプロファイルを使ってください。例: `pnpm exec serve out -l 4173`。

一度オンラインで開き、Service Worker のインストールが完了した後は、オフラインで再度開いても計測とリセットができます。画面、JavaScript、CSS、アイコンを同じビルド単位でキャッシュします。更新はオンラインで取得され、旧バージョンを使う画面をすべて閉じた後に有効になります。

## ホーム画面への追加

- iPhone / iPad: Safari の共有メニューから「ホーム画面に追加」。
- Android: Chrome のメニューから「ホーム画面に追加」または「アプリをインストール」。

追加後は独立したウィンドウで開きます。公開時は HTTPS が必要です。localhost では HTTP でも PWA を検証できます。

## 記録の仕組み

- 初回表示時に `startedAt = Date.now()` を localStorage の記録に保存します。
- 1 秒ごとに `Math.max(0, Date.now() - startedAt)` から日・時・分・秒を表示します。アプリを閉じている間に処理を動かす必要はありません。
- 開始日時は端末のローカルタイムゾーンで表示します。
- リセットは確認後に実行します。その時点の経過時間が `longestRecord`（ミリ秒）を上回る場合に更新し、開始日時を現在にします。最長記録は完了した記録のみを対象とします。
- 別タブでのリセット、画面復帰時の日時の再取得に対応します。
- 保存できない場合は画面に表示し、保存に失敗したリセットは実行しません。

記録は `quiet-time:record:v2` の JSON 1 件に、開始日時・最長記録・リセットで終了した計測区間をまとめて保存します。リセット時は 1 回の書き込みで更新し、一部だけ保存されることを防ぎます。旧形式の `startedAt` と `longestRecord` は初回に自動移行し、既存の時間を引き継ぎます。

ブラウザのサイトデータを消すと記録も消えます。別の端末・ブラウザ・オリジンへの同期はありません。経過時間は端末の時計を基準とするため、時計の変更も反映されます。

## カレンダーと表示設定

右上のメニューからカレンダーを開き、日付を選ぶと、その日に記録した時間の合計を表示します。リセット前後の計測区間を日付の境界で区切って合算し、アプリを閉じていた間も含みます。今日の値は 1 秒ごとに更新します。記録開始前の日は「記録なし」です。旧形式でリセット済みの期間は日時が残っていないため復元しません。

日付は端末のローカルタイムゾーンを使い、夏時間による 23 / 25 時間の日にも対応します。リセットは瞬間的な操作なので、継続して記録した日は原則 24 時間になります。ゲームの実際のプレイ時間は取得していません。

ダークモードは最初は端末の設定に合わせ、メニューで切り替えた後は `quiet-time:theme` に保存した選択を優先します。明暗を切り替えても記録には影響しません。

Service Worker の Cache Storage はアプリファイルのオフライン配信用です。記録の保存には localStorage のみを使い、IndexedDB、外部 API、ログイン、データベース、通知、解析サービスは使用しません。

## Vercel

このフォルダをプロジェクトのルートとしてインポートします。`vercel.json` に以下を設定済みです。

- Framework: Next.js
- Install command: `pnpm install --frozen-lockfile`
- Build command: `pnpm build`
- Output directory: `out`

バックエンドの設定は不要です。

favicon（SVG と 16 / 32 / 48px の ICO）、ホーム画面アイコン、1200 × 630 の共有プレビューを同梱しています。共有プレビューの URL は Vercel の `VERCEL_PROJECT_PRODUCTION_URL`（なければ `VERCEL_URL`）を自動で使用します。独自ドメインや別のホスティングで公開する場合は、ビルド時に `SITE_URL=https://公開先のドメイン` を設定するとその URL を優先します。ローカルでは `http://localhost:3000` を使います。

`scripts/generate-brand-assets.mjs` は任意の画像再生成用です。生成済みの画像を含めているため、通常のビルドにブラウザや日本語フォントは不要です。

## 検証

```sh
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

単体テストでデータ移行、保存の失敗、日付境界、夏時間を確認します。E2E テストは本番ビルドを使用し、タイマー、メニュー、リセット、カレンダー、テーマ保存、オフライン復帰、モバイル表示を確認します。

## 構成

- `src/components/quiet-clock.tsx`: 画面とクライアント側の計測
- `src/lib/record.ts`: localStorage の読み取り、時間の計算と整形
- `src/lib/calendar.ts`: 日付ごとの計測時間
- `src/components/app-menu.tsx`: Material Symbols のメニューとテーマ切り替え
- `src/components/calendar-dialog.tsx`: 日付を選んで時間を閲覧
- `src/lib/theme.ts`: 初期表示前のテーマ適用
- `src/app/manifest.ts`: Web App Manifest
- `src/components/service-worker-registration.tsx`: 本番での Service Worker 登録
- `scripts/generate-sw.mjs`: ビルド成果物に対応した Service Worker の生成

実装は [Next.js の PWA ガイド](https://nextjs.org/docs/app/guides/progressive-web-apps)と[静的エクスポートの仕様](https://nextjs.org/docs/app/guides/static-exports)を参照しています。

アイコンは [Google Material Symbols](https://developers.google.com/fonts/docs/material_symbols) をローカル同梱しています。ライセンスは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) に記載しています。
