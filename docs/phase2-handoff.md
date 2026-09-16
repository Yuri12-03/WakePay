# フェーズ2：実装とDB担当者への引き継ぎ

## 実装済み

登録 → ホーム → 部屋作成／コードで参加 → 部屋の参加者一覧。
参加者一覧は5秒ごとに再取得します。作成者も参加人数に含みます。
入力チェック、未登録時の誘導、送信中の二重クリック防止、満員・無効コード・接続エラーの表示を含みます。
ホームから参加済みの部屋に戻れます。既存のアラームは `/alarm-demo` に残しています。
起床時間の設定・承認・起床確認・結果表示は今回の対象外です。

## DB担当者にお願いする設定（未実施）

1. 提示済みの `users` / `rooms` / `room_members` / `wake_checks` の4テーブルを用意する。
2. SupabaseのAuth設定で **Allow anonymous sign-ins** を有効にする。
3. リポジトリ内の `supabase/phase2.sql` を確認して、SQL Editorでファイル全体を実行する。
4. ローカルの開発サーバーを起動し、下の実接続チェックを行う。

確認時点で接続先の匿名サインインは無効でした。上記設定やSQLのリモート実行は、この作業では行っていません。
テーブルの `limit=0` の読み取り応答は確認できましたが、それだけでは書き込み権限やSQLの適用状況は判断できません。

SQLは既存データを削除せず、再適用できます。既に同じ `(room_id, user_id)` の重複行がある場合、ユニークインデックス追加は失敗して全体がロールバックします。DB担当者が既存データを確認してから再実行してください。

### 簡易登録の扱い

画面上は設計書どおりニックネームとアイコンだけです。内部ではSupabaseの匿名AuthでユーザーIDを発行し、そのIDを `users.id` に保存します。既存の `id text` 型を変更する必要はありません。
単にユーザーIDだけをCookieに保存すると書き換えで別人になれてしまうため、AuthトークンをHttpOnly Cookieに保存し、APIで本人を確認します。Cookieは30日保持し、アクセス時に期限切れトークンを更新します。ユーザーIDやトークンはAPIレスポンスの認証情報としてクライアントに渡しません（表示データにはユーザーIDを含みます）。
Cookie削除・別ブラウザ・別端末からのアカウント復旧は対象外です。再登録すると別ユーザーになります。メール・パスワード入力は不要です。

