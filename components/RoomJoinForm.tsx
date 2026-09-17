'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, RequestError } from '../lib/client-api';
import type { Room, RoomPreview, UnavailableReason } from '../lib/types';
import RoomConditions from './RoomConditions';

const reasons: Record<UnavailableReason, string> = {
  full: 'この部屋は満員です。', closed: 'この部屋の参加受付は終了しています。',
  expired: '起床日時を過ぎているため、この部屋には参加できません。',
  conditions_missing: 'この部屋は条件が未設定です。新しい部屋を作成してもらってください。',
};

export default function RoomJoinForm() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<RoomPreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'join' | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now);
  const active = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const joining = useRef(false);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => { active.current?.abort(); sequence.current++; }, []);
  useEffect(() => {
    if (!preview) return;
    previewHeading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [preview]);

  function resetPreview(nextCode = code) {
    if (joining.current) return;
    active.current?.abort(); sequence.current++;
    setPreview(null); setError(''); setBusy(null); setCode(nextCode);
  }
  function handleError(err: unknown) {
    if (err instanceof RequestError && err.status === 401) router.replace('/register');
    else setError(err instanceof Error ? err.message : '処理に失敗しました。');
  }
  async function lookup(event: FormEvent) {
    event.preventDefault();
    if (joining.current) return;
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    const requestId = ++sequence.current;
    setBusy('preview'); setError(''); setPreview(null);
    try {
      const result = await api<RoomPreview>(`/api/rooms/${encodeURIComponent(code)}/preview`, undefined, controller.signal);
      if (sequence.current === requestId && !controller.signal.aborted) setPreview(result);
    } catch (err) {
      if (sequence.current === requestId && !controller.signal.aborted) handleError(err);
    } finally { if (sequence.current === requestId && !controller.signal.aborted) setBusy(null); }
  }
  const expired = !!preview?.room.wake_at && Date.parse(preview.room.wake_at) <= now;
  const reason = preview?.unavailable_reason === 'conditions_missing' ? 'conditions_missing' : expired ? 'expired' : preview?.unavailable_reason;
  const canJoin = preview?.can_join && !expired;
  async function join() {
    if (!preview || !canJoin || joining.current) return;
    joining.current = true; setBusy('join'); setError('');
    const controller = new AbortController(); active.current = controller;
    try {
      const { room } = await api<{ room: Room }>(`/api/rooms/${preview.room.room_code}/join`, {
        accepted: true, expected_conditions: { wake_at: preview.room.wake_at, challenge_amount: preview.room.challenge_amount },
      }, controller.signal);
      if (!controller.signal.aborted) router.push(`/room/${room.room_code}`);
    } catch (err) {
      if (!controller.signal.aborted) {
        handleError(err);
        if (err instanceof RequestError && [400, 403, 404, 409].includes(err.status)) setPreview(null);
      }
    } finally { joining.current = false; if (!controller.signal.aborted) setBusy(null); }
  }

  return <div>
    {!preview && <form className="wp-form" onSubmit={lookup}>
      <p className="wp-muted">部屋コードから条件を確認できます。確認するだけでは参加しません。</p>
      <label className="wp-label" htmlFor="code">部屋コード</label>
      <input id="code" className="wp-code-input" value={code} onChange={e => resetPreview(e.target.value.toUpperCase().replace(/\s/g, ''))} required pattern="[A-Za-z0-9]{6}" maxLength={6} placeholder="ABC123" autoCapitalize="characters" autoComplete="off" spellCheck={false} disabled={busy === 'join'} />
      <button className="wp-primary" disabled={busy !== null || !/^[A-Z0-9]{6}$/.test(code)}>{busy === 'preview' ? '確認中…' : '部屋の条件を確認する'}</button>
    </form>}
    {error && <p className="wp-error wp-join-error" role="alert">{error}</p>}
    {preview && <section className="wp-preview" aria-label="参加前の条件確認">
      <p className="wp-eyebrow">参加前にご確認ください</p>
      <h2 ref={previewHeading} tabIndex={-1}>{preview.room.group_name}</h2>
      <p className="wp-muted">参加者 {preview.room.member_count}人 / 定員 {preview.room.max_members}人</p>
      <RoomConditions wakeAt={preview.room.wake_at} amount={preview.room.challenge_amount} />
      {preview.is_member ? <><p className="wp-note">この部屋には参加済みです。</p><Link className="wp-primary" href={`/room/${preview.room.room_code}`}>部屋へ進む</Link><button type="button" className="wp-secondary wp-decline" onClick={() => resetPreview()}>部屋コードの入力に戻る</button></> : <>
        <p className="wp-note">作成後の条件変更はできません。参加すると、この日時と金額に同意したことになります。WPは架空のポイントです。</p>
        {reason && <p className="wp-error" role="status">{reasons[reason]}</p>}
        <button type="button" className="wp-primary" disabled={busy !== null || !canJoin} onClick={join}>{busy === 'join' ? '参加中…' : 'この条件で参加する'}</button>
        <button type="button" className="wp-secondary wp-decline" disabled={busy === 'join'} onClick={() => resetPreview()}>参加しない</button>
      </>}
    </section>}
  </div>;
}
