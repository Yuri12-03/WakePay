import { formatWakeAt } from '../lib/room-conditions';

export default function RoomConditions({ wakeAt, amount }: { wakeAt: string | null; amount: number | null }) {
  return <dl className="wp-conditions">
    <div><dt>起床日時 <span>日本時間</span></dt><dd>{formatWakeAt(wakeAt)}</dd></div>
    <div><dt>チャレンジ金額 <span>1人あたり</span></dt><dd>{amount == null ? '未設定' : <>{amount.toLocaleString('ja-JP')} <small>WP</small></>}</dd></div>
  </dl>;
}
