"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ICONS,
  ICON_LABELS,
  type Icon,
  type User,
  type Room,
  type RoomDetail,
} from "../lib/types";

type Screen = "welcome" | "register" | "home" | "create" | "join" | "room";
class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function api<T>(
  url: string,
  data?: object,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: data === undefined ? "GET" : "POST",
      headers:
        data === undefined ? undefined : { "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new RequestError(
      "接続できませんでした。通信状況を確認して再度お試しください。",
      0,
    );
  }
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new RequestError(
      result?.error?.message || "処理に失敗しました。もう一度お試しください。",
      response.status,
    );
  return result;
}

export default function PhaseTwo({
  screen,
  code = "",
}: {
  screen: Screen;
  code?: string;
}) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [nickname, setNickname] = useState("");
  const [icon, setIcon] = useState<Icon>("cat");
  const [group, setGroup] = useState("");
  const [count, setCount] = useState(4);
  const [roomCode, setRoomCode] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    let timer: ReturnType<typeof setTimeout>;
    setLoading(true);
    setError("");
    setUser(null);
    setDetail(null);
    setRooms([]);
    async function pollRoom() {
      try {
        const result = await api<RoomDetail>(
          `/api/rooms/${encodeURIComponent(code)}`,
          undefined,
          signal,
        );
        if (!signal.aborted) {
          setDetail(result);
          setError("");
        }
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof RequestError && err.status === 401) {
          router.replace("/register");
          return;
        }
        setError(
          err instanceof Error
            ? err.message
            : "部屋情報を取得できませんでした。",
        );
        if (err instanceof RequestError && [400, 403, 404].includes(err.status))
          return;
      } finally {
        if (!signal.aborted) setLoading(false);
      }
      if (!signal.aborted) timer = setTimeout(pollRoom, 5000);
    }
    async function load() {
      try {
        const result = await api<{ user: User }>(
          "/api/users",
          undefined,
          signal,
        );
        if (signal.aborted) return;
        setUser(result.user);
        if (screen === "register" || screen === "welcome") {
          router.replace("/home");
          return;
        }
        if (screen === "home") {
          const list = await api<{ rooms: Room[] }>(
            "/api/rooms",
            undefined,
            signal,
          );
          if (!signal.aborted) setRooms(list.rooms);
        }
        if (screen === "room") {
          await pollRoom();
          return;
        }
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof RequestError && err.status === 401) {
          if (screen !== "register" && screen !== "welcome")
            router.replace("/register");
        } else
          setError(
            err instanceof Error ? err.message : "読み込みに失敗しました。",
          );
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [screen, code, retry, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      if (screen === "register") {
        await api("/api/users", { nickname: nickname.trim(), icon });
        router.replace("/home");
      } else {
        const result =
          screen === "create"
            ? await api<{ room: Room }>("/api/rooms", {
                group_name: group.trim(),
                max_members: count,
              })
            : await api<{ room: Room }>(
                `/api/rooms/${encodeURIComponent(roomCode.trim().toUpperCase())}/join`,
                {},
              );
        router.push(`/room/${result.room.room_code}`);
      }
    } catch (err) {
      if (
        err instanceof RequestError &&
        err.status === 401 &&
        screen !== "register"
      )
        router.replace("/register");
      else
        setError(err instanceof Error ? err.message : "処理に失敗しました。");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const titles: Record<Screen, string> = {
    welcome: "早起きは三文の徳\n友達と賭ければ、なおお得。",
    register: "ユーザー登録",
    home: `${user?.nickname ?? ""}さん、おはよう。`,
    create: "WakePayを作成",
    join: "友達の部屋に参加",
    room: detail?.room.group_name || "部屋の準備中",
  };
  return (
    <main className="wp-shell">
      <header className="wp-header">
        <Link href="/" className="wp-logo">
          <span aria-hidden="true">☀</span> WakePay
        </Link>
        <span className="wp-tag">みんなで早起き</span>
      </header>
      {screen !== "welcome" && screen !== "home" && (
        <Link className="wp-back" href={screen === "register" ? "/" : "/home"}>
          ← {screen === "register" ? "トップへ" : "ホームへ"}
        </Link>
      )}
      <section className="wp-heading">
        <p className="wp-eyebrow">
          {screen === "welcome"
            ? ""
            : screen === "room"
              ? "YOUR WAKEPAY ROOM"
              : ""}
        </p>
        <h1>{titles[screen]}</h1>
      </section>
      {error && (
        <div className="wp-error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="wp-text-button"
            onClick={() => setRetry((value) => value + 1)}
            disabled={busy}
          >
            再読み込み
          </button>
          {screen === "room" && (
            <Link href="/join-room">部屋コードを入力する</Link>
          )}
        </div>
      )}
      {loading ? (
        <p className="wp-muted" role="status">
          読み込み中…
        </p>
      ) : (
        <>
          {screen === "welcome" && (
            <>
              <div className="wp-sun" aria-hidden="true">
                ☀
              </div>
              <Link href="/register" className="wp-primary">
                利用を開始する <span aria-hidden="true">→</span>
              </Link>
              <p className="wp-note">
                ニックネームとアイコンだけで始められます。
              </p>
              <div className="wp-card wp-steps">
                <p>
                  <b>01</b> 友達と部屋をつくる
                </p>
                <p>
                  <b>02</b> 起床時間とチャレンジを決める
                </p>
                <p>
                  <b>03</b> みんなで起きて、結果をシェア
                </p>
              </div>
              <Link className="wp-back" href="/alarm-demo">
                既存のアラームを試す →
              </Link>
            </>
          )}
          {screen === "register" && (
            <form className="wp-form" onSubmit={submit}>
              <p className="wp-muted">
                友達に表示されるプロフィールを決めましょう。
              </p>
              <label className="wp-label" htmlFor="nickname">
                ニックネーム <span>20文字以内</span>
              </label>
              <input
                id="nickname"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                required
                maxLength={20}
                placeholder="例：あさひ"
                autoComplete="nickname"
                disabled={busy}
              />
              <fieldset disabled={busy}>
                <legend className="wp-label">アイコンを選ぶ</legend>
                <div className="wp-icons">
                  {Object.entries(ICONS).map(([key, emoji]) => (
                    <label
                      key={key}
                      className={`wp-icon-option ${icon === key ? "selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name="icon"
                        value={key}
                        checked={icon === key}
                        onChange={() => setIcon(key as Icon)}
                        aria-label={ICON_LABELS[key as Icon]}
                      />
                      <span aria-hidden="true">{emoji}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <button
                className="wp-primary"
                disabled={busy || !nickname.trim()}
              >
                {busy ? "登録中…" : "登録してはじめる →"}
              </button>
              <p className="wp-note">
                このブラウザに登録情報を保持します。Cookieを削除すると、同じアカウントには戻れません。
              </p>
            </form>
          )}
          {screen === "home" && user && (
            <>
              <div className="wp-profile">
                <span aria-hidden="true">{ICONS[user.icon] || "☀"}</span>
                <p>友達と早起きの準備をしましょう。</p>
              </div>
              <Link className="wp-action" href="/create-room">
                <span className="wp-action-icon" aria-hidden="true">
                  ＋
                </span>
                <div>
                  <h2>WakePayを作成する</h2>
                  <p>新しい部屋に友達を招待</p>
                </div>
                <span aria-hidden="true">→</span>
              </Link>
              <Link className="wp-action" href="/join-room">
                <span className="wp-action-icon" aria-hidden="true">
                  ⌗
                </span>
                <div>
                  <h2>部屋コードで参加する</h2>
                  <p>友達から届いたコードを入力</p>
                </div>
                <span aria-hidden="true">→</span>
              </Link>
              <section className="wp-room-list">
                <h2>参加中のWakePay</h2>
                {rooms.length === 0 ? (
                  <p className="wp-muted">まだ参加中の部屋はありません。</p>
                ) : (
                  rooms.map((room) => (
                    <Link
                      href={`/room/${room.room_code}`}
                      className="wp-room-link"
                      key={room.id}
                    >
                      <strong>{room.group_name}</strong>
                      <span>{room.room_code} →</span>
                    </Link>
                  ))
                )}
              </section>
            </>
          )}
          {screen === "create" && user && (
            <form className="wp-form" onSubmit={submit}>
              <p className="wp-muted">
                部屋をつくって、明日一緒に起きる友達を招待しましょう。
              </p>
              <label className="wp-label" htmlFor="group">
                グループ名 <span>40文字以内</span>
              </label>
              <input
                id="group"
                value={group}
                onChange={(event) => setGroup(event.target.value)}
                required
                maxLength={40}
                placeholder="例：1限ぜったい間に合う会"
                disabled={busy}
              />
              <label className="wp-label" htmlFor="count">
                参加予定人数
              </label>
              <select
                id="count"
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
                disabled={busy}
              >
                {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n}人
                  </option>
                ))}
              </select>
              <p className="wp-note">
                あなたを含めた人数です。作成すると自動で参加します。
              </p>
              <button className="wp-primary" disabled={busy || !group.trim()}>
                {busy ? "作成中…" : "部屋を作成する →"}
              </button>
            </form>
          )}
          {screen === "join" && user && (
            <form className="wp-form" onSubmit={submit}>
              <p className="wp-muted">
                友達に教えてもらった6文字の部屋コードを入力してください。
              </p>
              <label className="wp-label" htmlFor="code">
                部屋コード
              </label>
              <input
                id="code"
                className="wp-code-input"
                value={roomCode}
                onChange={(event) =>
                  setRoomCode(
                    event.target.value.toUpperCase().replace(/\s/g, ""),
                  )
                }
                required
                pattern="[A-Za-z0-9]{6}"
                maxLength={6}
                placeholder="ABC123"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
              />
              <button
                className="wp-primary"
                disabled={busy || !/^[A-Z0-9]{6}$/.test(roomCode)}
              >
                {busy ? "参加中…" : "この部屋に参加する →"}
              </button>
            </form>
          )}
          {screen === "room" && detail && user && (
            <>
              <div className="wp-code-card">
                <p>友達にこのコードをシェア</p>
                <strong>{detail.room.room_code}</strong>
                <button
                  className="wp-secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        detail.room.room_code,
                      );
                      setCopied("コピーしました");
                    } catch {
                      setCopied(
                        "コピーできませんでした。コードを選択してコピーしてください。",
                      );
                    }
                  }}
                >
                  コードをコピー
                </button>
                <span className="wp-note" role="status">
                  {copied}
                </span>
              </div>
              <section className="wp-members">
                <div className="wp-section-title">
                  <h2>参加メンバー</h2>
                  <span>
                    {detail.members.length} / {detail.room.max_members}人
                  </span>
                </div>
                <ul>
                  {detail.members.map((member) => (
                    <li key={member.id}>
                      <span className="wp-avatar" aria-hidden="true">
                        {ICONS[member.user.icon] || "☀"}
                      </span>
                      <strong>
                        {member.user.nickname}
                        {member.user_id === user.id && (
                          <small>（あなた）</small>
                        )}
                      </strong>
                      {member.user_id === detail.room.creator_id && (
                        <span className="wp-badge">作成者</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
              <div className="wp-notice">
                <strong>
                  {detail.room.status !== "waiting"
                    ? "参加受付は終了しました"
                    : detail.members.length >= detail.room.max_members
                      ? "全員そろいました！"
                      : "友達の参加を待っています"}
                </strong>
                <p>
                  {detail.room.status !== "waiting"
                    ? "この部屋は次のステップに進んでいます。"
                    : detail.members.length >= detail.room.max_members
                      ? "起床時間の設定・承認は次のフェーズで追加予定です。"
                      : "部屋コードを共有して、みんなを招待しましょう。"}
                </p>
              </div>
              {detail.room.creator_id === user.id &&
                detail.members.length >= detail.room.max_members &&
                detail.room.status === "waiting" && (
                  <button className="wp-primary" disabled>
                    WakePayの設定（準備中）
                  </button>
                )}
              <p className="wp-note">参加状況は5秒おきに自動更新されます。</p>
            </>
          )}
        </>
      )}
      <footer className="wp-footer">WakePay · 早起きは、みんなで。</footer>
    </main>
  );
}
