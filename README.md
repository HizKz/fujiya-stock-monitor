# Fujiya AVIC Stock Monitor

[フジヤエービックの中古商品一覧](https://www.fujiya-avic.co.jp/shop/c/c40_ssd/)を10分ごとに確認し、新しく掲載された商品をDiscord Botで通知します。

## 構成

```text
Cloudflare Cron（10分ごと）
  └─ GitHub Actionsを即時起動
       ├─ フジヤエービックの商品一覧を取得・新着判定
       └─ Cloudflare Workerへ新着商品を送信
            └─ Discord Botがページ切り替えボタン付きで1メッセージ投稿
```

- Cloudflare WorkerはCron、Bot API、Discordのボタン操作を担当します。
- GitHub Actionsは、実績のあるHTML取得・解析と既知商品の保存を担当します。
- 新着が多くても1通にまとめ、1商品ずつカード表示します。
- 「最初へ」「前へ」「次へ」で商品カードを横へ送る感覚で切り替えられます。
- ボタン用データはWorkers KVへ7日間保存します。
- Cloudflareへの切り替えが終わるまでは、既存のDiscord WebhookとGitHub Cronが動き続けます。

Cloudflare Workers、Workers KV、GitHub Actionsの無料枠内での個人利用を想定しています。

## 監視仕様

- 新着順の1ページ目だけを監視
- 初回は現在の商品を基準として保存し、通知しない
- 2回目以降、新しい商品コードが現れたときに通知
- `在庫あり`と`売り切れ`の両方を通知
- 1回の更新を1つのDiscordメッセージにまとめる
- 1ページに1商品のカードを表示し、商品名・価格・画像を確認可能
- カードのタイトルと件数表示で、届いた新着商品の総数を確認可能
- 「中古一覧ページを開く」から監視対象ページへ移動可能
- 既存商品の価格変更や在庫復活は通知対象外
- 取得、HTML解析、Bot通知のいずれかに失敗した場合は既知商品データを更新しない
- 同じ監視結果を再送しても、24時間以内は二重投稿しない

## 1. Discord Botを作る

1. [Discord Developer Portal](https://discord.com/developers/applications)で`New Application`を選び、アプリ名を`フジヤエービック在庫確認BOT`などにします。
2. `Bot`ページでBotを作成し、`Reset Token`からBot Tokenをコピーします。
3. `Installation`ページでサーバーへのインストールを有効にします。
4. `Guild Install`のScopeへ`bot`を追加します。
5. Bot Permissionsへ次を追加します。

```text
View Channels
Send Messages
Embed Links
```

6. 表示されたInstall Linkから通知先のDiscordサーバーへBotを追加します。
7. `General Information`ページの`Public Key`をコピーします。
8. Discordのユーザー設定で開発者モードを有効にし、通知先チャンネルを右クリックして`チャンネルIDをコピー`します。

Bot Tokenはパスワードと同じです。README、Issue、ソースコード、Actionsログへ貼り付けないでください。

## 2. GitHubの起動用Tokenを作る

[GitHub Fine-grained personal access tokens](https://github.com/settings/personal-access-tokens/new)でTokenを作ります。

```text
Repository access: Only select repositories
Repository: HizKz/fujiya-stock-monitor
Repository permissions → Actions: Read and write
```

作成したTokenはCloudflareのSecret `GITHUB_TOKEN`としてだけ保存します。

## 3. Cloudflareへデプロイする

Bun 1.3.14をインストールした環境で実行します。

```bash
bun install
bunx wrangler login
bunx wrangler kv namespace create NOTIFICATIONS
```

最後のコマンドに表示されたKVのIDを、`wrangler.jsonc`の次の部分へ入れます。

```json
"binding": "NOTIFICATIONS",
"id": "ここを実際のKV Namespace IDへ置き換える"
```

GitHub ActionsとWorker間で共有するランダムなSecretも1つ作ります。

```bash
openssl rand -hex 32
```

次の5項目をCloudflareへ登録します。コマンド実行後のプロンプトへ値を貼り付けてください。

```bash
bunx wrangler secret put DISCORD_BOT_TOKEN
bunx wrangler secret put DISCORD_PUBLIC_KEY
bunx wrangler secret put DISCORD_CHANNEL_ID
bunx wrangler secret put GITHUB_TOKEN
bunx wrangler secret put NOTIFIER_API_TOKEN
```

デプロイします。

```bash
bun run worker:deploy
```

表示されたURLを控えます。例：

```text
https://fujiya-stock-bot.<subdomain>.workers.dev
```

## 4. Discordのボタン操作先を設定する

Discord Developer Portalの`General Information`を開き、`Interactions Endpoint URL`へ次を登録します。

```text
https://fujiya-stock-bot.<subdomain>.workers.dev/interactions
```

保存時にDiscordから署名付きPINGが送られ、Workerが正常ならURLが承認されます。

## 5. GitHub SecretをBot APIへ切り替える

リポジトリで次を開きます。

```text
Settings
  → Secrets and variables
  → Actions
  → New repository secret
```

次の2つを登録します。

```text
Name: NOTIFIER_API_URL
Secret: https://fujiya-stock-bot.<subdomain>.workers.dev/notifications

Name: NOTIFIER_API_TOKEN
Secret: Cloudflareへ登録したものと同じランダム文字列
```

既存の`DISCORD_WEBHOOK_URL`は移行確認が終わるまで残して構いません。`NOTIFIER_API_URL`と`NOTIFIER_API_TOKEN`が両方ある場合はBot APIが優先されます。

## 6. Bot通知をテストする

GitHubで次を実行します。

```text
Actions
  → Monitor Fujiya AVIC arrivals
  → Run workflow
  → mode: bot-test
```

現在の商品10件を使ったテスト通知が1通届き、「前へ」「次へ」で10商品を切り替えられれば成功です。テストでは`data/seen-products.json`を変更しません。

## 7. Cloudflare Cronへ完全移行する

Botテストが成功した後、GitHubのRepository Variableを追加します。

```text
Settings
  → Secrets and variables
  → Actions
  → Variables
  → New repository variable

Name: CLOUDFLARE_SCHEDULER_ENABLED
Value: true
```

これでGitHub側の予備Cronはジョブをスキップし、Cloudflare Cronからの`workflow_dispatch`だけが実行されます。Cloudflare Workerは1分ごとに起動しますが、GitHub Actionsとフジヤエービックの商品取得は前回起動から10分経過したときだけ行います。Cronが一度遅れても次の1分で回復できる構成です。

定期実行の最終結果は次のURLで確認できます。`scheduler`が`null`ならまだCron未実行です。`action`はGitHub Actionsを起動した`dispatched`、10分待機中の`skipped`、失敗した`failed`のいずれかになります。

```text
https://fujiya-stock-bot.fujiya-stock-monitor.workers.dev/health
```

問題が起きた場合は`CLOUDFLARE_SCHEDULER_ENABLED`を`false`へ戻すか削除すると、既存のGitHub Cronへ戻せます。

## ローカルで確認する

実サイトのHTML解析だけを確認します。Discord通知と状態更新は行いません。

```bash
bun run dry-run
```

Workerのローカル開発用Secretは`.dev.vars.example`を`.dev.vars`へコピーして設定します。実際のSecretをコミットしないでください。

```bash
cp .dev.vars.example .dev.vars
bun run worker:dev
```

ローカルCronを試す場合は、別のターミナルで次を実行します。

```bash
curl "http://localhost:8787/cdn-cgi/handler/scheduled"
```

## テスト

単体テストは実サイト、Discord、GitHub、Cloudflareへ接続しません。

```bash
bun run typecheck
bun test
bun run worker:check
```

## ファイル構成

```text
src/
  app.ts             依存性を注入できる監視処理本体
  config.ts          監視URLと環境変数の検証
  fetchProducts.ts   HTML取得と商品カード解析
  state.ts           既知商品コードの読み書き
  discord.ts         移行中のDiscord Webhook通知
  notifier.ts        Cloudflare Bot APIクライアント
  main.ts            Bun向けの薄い実行入口
shared/
  domain.ts          Node側とWorker側で共有するデータ型
worker/
  index.ts           HTTP APIとCronの入口
  discord.ts         Bot投稿・署名検証・ページ操作
  github.ts          GitHub Actionsの即時起動
  render.ts          Discordメッセージとボタンの組み立て
data/
  seen-products.json 既知商品コード
.github/workflows/
  ci.yml              push・PR時の単体テスト
  monitor.yml         監視処理と移行用の予備Cron
wrangler.jsonc        Cloudflare Worker、KV、Cron設定
tsconfig.json         strictなTypeScript型チェック設定
bun.lock              Bunの依存関係ロックファイル
```

## 運用上の注意

- 公開ページ1枚だけを10分間隔で取得します。全ページ巡回は行いません。
- Cloudflare Cronの設定変更は反映に最大15分程度かかる場合があります。
- 403が返った場合は再試行せず、GitHub Actionsを失敗させます。
- 429ではサイトやDiscordが指定した待ち時間に従い、最大1回だけ再試行します。
- 対象サイトが自動取得を拒否している場合は回避せず、監視を停止してください。
- Discord通知後にGitHubへの状態保存だけが失敗した場合、次回の送信は24時間の重複防止で抑制されます。
- ページ切り替えデータは7日後に削除され、それ以降はボタン操作できません。
