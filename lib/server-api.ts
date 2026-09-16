import { cookies } from 'next/headers';
import { ICONS } from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// This module is imported only by Route Handlers. Auth tokens never reach client props.
async function supabase(path: string, init: RequestInit = {}, token?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new ApiError(503, 'Supabaseの接続設定がありません。');
  let response: Response;
  try {
    response = await fetch(`${url.replace(/\/$/, '')}${path}`, {
      ...init, cache: 'no-store', signal: AbortSignal.timeout(15000),
      headers: { apikey: key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch { throw new ApiError(503, '接続できませんでした。少し待ってから再度お試しください。'); }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const known: Record<string, [number, string]> = {
      WP_UNAUTHORIZED: [401, '利用登録をしてください。'],
      WP_PROFILE_REQUIRED: [401, 'ニックネームとアイコンを登録してください。'],
      WP_ROOM_NOT_FOUND: [404, 'その部屋コードは見つかりませんでした。'],
      WP_NOT_MEMBER: [403, '部屋コードを入力して参加してください。'],
      WP_ROOM_FULL: [409, 'この部屋は満員です。'],
      WP_ROOM_CLOSED: [409, 'この部屋の参加受付は終了しています。'],
      WP_INVALID_INPUT: [400, '入力内容を確認してください。'],
    };
    if (known[data?.message]) throw new ApiError(...known[data.message]);
    if (data?.error_code === 'anonymous_provider_disabled') throw new ApiError(503, '登録の準備中です。Supabaseで匿名サインインを有効にしてください。');
    if (data?.code === 'PGRST202' || data?.code === '42501') throw new ApiError(503, 'データベースの準備中です。フェーズ2用SQLの適用を確認してください。');
    if (response.status === 401 || response.status === 403) throw new ApiError(401, 'セッションの有効期限が切れました。もう一度登録してください。');
    if (response.status === 429) throw new ApiError(429, '操作が集中しています。しばらく待ってからお試しください。');
    throw new ApiError(502, 'データを処理できませんでした。接続設定を確認して再度お試しください。');
  }
  return data;
}

type AuthSession = { access_token: string; refresh_token: string; user: { id: string } };
async function saveSession(session: AuthSession) {
  const jar = await cookies();
  const options = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: 60 * 60 * 24 * 30 };
  jar.set('wp_access', session.access_token, options);
  jar.set('wp_refresh', session.refresh_token, options);
}

export async function session(optional = false): Promise<{ token: string; userId: string } | null> {
  const jar = await cookies();
  const access = jar.get('wp_access')?.value;
  if (access) {
    try {
      const user = await supabase('/auth/v1/user', {}, access);
      return { token: access, userId: user.id };
    } catch (error) { if (!(error instanceof ApiError) || error.status !== 401) throw error; }
  }
  const refresh = jar.get('wp_refresh')?.value;
  if (refresh) {
    try {
      const next = await supabase('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: refresh }) }) as AuthSession;
      await saveSession(next);
      return { token: next.access_token, userId: next.user.id };
    } catch (error) {
      if (!(error instanceof ApiError) || ![401, 502].includes(error.status)) throw error;
      jar.delete('wp_access'); jar.delete('wp_refresh');
    }
  }
  if (optional) return null;
  throw new ApiError(401, 'まずは利用登録をしてください。');
}

export async function newSession() {
  const existing = await session(true);
  if (existing) return existing;
  const auth = await supabase('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ data: {} }) }) as AuthSession;
  await saveSession(auth);
  return { token: auth.access_token, userId: auth.user.id };
}

export async function rpc<T>(name: string, args: object, token: string): Promise<T> {
  return supabase(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(args) }, token);
}

export async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new ApiError(415, 'JSON形式で送信してください。');
  try {
    const value = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new ApiError(400, '送信内容を読み取れませんでした。'); }
}
export function textInput(value: unknown, max: number, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ApiError(400, `${label}は1〜${max}文字で入力してください。`);
  return value.trim();
}
export function iconInput(value: unknown) {
  if (typeof value !== 'string' || !Object.hasOwn(ICONS, value)) throw new ApiError(400, 'アイコンを選択してください。');
  return value;
}
export function roomCode(value: string) {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new ApiError(400, '部屋コードは半角英数字6文字で入力してください。');
  return code;
}

export function route(handler: (request: Request) => Promise<unknown>, status = 200) {
  return async (request: Request) => {
    try {
      const origin = request.headers.get('origin');
      if (request.method !== 'GET' && origin && origin !== new URL(request.url).origin) throw new ApiError(403, 'この送信元からは操作できません。');
      return Response.json(await handler(request), { status, headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      return Response.json({ error: { message: error instanceof ApiError ? error.message : '処理に失敗しました。もう一度お試しください。' } }, { status: error instanceof ApiError ? error.status : 500, headers: { 'Cache-Control': 'no-store' } });
    }
  };
}
