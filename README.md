# epgs-to-slack

EPGStation の**録画予約・録画開始・録画終了**を Slack に通知する、小さなコマンドラインツールです。

Node.js 標準機能のみで動作します。`npm install`、ビルド、追加コンテナ、常駐プロセス、EPGStation / Mirakurun API への接続は不要です。EPGStation の外部コマンドから呼び出し、環境変数で渡された番組情報を Incoming Webhook へ送信します。

## 通知内容

提示いただいたメッセージ形式を使います。

| イベント | 絵文字 | 内容 |
| --- | --- | --- |
| `reserve` | `:new:` | 番組名・放送日・開始時刻～終了時刻・放送局・番組概要 |
| `start` | `:black_circle_for_record:` | 番組名・開始時刻～終了時刻・放送局 |
| `end` | `:black_square_for_stop:` | 番組名・開始時刻～終了時刻・放送局 |

予約通知の送信テキスト例:

````text
:new: *サンプル番組*
```2026/10/26月曜日 21:00:00～21:30:00［NHK総合］
番組概要のサンプルです。```
````

既定で日本時間を使います。終了通知は録画終了フックに対応し、エンコードの完了通知や録画ファイルの正常性・ドロップ数の検査は行いません。

## Docker 版 EPGStation への導入

対象は [docker-mirakurun-epgstation](https://github.com/l3tnun/docker-mirakurun-epgstation) と EPGStation v2 / v3 の外部コマンド設定です。**EPGStation コンテナ内の Node.js 22 以上**が必要です。導入コマンドは Linux のホスト上で、既存の `docker-compose.yml` があるフォルダーから実行してください。

### 1. Node.js のバージョンを確認

```sh
docker compose exec epgstation node --version
```

22 未満の場合は、先にお使いの EPGStation イメージの Node.js 対応を確認してください。このツールを導入するだけでは、既存イメージの Node.js は更新されません。

### 2. ツールと Webhook を配置

このリポジトリを、次のように既存の Compose プロジェクト直下へ配置します。GitHub に登録した後は、そのリポジトリを `epgs-to-slack` というフォルダー名で clone すると同じ構成になります。

```text
docker-mirakurun-epgstation/
├── docker-compose.yml
├── epgstation/
│   └── config/config.yml
└── epgs-to-slack/
    ├── notify.mjs
    ├── .env
    └── examples/
```

```sh
cp epgs-to-slack/.env.example epgs-to-slack/.env
chmod 600 epgs-to-slack/.env
```

`.env` の `SLACK_WEBHOOK_URL=` に、Slack で発行した Incoming Webhook URL を設定します。投稿先は Webhook の作成時に選んだチャンネルです。Bot Token やチャンネル ID の設定は不要です。

**会話や公開ファイルに貼り付けた Webhook URL は再発行してください。** URL は秘密情報です。`.env` は Git 管理から除外してあります。Node.js を実行するコンテナのユーザーがこのファイルを読める所有者・権限にしてください。

Webhook の作成方法: [Slack 公式ドキュメント](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/)

### 3. フォルダーをコンテナへマウント

既存の `docker-compose.yml` の `services.epgstation.volumes` に、次の **1 行を追加**します。既存の録画フォルダーや設定ファイルのマウントはそのまま残します。

```yaml
      - ./epgs-to-slack:/opt/epgs-to-slack:ro
```

Compose 本体を変更したくない場合は [examples/compose.override.yml](examples/compose.override.yml) を使用できます。その場合は、起動・更新のコマンドで毎回 `docker compose -f docker-compose.yml -f compose.override.yml ...` のように両ファイルを指定してください。

### 4. 通知コマンドを設定

EPGStation の外部コマンドでは Node.js の絶対パスを指定します。コンテナ内のパスを確認してください。

```sh
docker compose exec epgstation sh -c 'command -v node'
```

`epgstation/config/config.yml` に、[設定例](examples/epgstation.config.yml)の 3 項目を追加します。次の `/usr/local/bin/node` は例です。上記の結果が異なる場合は、3 行とも実際のパスに置き換えてください。同じキーが既にある場合は、その値を置き換えます。config.yml 全体をこの内容で上書きしないでください。

```yaml
reserveNewAddtionCommand: '/usr/local/bin/node /opt/epgs-to-slack/notify.mjs reserve'
recordingStartCommand: '/usr/local/bin/node /opt/epgs-to-slack/notify.mjs start'
recordingFinishCommand: '/usr/local/bin/node /opt/epgs-to-slack/notify.mjs end'
```

`Addtion` は EPGStation 側の正式なキー名です。`Addition` に直すと通知されません。Discord 版を呼び出している同じ項目を置き換えることで移行できます。
ログに `CmdBinIsNotFound` や `stat 'node'` が出る場合は、設定した Node.js の絶対パスを確認してください。

### 5. 反映と確認

録画のない時間帯に、EPGStation コンテナを再作成してマウントと設定を反映します。

```sh
docker compose up -d epgstation
```

まずは**送信しないプレビュー**で配置を確認します。

```sh
docker compose exec epgstation node \
  --env-file=/opt/epgs-to-slack/examples/program.env \
  /opt/epgs-to-slack/notify.mjs reserve --dry-run
```

Slack への接続も確認する場合は、同じコマンドから `--dry-run` を外します。サンプル番組の通知が 1 件送信されます。

```sh
docker compose exec epgstation node \
  --env-file=/opt/epgs-to-slack/examples/program.env \
  /opt/epgs-to-slack/notify.mjs reserve
```

続いて実際の番組を 1 件予約し、予約・録画開始・録画終了の通知を確認します。ルールによる自動予約も、EPGStation が予約追加フックを実行した時に通知対象になります。

このリポジトリの自動テストは実際の Slack や EPGStation を使用しません。利用環境でのフック実行と Slack 到達は、この手順で確認してください。

## 設定と実行方法

| 設定 | 必須 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `SLACK_WEBHOOK_URL` | 送信時のみ | なし | Slack Incoming Webhook URL |
| `EPGS_TIMEZONE` | いいえ | `Asia/Tokyo` | 通知内の日時を表示するタイムゾーン |

設定は `notify.mjs` と同じフォルダーの `.env` から読み込み、同名の環境変数があればそちらを優先します。作業フォルダーには依存しません。`.env` は設定用の 2 項目だけに使い、番組情報は EPGStation から渡された値を使います。

EPGStation が渡す `STARTAT` / `ENDAT` は **UNIX 時刻のミリ秒**です。`NAME` / `CHANNELNAME` が空なら代替名を表示し、`DESCRIPTION` が空なら概要部分は空にします。日時が欠けている・不正・逆転している場合は送信せずエラーにします。

```sh
node notify.mjs --help
node notify.mjs reserve --dry-run
node notify.mjs start --dry-run
node notify.mjs end --dry-run
```

上の 3 コマンドのプレビューにも、番組情報の環境変数が必要です。サンプルで試す場合は、リポジトリ直下で次を使います。Webhook は不要です。

```sh
npm run preview
```

### エラーと運用

- 成功は終了コード `0`、設定・送信エラーは `1` を返します。
- 送信は 1 回、応答本文の受信まで含めて最大 10 秒です。HTTP エラーと `ok` 以外の応答も失敗として扱います。
- HTTP 429、タイムアウト、通信失敗時の自動再送・永続キューはありません。障害時の通知は失われることがあります。応答だけ失われて既に投稿されている可能性もあるため、自動で再送しません。
- 番組名・放送局名・概要の特殊文字を処理し、意図しないメンションやコードブロックの崩れを抑えます。長い番組情報は省略します。
- Webhook URL と Slack の応答本文はログに出しません。送信先は `hooks.slack.com` の HTTPS Webhook に限定し、リダイレクトを追いません。
- 失敗時は EPGStation の `epgstation/logs/` 内のログも確認してください。ログを共有する前に秘密情報がないか確認してください。

更新は、稼働に使っているブランチを更新してから `npm test` とプレビューで確認します。同じマウント先の `notify.mjs` と `.env` の変更は、次回の通知実行から反映されます。EPGStation の config.yml の変更は再起動が必要です。

## GitHub での管理

Git Flow を使います。`main` はリリース、`develop` は統合、開発は `feature/*`、リリース準備は `release/*`、緊急修正は `hotfix/*` です。

ローカルには `main` / `develop` / `feature/slack-notifications` を用意しています。初期実装は `feature/slack-notifications` にコミットし、統合・リリースはレビュー後に行います。

GitHub では空のリポジトリを作り、その URL を `origin` に設定します。最初は非公開でも運用できます。**以下の push は、GitHub への送信を行う段階で実行してください。**

```sh
# YOUR_ACCOUNT を自分の GitHub アカウント名に置き換える
git remote add origin https://github.com/YOUR_ACCOUNT/epgs-to-slack.git
git push -u origin main
git push -u origin develop
git push -u origin feature/slack-notifications
```

GitHub 上で既定ブランチを `develop` に設定し、`feature/slack-notifications` → `develop` の Pull Request を作ります。`.github/workflows/ci.yml` が Node.js 22 / 24、Linux / Windows で構文チェックとテストを実行します。CI に Webhook の Secrets 登録は不要です。

以降の作業例:

```sh
git switch develop
git switch -c feature/変更内容
npm run check
npm test
git add 変更したファイル
git commit -m 'feat: 変更内容を日本語で記載'
```

コミットは [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) 形式で、type / scope は英語、説明は日本語にします。詳しくは [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

## 開発と検証

Node.js 22 以上があれば、外部パッケージのインストールなしで実行できます。

```sh
npm run check
npm test
```

テストでは 3 種類の通知文、日本時間・日跨ぎ、設定の優先順位、CLI の終了コード、ローカル HTTP サーバーでの送信・HTTP エラー・タイムアウト・リダイレクト拒否を検証します。実際の Slack には送信しません。

## 参考

フックの利用方法と既存通知ツールの構成を参考に、新規に実装しています。

- [advancedbear/EPGS-to-Discord](https://github.com/advancedbear/EPGS-to-Discord)
- [yude/EPGS-to-Discord-v2](https://github.com/yude/EPGS-to-Discord-v2)
- [hiroxto/epgstation-slack-notification](https://github.com/hiroxto/epgstation-slack-notification)
- [EPGStation v2 外部コマンドの公式資料](https://github.com/l3tnun/EPGStation/blob/v2/doc/conf-manual.md#外部コマンド実行)
- [EPGStation v3 外部コマンドの公式資料](https://github.com/l3tnun/EPGStation/blob/master/docs/conf-manual.md#外部コマンド実行)

## ライセンス

[MIT](LICENSE)
