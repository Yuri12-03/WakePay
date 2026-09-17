'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, RequestError } from '../lib/client-api';
import { ICONS, type DemoResult } from '../lib/types';

export default function DemoResults({ code }: { code: string }) {
  const router = useRouter();
  const [data, setData] = useState<DemoResult | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [retry, setRetry] = useState(0);
  const version = useRef(0);
  const pending = useRef(false);
  const mounted = useRef(false);
  const url = `/api/rooms/${encodeURIComponent(code)}/demo`;

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      if (!pending.current) {
        const generation = version.current;
        try {
          const next = await api<DemoResult>(url, undefined, controller.signal);
          if (!controller.signal.aborted && generation === version.current) {
            setData(next); setError('');
          }
        } catch (err) {
          if (!controller.signal.aborted && generation === version.current) {
            if (err instanceof RequestError && err.status === 401) { router.replace('/register'); return; }
            setError(err instanceof Error ? err.message : 'デモを読み込めませんでした。');
            if (err instanceof RequestError && [403, 404, 409].includes(err.status)) setData(null);
          }
        }
      }
      if (!controller.signal.aborted) timer = setTimeout(load, 3000);
    }
    void load();
    return () => { mounted.current = false; controller.abort(); clearTimeout(timer); version.current++; };
  }, [url, retry, router]);

  useEffect(() => { setConfirmReset(false); }, [data?.round]);

  async function send(action: 'answer' | 'reset', success?: boolean) {
    if (!data || pending.current) return;
    pending.current = true; version.current++; setBusy(true); setMessage('');
    try {
      const next = await api<DemoResult>(url, { action, round: data.round, ...(action === 'answer' ? { success } : {}) });
      if (mounted.current) { setData(next); setError(''); setConfirmReset(false); }
    } catch (err) {
      if (mounted.current) {
        if (err instanceof RequestError && err.status === 401) router.replace('/register');
        setMessage(err instanceof Error ? err.message : '送信できませんでした。');
        setRetry(v => v + 1);
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const me = data?.members.find(m => m.user_id === data.user_id);
  return <section className="wp-demo" aria-label="起床結果デモ">
    <p className="wp-eyebrow">DEMO · 起床時刻を待たずに体験</p>
    <h2>起きられましたか？</h2>
    <p className="wp-muted">各自の端末で結果を選ぶと、全員の回答後にポイントを分配します。実際の起床判定とは別に、デモ結果を残高へ反映します。残高がマイナスでも参加できます。</p>
    {error && <div className="wp-error" role="alert"><p>{error}</p><button className="wp-text-button" onClick={() => setRetry(v => v + 1)}>デモを再読み込み</button></div>}
    {message && <p className="wp-error" role="alert">{message}</p>}
    {!data && !error && <p role="status">デモを読み込み中…</p>}
    {data && <>
      <p className="wp-demo-progress" role="status">デモ {data.round}回目 · 回答 {data.answered} / {data.total}人</p>
      {me?.success == null && !data.complete ? <div className="wp-demo-actions">
        <button className="wp-primary" disabled={busy || !!error} onClick={() => send('answer', true)}>起きられた</button>
        <button className="wp-secondary" disabled={busy || !!error} onClick={() => send('answer', false)}>起きられなかった</button>
      </div> : <p className="wp-note">あなたの回答：{me?.success ? '起きられた' : '起きられなかった'}。変更するには、作成者が結果をリセットしてください。</p>}
      <p className="wp-balance">あなたの残高：{typeof data.balance === 'number' ? `${data.balance.toLocaleString('ja-JP')} WP` : '取得できません（DB更新を確認）'}</p><section className="wp-demo-result" aria-label="デモ結果">
        <h3>{data.complete ? '結果とポイント分配' : 'みんなの回答を待っています'}</h3>
        {data.complete && <p className="wp-muted">{data.success_count === data.total ? '全員成功！ポイントの増減はありません。' : data.success_count === 0 ? '全員失敗のため、全員が設定ポイントを失い、分配はありません。' : `失敗者の合計 ${data.pool} WPを、成功者${data.success_count}人で分配します。`}</p>}
        {data.complete && data.balance_applied === false && <p className="wp-note">残高機能の導入前に確定した結果のため、残高には反映されていません。</p>}<ul>{data.members.map(member => <li key={member.user_id}>
          <div className="wp-demo-person"><span aria-hidden="true">{ICONS[member.icon] || '☀'}</span><strong>{member.nickname}{member.user_id === data.user_id && '（あなた）'}</strong></div>
          <div className="wp-demo-outcome"><span>{member.success === null ? '未回答' : member.success ? '起きられた' : '起きられなかった'}</span><b>{member.delta === null ? '分配未確定' : `${member.delta > 0 ? '+' : ''}${member.delta} WP`}</b></div>
        </li>)}</ul>
        <p className="wp-note">1人あたり {data.amount} WP。表示額はポイントの増減です。端数は最初に「起きられた」を送信した成功者へ加算します。同時刻の場合はユーザーID順で決定します。</p>
      </section>
      {data.can_reset ? <div className="wp-demo-reset">
        {confirmReset ? <><p>全員の回答をリセットし、この回で増減した残高も元に戻します。他の部屋の増減は残ります。続けますか？</p><button className="wp-secondary" disabled={busy} onClick={() => send('reset')}>全員の結果をリセットする</button><button className="wp-text-button" disabled={busy} onClick={() => setConfirmReset(false)}>やめる</button></> : <button className="wp-secondary" disabled={busy || !!error} onClick={() => setConfirmReset(true)}>結果をリセットする</button>}
      </div> : <p className="wp-note">やり直すときは部屋の作成者にリセットを依頼してください。</p>}
      <p className="wp-note">全員の端末へ約3秒ごとに反映します。</p>
    </>}
  </section>;
}