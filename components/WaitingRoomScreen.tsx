'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, RequestError } from '../lib/client-api';
import { formatWakeAt } from '../lib/room-conditions';
import type { WaitingRoom } from '../lib/types';
import RoomConditions from './RoomConditions';
import DemoResults from './DemoResults';

export default function WaitingRoomScreen({ code }: { code: string }) {
  const router = useRouter();
  const [data, setData] = useState<WaitingRoom | null>(null);
  const [now, setNow] = useState(0);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let clock: { server: number; received: number } | null = null;
    setData(null); setError(''); setNow(0);
    async function load() {
      try {
        const result = await api<WaitingRoom>(`/api/rooms/${encodeURIComponent(code)}/waiting`, undefined, controller.signal);
        if (controller.signal.aborted) return;
        if (!['active', 'finished'].includes(result.room.status)) {
          router.replace(`/room/${result.room.room_code}`);
          return;
        }
        clock = { server: Date.parse(result.server_now), received: performance.now() };
        setNow(clock.server); setData(result); setError('');
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof RequestError && err.status === 401) { router.replace('/register'); return; }
        setError(err instanceof Error ? err.message : '待機情報を取得できませんでした。');
        if (err instanceof RequestError && [400, 403, 404, 409].includes(err.status)) { setData(null); return; }
      }
      if (!controller.signal.aborted) timer = setTimeout(load, 5000);
    }
    const tick = setInterval(() => {
      if (clock) setNow(clock.server + performance.now() - clock.received);
    }, 1000);
    void load();
    return () => { controller.abort(); clearTimeout(timer); clearInterval(tick); };
  }, [code, retry, router]);

  const remaining = data?.room.wake_at ? Math.max(0, Math.ceil((Date.parse(data.room.wake_at) - now) / 1000)) : 0;
  const ended = data && (data.room.status === 'finished' || now >= Date.parse(data.checks[data.checks.length - 1]?.deadline));
  return <main className="wp-shell">
    <header className="wp-header"><Link href="/" className="wp-logo">☀ WakePay</Link><span className="wp-tag">みんなで早起き</span></header>
    <Link href="/home" className="wp-back">← ホームへ</Link>
    <section className="wp-heading"><p className="wp-eyebrow">起床までの待機</p><h1>{data?.room.group_name || 'WakePay'}</h1></section>
    {error && <div className="wp-error" role="alert"><p>{error}</p><button className="wp-text-button" onClick={() => setRetry(v => v + 1)}>再読み込み</button></div>}
    {!data && !error && <p className="wp-muted" role="status">読み込み中…</p>}
    {data && <>
      <div className="wp-notice"><strong>{ended ? '起床確認の予定時間が終了しました' : remaining > 0 ? '全員そろって、WakePayが開始しました' : '設定した起床時刻になりました'}</strong><p>部屋コード：{data.room.room_code}</p></div>
      <RoomConditions wakeAt={data.room.wake_at} amount={data.room.challenge_amount} />
      <DemoResults key={code} code={code} />
      {remaining > 0 && <section className="wp-card"><p className="wp-muted">起床まで（サーバー時刻を基準）</p><p className="wp-countdown">{Math.floor(remaining / 86400)}日 {Math.floor(remaining / 3600) % 24}時間 {Math.floor(remaining / 60) % 60}分 {remaining % 60}秒</p></section>}
      <section className="wp-schedule"><h2>あなたの起床確認の予定</h2><ol>{data.checks.map(check => <li key={check.check_number}><strong>{check.check_number}回目</strong><p>{formatWakeAt(check.opens_at)} から<br />{formatWakeAt(check.deadline)} より前まで</p></li>)}</ol></section>
      <div className="wp-notice"><strong>起床確認・アラーム機能は準備中です</strong><p>上のデモは自己申告による体験用です。実際のアラーム、3回の起床確認、起床結果の自動判定はまだ行いません。スマートフォンの通常のアラームを設定してください。</p></div>
      <p className="wp-note">日時はすべて日本時間です。待機情報は5秒おきに更新します。</p>
    </>}
    <footer className="wp-footer">WakePay · 早起きは、みんなで。</footer>
  </main>;
}
