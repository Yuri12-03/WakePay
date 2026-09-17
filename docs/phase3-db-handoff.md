# フェーズ3：DB担当者への引き継ぎ

## 変更する動作

最後の参加が確定したとき、同じトランザクション内で全員分の起床確認レコードを3件ずつ生成し、部屋を `active` にします。ブラウザから開始APIを呼ぶ必要はありません。作成・プレビューRPCの変更は不要です。

追加SQLは [supabase/phase3.sql](../supabase/phase3.sql)。共有Supabaseへの適用はアプリのビルドとは別作業です。本ファイル作成時点では、こちらから適用していません。

## 前提と差分

- フェーズ2の4テーブル・認証・プロフィールRPC、およびフェーズ2.5の `wake_at` 列と条件制約・参加制約が適用済みであること。
- `wp_join_room_v25(text,boolean,timestamptz,integer)` を更新。引数はそのまま、返却形式は `{ "room": Room }`。アプリは部屋情報が直接返る形式も受け付けます。
- 内部関数 `wp_start_room(p_room_id text)` を追加。PUBLIC・anon・authenticatedには実行権限を与えません。
- 読み取りRPC `wp_waiting_room(p_room_code text)` を追加。認証・プロフィール・参加者であることを確認してから、部屋・本人の3回の予定・サーバー時刻を返します。参加・開始・確認記録の書き込みは行いません。
- `wake_checks.checked_at` と `deadline` をtimestamptzに統一。部屋ID・ユーザーIDのNOT NULL、確認番号1〜3、部屋×ユーザー×確認番号の一意性を保証します。
- 各締切は `wake_at + 10分 / 20分 / 30分`。受付開始はそれぞれ締切の10分前。確認済み時刻はすべてNULLで生成し、フェーズ4で記録します。
- 作成RPCとプレビューRPCの返却形式や権限は変更しません。テーブル直接アクセスは引き続き禁止します。

## 適用前の確認

チームの実DBでは作成RPCがリポジトリSQLと異なる形式を返していました。既存RPC・トリガーの定義を保存し、今回の参加RPCの置き換えが意図した範囲か確認してください。特にフェーズ2.5の部屋行ロック、条件同意、条件変更禁止が保たれていることが前提です。

次のSQLは読み取りのみです。

```sql
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'wake_checks';

select count(*) as total, count(checked_at) as checked_count from public.wake_checks;

select room_id, user_id, check_number, count(*) from public.wake_checks
group by room_id, user_id, check_number having count(*) > 1;

select id, room_id, user_id, check_number, deadline from public.wake_checks
where room_id is null or user_id is null or check_number not between 1 and 3;

select r.room_code, r.status, r.wake_at, r.max_members,
  count(m.id) as members, bool_and(m.approved is true) as all_approved
from public.rooms r left join public.room_members m on m.room_id = r.id
group by r.id order by r.created_at desc;
```

### 既存timestampのタイムゾーン

`wake_checks` が空なら、SQLをそのまま実行できます。既存のtimestamp値がある場合、SQL冒頭の `set local wakepay.legacy_timestamp_zone = '';` を、保存元を確認したタイムゾーン（例：`UTC` または `Asia/Tokyo`）へ変更します。

未指定のまま既存値を変換しようとすると `WP_LEGACY_TIMEZONE_REQUIRED` で全体をロールバックします。UTC・日本時間が混在していたり、保存元が確認できない場合は適用を止め、レコードごとの移行方法を先に決めてください。データを削除して回避しないでください。

すでにtimestamptzの列は変換しません。重複・不正な確認番号・NULLの参照がある場合も制約追加が失敗し、データは保持されます。

## 既存部屋の扱い

- `ready` かつ未来の起床日時・正しい条件・定員一致・全員同意済みの部屋だけ、SQL適用時に自動開始します。
- 起床日時を過ぎた部屋、条件不足、人数不足、未同意がある部屋はそのまま残します。無条件で承認・開始しません。
- `waiting` の部屋は次の参加確定時に条件を確認し、定員になった場合に開始します。
- 既存の確認データが正しい予定と一致しない場合は `WP_CHECK_DATA_CONFLICT` で適用または開始を止めます。既存の確認時刻を上書きしません。
- 再適用・同じ参加リクエストの再送で確認データは増えません。
- 受付期限切れで開始しなかった部屋に成功／失敗やWP増減は付けません。

## 適用手順

1. バックアップと現在のRPC定義を保存し、上記の事前確認を行う。
2. 検証用DBでSQL全体を実行し、2人以上の別アカウントで最後の参加による開始を確認する。
3. 共有DBで適用する間は、新規参加を止めてSQL全体を実行する。SQLは部屋・参加者・確認テーブルをロックするため、実行時間に注意する。
4. フェーズ3アプリを反映する。参加者全員が部屋画面から待機画面へ進むことを確認する。
5. `wp_waiting_room` を含めて動作確認した後、新規参加を再開する。

フェーズ2.5のSQLを後から再適用すると参加RPCがreadyまでの処理に戻ります。移行の順序を守ってください。

## 確認項目

- 定員未満ではwaiting・確認データ0件。
- 最後の参加でactive、参加者数×3件、全checked_atがNULL。
- 11:00起床なら締切は11:10・11:20・11:30。日付やタイムゾーンがずれない。
- 確認データ生成を意図的に失敗させる検証では、最後の参加追加もロールバックされる。
- 同時に最後の枠へ参加しても、1人だけ成功し定員を超えない（本物のPostgreSQLの別接続で確認）。
- 非参加者は待機情報を取得できず、authenticatedでも内部開始関数やテーブルを直接操作できない。
- 再送・再適用で重複しない。既存readyの移行で期限切れ・未同意を開始しない。

## 障害時

移行SQL途中の失敗は全体をロールバックします。成功後の問題は、新規参加を止め、対象のRPC・状態・確認データを調査してください。activeの部屋をwaitingへ戻したり、確認レコードを削除して巻き戻さないでください。DBとアプリの版を合わせて復旧します。

音の再生・起床確認の保存・結果判定・WP分配はこのSQLでは提供しません。
