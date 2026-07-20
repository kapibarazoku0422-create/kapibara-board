# YOHaku — Googleログイン対応コミュニティ掲示板

言葉と人のあいだに心地よい余白をつくる、大規模運用を意識した掲示板です。Google OAuth、PostgreSQL、DBセッション、全文検索、カテゴリ、返信、共感、ブックマーク、レスポンシブUI、ダークモードを備えています。

## ローカルで確認

DBなしでも、サンプルデータを使ったプレビューモードでUIを確認できます。

```bash
npm install
npm run dev
```

<http://localhost:3000> を開いてください。投稿・ログインまで確認する場合は `.env.example` を `.env` にコピーし、PostgreSQLとGoogle OAuthを設定します。

## PostgreSQLを設定

1. PostgreSQLデータベースを用意します（Render Postgres、Neon、Supabaseなど、通常のPostgreSQL接続URLなら利用できます）。
2. `.env` の `DATABASE_URL` を設定します。
3. 外部DBでSSLが必要なら `DATABASE_SSL=true` にします。
4. スキーマを適用します。

```bash
npm run db:migrate
```

初期SQLは `db/migrations/001_initial_schema.sql` です。SQLクライアントから直接実行しても構いません。セッション、日本語部分一致用 `pg_trgm`、検索用GIN、フィード・返信・ブックマーク用のインデックスも含まれます。

## Googleログインを設定

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) でプロジェクトを作成します。
2. OAuth同意画面を設定し、OAuthクライアントID（ウェブアプリケーション）を作成します。
3. 承認済みリダイレクトURIを登録します。
   - ローカル: `http://localhost:3000/auth/google/callback`
   - 本番: `https://あなたのサービス.onrender.com/auth/google/callback`
4. クライアントIDとシークレットを環境変数へ設定します。

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
APP_BASE_URL=http://localhost:3000
```

本番の `APP_BASE_URL` は末尾の `/` を付けず、公開URLそのものを設定してください。Google OAuthのリダイレクトURIと完全一致する必要があります。

## Renderへデプロイ

このプロジェクトは `render.yaml` を同梱しています。DBはBlueprintで作らず、ご自身のPostgreSQLを接続する構成です。

1. GitHub / GitLab / Bitbucketにこのフォルダをpushします。
2. Render Dashboardで **New → Blueprint** を選び、リポジトリを接続します。
3. 次の秘密情報を入力します。
   - `DATABASE_URL`: PostgreSQL接続URL
   - `APP_BASE_URL`: `https://サービス名.onrender.com`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
4. PostgreSQLに `npm run db:migrate` 相当のSQLを適用します。
5. Applyしてデプロイします。

Renderの設定値は次のとおりです。

| 項目 | 値 |
|---|---|
| Runtime | Node |
| Region | Singapore |
| Build | `npm ci && npm run build` |
| Start | `npm start` |
| Health check | `/health` |

`SESSION_SECRET` はRenderが自動生成します。アプリは `0.0.0.0:$PORT` で待ち受け、SIGTERM時に安全にDB接続を閉じます。

## 大規模化するとき

- Webサービスを複数インスタンスへ増やしても、セッションはPostgreSQL共有なのでログイン状態を維持できます。
- 閲覧数の毎回UPDATEがボトルネックになったら、Redisで集計して非同期反映する構成へ移します。
- 数百万スレッドを超える検索は、PGroonga / Elasticsearch / OpenSearchを別サービスとして切り出します。
- 画像投稿を追加する場合はRenderの一時ファイルシステムではなく、S3互換ストレージへ直接アップロードします。
- モデレーションワーカー、通知、メールはWebプロセスからキューへ分離します。

## コマンド

```bash
npm run dev          # 開発サーバー
npm run typecheck    # TypeScript検査
npm test             # HTTPスモークテスト
npm run build        # 本番ビルド
npm start            # 本番起動
npm run db:migrate   # DBマイグレーション
```
