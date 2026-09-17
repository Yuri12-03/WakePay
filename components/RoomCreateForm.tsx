'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, RequestError } from '../lib/client-api';
import { creationConditions, japanDate } from '../lib/room-conditions';
import type { Room } from '../lib/types';
import RoomConditions from './RoomConditions';

export default function RoomCreateForm() {
  const router = useRouter();
  const [group, setGroup] = useState('');
  const [count, setCount] = useState(4);
  const [wakeDate, setWakeDate] = useState('');
  const [wakeTime, setWakeTime] = useState('');
  const [amount, setAmount] = useState('');
  const [today, setToday] = useState(() => japanDate());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  useEffect(() => {
    const timer = setInterval(() => setToday(japanDate()), 1000);
    return () => clearInterval(timer);
  }, []);
  let conditions: ReturnType<typeof creationConditions> | null = null;
  try { conditions = creationConditions({ wake_date: wakeDate, wake_time: wakeTime, challenge_amount: amount === '' ? null : Number(amount) }); } catch { /* Incomplete input has no preview. */ }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const validated = creationConditions({ wake_date: wakeDate, wake_time: wakeTime, challenge_amount: amount === '' ? null : Number(amount) });
      const { room } = await api<{ room: Room }>('/api/rooms', {
        group_name: group.trim(), max_members: count,
        wake_date: validated.wake_date, wake_time: validated.wake_time, challenge_amount: validated.challenge_amount,
      });
      router.push(`/room/${room.room_code}`);
    } catch (err) {
      if (err instanceof RequestError && err.status === 401) router.replace('/register');
      else setError(err instanceof Error ? err.message : '部屋を作成できませんでした。');
    } finally { submitting.current = false; setBusy(false); }
  }

  return <form className="wp-form" onSubmit={submit}>
    <p className="wp-muted">一緒に起きる日とチャレンジ金額を決めて、友達を招待しましょう。</p>
    <label className="wp-label" htmlFor="group">グループ名 <span>40文字以内</span></label>
    <input id="group" value={group} onChange={e => setGroup(e.target.value)} required maxLength={40} placeholder="例：1限ぜったい間に合う会" disabled={busy} />
    <label className="wp-label" htmlFor="count">参加予定人数</label>
    <select id="count" value={count} onChange={e => setCount(Number(e.target.value))} disabled={busy}>{[2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n}人</option>)}</select>
    <p className="wp-note">あなたを含めた人数です。</p>
    <label className="wp-label" htmlFor="wake-date">起床日 <span>日本時間</span></label>
    <input id="wake-date" type="date" min={today} max="9999-12-31" value={wakeDate} onChange={e => setWakeDate(e.target.value)} required disabled={busy} />
    <label className="wp-label" htmlFor="wake-time">起床時刻 <span>04:00〜11:00</span></label>
    <input id="wake-time" type="time" min="04:00" max="11:00" step={60} value={wakeTime} onChange={e => setWakeTime(e.target.value)} required disabled={busy} />
    <label className="wp-label" htmlFor="amount">チャレンジ金額 <span>100〜2000 WP</span></label>
    <input id="amount" type="number" inputMode="numeric" min={100} max={2000} step={1} value={amount} onChange={e => setAmount(e.target.value)} placeholder="例：500" required disabled={busy} />
    {conditions && <RoomConditions wakeAt={conditions.wake_at} amount={conditions.challenge_amount} />}
    <p className="wp-note">作成後は日付・時刻・金額を変更できません。あなたも、この条件で参加します。WPは架空のポイントです。</p>
    {error && <p className="wp-error" role="alert">{error}</p>}
    <button className="wp-primary" disabled={busy || !group.trim() || !wakeDate || !wakeTime || !amount}>{busy ? '作成中…' : 'この条件で部屋を作成して参加する'}</button>
  </form>;
}
