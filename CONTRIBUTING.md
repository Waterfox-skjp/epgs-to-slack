# 開発とリリース

シンプルさと管理のしやすさを優先します。Node.js 標準機能で実現できる処理に、外部パッケージやサービスを追加する必要はありません。

## 日常の変更

1. 最新の `develop` から `feature/*` を作成する。
2. 実装と必要なテスト・ドキュメントを変更する。
3. `npm run check` と `npm test` を実行する。
4. 日本語の Conventional Commit を作成する。
5. push の指示がある場合だけ送信し、`develop` 向けの Pull Request を作成する。

コミット例:

```text
feat: 通知対象を追加
fix: 日付をまたぐ録画の表示を修正
docs: Docker環境の設定手順を更新
```

type / scope は英語、説明・本文は日本語にします。破壊的変更は `!` または `BREAKING CHANGE:` で明示します。

## 初回の統合

`feature/slack-notifications` → `develop` の Pull Request で実装と CI を確認します。承認後に統合します。現時点の `main` / `develop` は Git の初期設定だけを含みます。

## リリース

1. `develop` から `release/1.0.0` などのブランチを作成する。
2. `package.json` のバージョン、導入手順、検証結果を確認する。
3. `main` へ `--no-ff` で統合し、`v1.0.0` などのタグを付ける。
4. `release/*` の変更を `develop` へも統合する。
5. ブランチ・タグの push は明示的な指示がある場合だけ行う。

緊急修正は `main` から `hotfix/*` を作成し、修正後は `main` と `develop` に反映します。

## テストと秘密情報

テストは実際の Slack に送信せず、ローカル HTTP サーバーまたはダミーの応答を使います。`npm install` は不要です。

実際の Webhook URL は `.env` または実行時の環境変数で管理します。ソース、設定例、スクリーンショット、Issue、Pull Request、ログに記載しないでください。