公式資料: [匿名サインイン](https://supabase.com/docs/guides/auth/auth-anonymous)、[APIキー](https://supabase.com/docs/guides/getting-started/api-keys)。

### SQLが追加する内容と他フェーズへの影響

- `room_members(room_id, user_id)` の一意性とユーザー検索用インデックス。
- 4テーブルのRLS有効化、および `anon` / `authenticated` の直接読み書き権限の取り消し。
- ログイン済みユーザーだけが呼べる6個の `wp_*` 関数。取得・保存はこれらの関数を通す。
- 部屋作成と作成者の参加登録は同一トランザクション。片方が失敗すれば両方を取り消す。
- 部屋参加時は対象の部屋行をロックしてから定員を確認する。同時参加の定員超過を防ぐ。
- 重複参加は成功として扱い、参加行を増やさない。参加済みのユーザーは満員・開始後も部屋に戻れる。
- 自分以外のプロフィール単独取得や、未参加の部屋の参加者一覧取得は不可。

**後続フェーズも、認証・権限確認を行うSQL関数を追加して連携してください。** 現在の4テーブルをブラウザから直接操作するコードや、別担当者の既存ポリシーがある場合は、このアクセス方式に合わせてから適用してください。`wake_checks` の書き込み関数はフェーズ4で追加します。

## 接続と起動

ルートの `.env.local` は作成済みです。必要なのは次の2変数です。

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co/
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

管理者用のsecret key / service_role keyは不要です。`.env.local` はGit管理対象外です。
Next.js Route HandlerからSupabaseのREST APIへ接続します。アプリ用の追加ライブラリは不要です。

```sh
npm install
npm run dev
```

環境変数を変更した場合はサーバーを再起動してください。本番ビルドは環境変数を設定した後に行います。

## API契約

すべて同一オリジンで利用します。POSTのデータは `Content-Type: application/json`。本人の識別はHttpOnly Cookie経由で行い、`user_id` や `creator_id` を入力として受け付けません。

| API | 入力 | 成功レスポンス |
| --- | --- | --- |
| `POST /api/users` | `{ "nickname": "あさひ", "icon": "cat" }` | 201 `{ "user": User }` + Cookie |
| `GET /api/users` | なし | 200 `{ "user": User }`（自分） |
| `GET /api/users/[id]` | 自分のID | 200 `{ "user": User }` |
| `POST /api/rooms` | `{ "group_name": "朝活", "max_members": 4 }` | 201 `{ "room": Room }` |
| `GET /api/rooms` | なし | 200 `{ "rooms": Room[] }`（参加済み） |
| `POST /api/rooms/[roomCode]/join` | `{}` | 200 `{ "room": Room }` |
| `GET /api/rooms/[roomCode]` | なし | 200 `{ "room": Room, "members": Member[] }` |

部屋コードは英数字6文字で、大文字に統一します。参加人数は作成者込みで2〜8人です。
`User` / `Room` は提示されたテーブルの項目と同じです。型は `lib/types.ts` を参照してください。

```json
{
  "room": {
    "id": "部屋ID", "room_code": "ABC123", "group_name": "朝活",
    "max_members": 4, "creator_id": "ユーザーID", "wake_time": null,
    "challenge_amount": null, "status": "waiting", "created_at": "日時"
  },
  "members": [{
    "id": "参加レコードID", "user_id": "ユーザーID",
    "approved": false, "joined_at": "日時",
    "user": { "id": "ユーザーID", "nickname": "あさひ", "icon": "cat", "created_at": "日時" }
  }]
}
```

エラー形式は `{ "error": { "message": "日本語メッセージ" } }` に統一しています。
主なステータスは400（入力）、401（登録・認証）、403（権限）、404（部屋なし）、409（満員・受付終了）、429（回数制限）、502/503（接続・設定）です。読み取りも保存もキャッシュしません。

## 検証

実施済み:

- Next.js本番ビルド・TypeScriptチェック。
- PGlite上で提示スキーマと追加SQLを実行する7件のテスト。登録・入力チェック・権限・作成者参加・重複参加・満員・受付終了・作成失敗時のロールバック・SQL再適用を検証。
- Edgeのヘッドレスブラウザ、390px幅、API応答のモックによる画面操作。登録 → 作成 → 別ユーザー参加 → 自動更新、再読み込み、部屋への再アクセス、無効コード・満員エラー、作成者限定の準備中ボタンを検証。
- 実際のローカルAPIで未認証・無効な登録入力・別オリジンからの送信の拒否を確認。

PGliteテストは独立したローカルDBで実行し、Authの `auth.uid()` をテスト用に置き換えています。実際のSupabase Authや複数DB接続での同時参加試験は含みません。共有Supabase上の保存・セッション更新・複数人の連携確認は、設定・SQL適用後に必要です。

テストの再実行:

```sh
cd tests
pnpm install --frozen-lockfile
pnpm test
# 別ターミナルでルートから npm run build と npm run start -- --port 3100 を実行
pnpm test:ui
```

画面テストはインストール済みEdgeを使います。Chromeを使う場合は `TEST_BROWSER_CHANNEL=chrome`、接続先を変える場合は `TEST_BASE_URL` を環境変数に設定してください。画像は `tests/artifacts/` に保存され、Gitには含まれません。

### SQL適用後の実接続チェック

1. 通常ブラウザで登録し、2人の部屋を作成。作成者が「1 / 2人」に含まれることを確認。
2. 別のブラウザまたはシークレットウィンドウで別ユーザーを登録し、発行コードで参加。
3. 作成者の画面が5秒程度で「2 / 2人」に変わることを確認。
4. 同じユーザーで参加を繰り返しても参加者が増えないことを確認。
5. 3人目が参加すると満員エラーになることを確認。
6. ページの再読み込みやホームからの再アクセスでもプロフィール・部屋が残ることを確認。
7. アクセストークンの期限経過後に再アクセスして、同じユーザーとして継続できることを確認。
