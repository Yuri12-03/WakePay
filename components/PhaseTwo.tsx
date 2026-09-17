'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ICONS, ICON_LABELS, type Icon, type User, type Room, type RoomDetail } from '../lib/types';

import { api, RequestError } from '../lib/client-api';
import RoomCreateForm from './RoomCreateForm';
import RoomJoinForm from './RoomJoinForm';
import RoomConditions from './RoomConditions';

type Screen = 'welcome' | 'register' | 'home' | 'create' | 'join' | 'room';
export default function PhaseTwo({ screen, code = '' }: { screen: Screen; code?: string }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [nickname, setNickname] = useState('');
  const [icon, setIcon] = useState<Icon>('cat');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    let timer: ReturnType<typeof setTimeout>;
    setLoading(true); setError(''); setUser(null); setDetail(null); setRooms([]);
    async function pollRoom() {
      try {
        const result = await api<RoomDetail>(`/api/rooms/${encodeURIComponent(code)}`, undefined, signal);
        if (!signal.aborted) {
          if (['active', 'finished'].includes(result.room.status)) {
            router.replace(`/room/${result.room.room_code}/waiting`);
            return;
          }
          setDetail(result); setError('');
        }
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof RequestError && err.status === 401) { router.replace('/register'); return; }
        setError(err instanceof Error ? err.message : '部屋情報を取得できませんでした。');
        if (err instanceof RequestError && [400, 403, 404].includes(err.status)) return;
      } finally { if (!signal.aborted) setLoading(false); }
      if (!signal.aborted) timer = setTimeout(pollRoom, 5000);
    }
    async function pollBalance() {
      try {
        const result = await api<{ user: User }>('/api/users', undefined, signal);
        if (!signal.aborted) { setUser(result.user); setError(''); }
      } catch (err) {
        if (!signal.aborted) {
          if (err instanceof RequestError && err.status === 401) { router.replace('/register'); return; }
          setError('残高を更新できませんでした。表示は最後に取得した残高です。');
        }
      }
      if (!signal.aborted) timer = setTimeout(pollBalance, 3000);
    }
    async function load() {
      try {
        const result = await api<{ user: User }>('/api/users', undefined, signal);
        if (signal.aborted) return;
        setUser(result.user);
        if (screen === 'register' || screen === 'welcome') { router.replace('/home'); return; }
        if (screen === 'home') {
          const list = await api<{ rooms: Room[] }>('/api/rooms', undefined, signal);
          if (!signal.aborted) { setRooms(list.rooms); timer = setTimeout(pollBalance, 3000); }
        }
        if (screen === 'room') { await pollRoom(); return; }
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof RequestError && err.status === 401) {
          if (screen !== 'register' && screen !== 'welcome') router.replace('/register');
        } else setError(err instanceof Error ? err.message : '読み込みに失敗しました。');
      } finally { if (!signal.aborted) setLoading(false); }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [screen, code, retry, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      if (screen === 'register') {
        await api('/api/users', { nickname: nickname.trim(), icon });
        router.replace('/home');
      }
    } catch (err) {
      if (err instanceof RequestError && err.status === 401 && screen !== 'register') router.replace('/register');
      else setError(err instanceof Error ? err.message : '処理に失敗しました。');
    } finally { submitting.current = false; setBusy(false); }
  }

  const titles: Record<Screen, string> = { welcome: '早起きは三文の徳\n友達と賭ければ、なおお得。', register: 'ユーザー登録', home: `${user?.nickname ?? ''}さん、おはよう。`, create: 'WakePayを作成', join: '友達の部屋に参加', room: detail?.room.group_name || '部屋の準備中' };
  return (
    <main className="wp-shell">
      <header className="wp-header"><Link href="/" className="wp-logo"><span aria-hidden="true">☀</span> WakePay</Link><span className="wp-tag">みんなで早起き</span></header>
      {screen !== 'welcome' && screen !== 'home' && <Link className="wp-back" href={screen === 'register' ? '/' : '/home'}>← {screen === 'register' ? 'トップへ' : 'ホームへ'}</Link>}
      <section className="wp-heading">{screen === 'room' && <p className="wp-eyebrow">YOUR WAKEPAY ROOM</p>}<h1>{titles[screen]}</h1></section>
      {error && <div className="wp-error" role="alert"><p>{error}</p><button type="button" className="wp-text-button" onClick={() => setRetry(value => value + 1)} disabled={busy}>再読み込み</button>{screen === 'room' && <Link href="/join-room">部屋コードを入力する</Link>}</div>}
      {loading && screen !== 'welcome' ? <p className="wp-muted" role="status">読み込み中…</p> : <>
        {screen === 'welcome' && <>
          <div className="wp-sun" aria-hidden="true">☀</div>
          <Link href="/register" className="wp-primary">利用を開始する <span aria-hidden="true">→</span></Link>
          <p className="wp-note">ニックネームとアイコンだけで始められます。</p>
          <div className="wp-card wp-steps"><p><b>01</b> 友達と部屋をつくる</p><p><b>02</b> 起床時間とチャレンジを決める</p><p><b>03</b> みんなで起きて、結果をシェア</p></div>
          <Link className="wp-back" href="/alarm-demo">既存のアラームを試す →</Link>
        </>}
        {screen === 'register' && <form className="wp-form" onSubmit={submit}>
          <p className="wp-muted">友達に表示されるプロフィールを決めましょう。</p>
          <label className="wp-label" htmlFor="nickname">ニックネーム <span>20文字以内</span></label>
          <input id="nickname" value={nickname} onChange={event => setNickname(event.target.value)} required maxLength={20} placeholder="例：あさひ" autoComplete="nickname" disabled={busy} />
          <fieldset disabled={busy}><legend className="wp-label">アイコンを選ぶ</legend><div className="wp-icons">{Object.entries(ICONS).map(([key, emoji]) => <label key={key} className={`wp-icon-option ${icon === key ? 'selected' : ''}`}><input type="radio" name="icon" value={key} checked={icon === key} onChange={() => setIcon(key as Icon)} aria-label={ICON_LABELS[key as Icon]} /><span aria-hidden="true">{emoji}</span></label>)}</div></fieldset>
          <button className="wp-primary" disabled={busy || !nickname.trim()}>{busy ? '登録中…' : '登録してはじめる →'}</button>
          <p className="wp-note">このブラウザに登録情報を保持します。Cookieを削除すると、同じアカウントには戻れません。</p>
        </form>}
        {screen === 'home' && user && <>
          <div className="wp-profile"><span aria-hidden="true">{ICONS[user.icon] || '☀'}</span><p>残高<br /><strong className="wp-balance">{typeof user.balance === 'number' ? `${user.balance.toLocaleString('ja-JP')} WP` : '取得できません（DB更新を確認）'}</strong></p></div>
          <Link className="wp-action" href="/create-room"><span className="wp-action-icon" aria-hidden="true">＋</span><div><h2>WakePayを作成する</h2><p>新しい部屋に友達を招待</p></div><span aria-hidden="true">→</span></Link>
          <Link className="wp-action" href="/join-room"><span className="wp-action-icon" aria-hidden="true">⌗</span><div><h2>部屋コードで参加する</h2><p>友達から届いたコードを入力</p></div><span aria-hidden="true">→</span></Link>
          <section className="wp-room-list"><h2>参加中のWakePay</h2>{rooms.length === 0 ? <p className="wp-muted">まだ参加中の部屋はありません。</p> : rooms.map(room => <Link href={`/room/${room.room_code}`} className="wp-room-link" key={room.id}><strong>{room.group_name}</strong><span>{room.room_code} →</span></Link>)}</section>
        </>}
        {screen === 'create' && user && <RoomCreateForm />}
        {screen === 'join' && user && <RoomJoinForm />}
        {screen === 'room' && detail && user && <>
          <RoomConditions wakeAt={detail.room.wake_at} amount={detail.room.challenge_amount} />
          <div className="wp-code-card"><p>友達にこのコードをシェア</p><strong>{detail.room.room_code}</strong><button className="wp-secondary" onClick={async () => { try { await navigator.clipboard.writeText(detail.room.room_code); setCopied('コピーしました'); } catch { setCopied('コピーできませんでした。コードを選択してコピーしてください。'); } }}>コードをコピー</button><span className="wp-note" role="status">{copied}</span></div>
          <section className="wp-members"><div className="wp-section-title"><h2>参加メンバー</h2><span>{detail.members.length} / {detail.room.max_members}人</span></div><ul>{detail.members.map(member => <li key={member.id}><span className="wp-avatar" aria-hidden="true">{ICONS[member.user.icon] || '☀'}</span><strong>{member.user.nickname}{member.user_id === user.id && <small>（あなた）</small>}</strong>{member.user_id === detail.room.creator_id && <span className="wp-badge">作成者</span>}</li>)}</ul></section>
          <div className="wp-notice"><strong>{!detail.room.wake_at ? '条件が未設定の部屋です' : detail.room.status === 'ready' ? '全員そろいました！' : detail.room.status !== 'waiting' ? '参加受付は終了しました' : Date.parse(detail.room.wake_at) <= Date.now() ? '参加受付の期限を過ぎました' : '友達の参加を待っています'}</strong><p>{!detail.room.wake_at ? '新しく条件を決めて、別の部屋を作成してください。この部屋の条件は変更できません。' : detail.room.status === 'ready' ? '全員の参加と同意は完了していますが、開始が完了していません。管理担当者に確認してください。' : detail.room.status !== 'waiting' ? 'この部屋の参加受付は終了しています。' : Date.parse(detail.room.wake_at) <= Date.now() ? '人数がそろわなかったため、チャレンジは成立していません。WPの増減はありません。' : '部屋コードを共有して、みんなを招待しましょう。'}</p></div>
          <p className="wp-note">参加状況は5秒おきに自動更新されます。</p>
        </>}
      </>}
      <footer className="wp-footer">WakePay · 早起きは、みんなで。</footer>
    </main>
  );
}
