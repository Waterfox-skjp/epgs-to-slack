# 開発方針

- 機能数よりシンプルさ・管理のしやすさを優先する。
- 通知対象は録画予約・録画開始・録画終了。外部パッケージや常駐サービスは必要性がある場合だけ追加する。
- Webhook URL などの秘密情報はソースコード・ログ・コミットに含めない。

# Git Workflow

- Git Flow に従い、統合先は `develop`、開発は `feature/*`、リリースは `release/*`、緊急修正は `hotfix/*` を使う。
- 作業は原則ローカルコミットまで完了する。
- ブランチ・タグの push はユーザーから明示的に指示された場合だけ行う。

# Commit Messages

- Conventional Commits 1.0.0 の `<type>[optional scope][optional !]: <description>` 形式を使う。
- type と scope は英語、説明・本文・説明用フッターは日本語。`BREAKING CHANGE`、`Refs` などの標準トークンは維持する。
- 新機能は `feat`、バグ修正は `fix`、それ以外は `docs`、`refactor`、`test`、`chore` など適切な type を使う。
- 破壊的変更は `!` または `BREAKING CHANGE:` で示す。

# 検証

- コード変更後は `npm run check` と `npm test` を実行する。
- テストで実際の Slack へ送信しない。
