# 余白

広告ゲームを遊ばずに過ごした時間を表示する、小さな PWA です。Google Material Symbols のメニューから、カレンダー・ダークモード・リセットを使えます。

## ローカル起動

Node.js 22 系（22.13 以上）、pnpm 10 を使用します。

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
- ページが表示され、フォーカスを持っている間だけ計測します。1 秒ごとに計測区間の終了時刻を保存し、その合計を日・時・分・秒で表示します。
- 別タブへの切り替え、別ウィンドウへの移動、最小化、ページを閉じる操作で一時停止します。復帰時は現在時刻から新しい区間を開始し、非フォーカス中や閉じていた間の時間を加算しません。
- 開始日時は端末のローカルタイムゾーンで表示します。
- リセットは確認後に実行します。その時点の経過時間が `longestRecord`（ミリ秒）を上回る場合に更新し、開始日時を現在にします。最長記録は完了した記録のみを対象とします。
- 複数のタブではフォーカスを取得したタブが計測を引き継ぎます。古いタブからの停止処理で新しい記録を上書きしません。
- 保存できない場合は画面に表示し、保存に失敗したリセットは実行しません。

記録は `quiet-time:record:v3` の JSON 1 件に、開始日時・最長記録・今回の計測区間・リセット前の計測区間・現在のタブが確認した終了時刻をまとめて保存します。リセット時は 1 回の書き込みで更新し、一部だけ保存されることを防ぎます。保存済みの区間には必ず終了時刻があり、再起動時に閉じていた時間を加算しません。異常終了時は最後に保存できた時点までの記録を復元します。

v2 および旧形式の `startedAt` / `longestRecord` は自動移行します。旧バージョンのフォーカス状態は復元できないため、移行時までの既存の時間・最長記録・カレンダーの記録は引き継ぎ、移行後からフォーカス中の時間だけを加算します。

ブラウザのサイトデータを消すと記録も消えます。別の端末・ブラウザ・オリジンへの同期はありません。経過時間は端末の時計を基準とするため、時計の変更も反映されます。

## カレンダーと表示設定

右上のメニューからカレンダーを開き、日付を選ぶと、その日に記録した時間の合計を表示します。リセット前後の計測区間を日付の境界で区切って合算し、非フォーカス中・非表示中・アプリを閉じていた間は除外します。今日の値はフォーカス中に 1 秒ごとに更新します。記録がない日は「記録なし」です。旧形式でリセット済みの期間は日時が残っていないため復元しません。

日付は端末のローカルタイムゾーンを使い、夏時間による 23 / 25 時間の日にも対応します。ゲームの実際のプレイ時間は取得していません。

ダークモードは最初は端末の設定に合わせ、メニューで切り替えた後は `quiet-time:theme` に保存した選択を優先します。明暗を切り替えても記録には影響しません。

Service Worker の Cache Storage はアプリファイルのオフライン配信用です。記録の保存には localStorage のみを使い、IndexedDB、外部 API、ログイン、データベース、通知、解析サービスは使用しません。

## Vercel

このフォルダをプロジェクトのルートとしてインポートします。`vercel.json` に以下を設定済みです。

- Framework preset: Other（`framework: null`）
- Install command: `pnpm install --frozen-lockfile`
- Build command: `pnpm build`
- Output directory: `out`

バックエンドの設定は不要です。

Next.js は `output: "export"` で静的ファイルを作り、Vercel は `out` をそのまま配信します。Next.js 用のサーバービルダーに `out` を渡すと `routes-manifest.json` を探して失敗するため、フレームワークのプリセットは明示的に Other にしています。Node.js は `package.json` で 22 系に固定しています。

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
- `src/hooks/use-focused-record.ts`: フォーカス・表示状態による計測の開始、保存、一時停止
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
