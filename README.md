# Fujiya AVIC Stock Monitor

[フジヤエービックの中古商品一覧](https://www.fujiya-avic.co.jp/shop/c/c40_ssd/)を10分ごとに確認し、新しく掲載された商品をDiscordへ通知します。

GitHub ActionsとDiscord Webhookだけを使うため、公開リポジトリの標準ランナーではサーバー料金なしで運用できます。

## 監視仕様

- 新着順の1ページ目だけを監視
- 初回は現在の商品を基準として保存し、通知しない
- 2回目以降、新しい商品コードが現れたときに通知
- `在庫あり`と`売り切れ`の両方を通知
- 1回の更新を1つのDiscordメッセージにまとめ、商品名・価格・在庫を一覧表示
- 商品数が多く表示上限を超える場合は、表示できる分と残り件数を案内
- 「中古リスト一覧ページを開く」から監視対象の中古一覧へ移動可能
- 既存商品の価格変更や在庫復活は通知対象外
- 取得やHTML解析に失敗した場合は、既知商品データを更新しない

## 必要なもの

- GitHubアカウント
- 通知先のDiscordサーバーとチャンネル
- Node.js 22以上（ローカル実行する場合のみ）

## Discord Webhookを作成する

通知先チャンネルの設定から次の順で作成します。

```text
連携サービス → ウェブフック → 新しいウェブフック → ウェブフックURLをコピー
```

Webhook URLは第三者に知られると投稿に悪用されるため、README、Issue、ソースコード、Actionsログへ貼り付けないでください。

## GitHub Secretを設定する

リポジトリで次を開きます。

```text
Settings
  → Secrets and variables
  → Actions
  → New repository secret
```

以下のSecretを登録します。

```text
Name: DISCORD_WEBHOOK_URL
Secret: DiscordでコピーしたWebhook URL
```

Webhook接続テストが成功した後、定期監視を有効化するためにRepository Variableも登録します。

```text
Settings
  → Secrets and variables
  → Actions
  → Variables
  → New repository variable

Name: MONITOR_ENABLED
Value: true
```

`MONITOR_ENABLED=true`を設定するまでは、10分ごとの定期ジョブは安全のためスキップされます。GitHub CLIを使う場合は次のコマンドでも登録できます。Webhook URLはコマンドに直接書かず、プロンプトから入力してください。

```bash
gh secret set DISCORD_WEBHOOK_URL --repo HizKz/fujiya-stock-monitor
gh variable set MONITOR_ENABLED --body true --repo HizKz/fujiya-stock-monitor
```

## GitHub Actionsを手動実行する

最初にWebhook接続を確認します。

```text
Actions
  → Monitor Fujiya AVIC arrivals
  → Run workflow
  → mode: webhook-test
```

現在の新着商品を使った表示テストがDiscordに1件届けば成功です。表示テストでは既知商品データを変更しません。

次に`mode: monitor`で実行します。初回は現在の新着商品を`data/seen-products.json`へ保存するだけで、商品通知は送りません。`MONITOR_ENABLED=true`の登録後は10分ごとに自動実行されます。

GitHub Actionsは毎時`03・13・23・33・43・53分`に起動を試みます。混雑を避けるため、切りのよい時刻から3分ずらしています。ただしGitHub側の混雑状況により遅延・欠落する可能性があり、正確な10分間隔は保証されません。

## ローカルで確認する

依存関係をインストールします。

```bash
npm install
```

実サイトのHTML解析だけを確認します。Discord通知と状態更新は行いません。

```bash
npm run dry-run
```

Webhookをローカルでテストする場合は`.env.example`を`.env`へコピーし、実際のURLを設定します。

```bash
cp .env.example .env
npm run webhook:test
```

通常監視をローカル実行する場合は次を使います。

```bash
npm start
```

## テスト

単体テストは実サイトやDiscordへ接続しません。

```bash
npm test
```

## ファイル構成

```text
src/
  config.js          監視URLとタイムアウト設定
  fetchProducts.js   HTML取得と商品カード解析
  state.js           既知商品コードの読み書き
  discord.js         Discord Webhook通知
  main.js            実行モードと処理フロー
data/
  seen-products.json 既知商品コード
.github/workflows/
  ci.yml              push・PR時の単体テスト
  monitor.yml         10分ごとの監視
```

## 運用上の注意

- 公開ページ1枚だけを10分間隔で取得します。全ページ巡回は行いません。
- 403が返った場合は再試行せず、GitHub Actionsを失敗させます。
- 429ではサイトが指定した待ち時間に従い、最大1回だけ再試行します。
- 対象サイトが自動取得を拒否している場合は回避せず、ワークフローを停止してください。
- Discord通知後にGitHubへの状態保存だけが失敗した場合、次回に同じ商品が再通知される可能性があります。
