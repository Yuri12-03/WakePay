export class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T>(url: string, data?: object, signal?: AbortSignal): Promise<T> {
  // Bound reads (including response bodies) without aborting writes that may
  // already have committed. Callers can still cancel either kind on navigation.
  const timeout = data === undefined ? AbortSignal.timeout(20000) : undefined;
  const requestSignal = timeout ? (signal ? AbortSignal.any([signal, timeout]) : timeout) : signal;
  let response: Response;
  let result: any;
  try {
    response = await fetch(url, {
      method: data === undefined ? 'GET' : 'POST',
      headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data), cache: 'no-store', signal: requestSignal,
    });
    result = await response.json().catch(error => {
      if (requestSignal?.aborted) throw error;
      return null;
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout?.aborted) throw new RequestError('読み込みに時間がかかっています。接続を確認して再読み込みしてください。', 408);
    throw new RequestError('接続できませんでした。通信状況を確認して再度お試しください。', 0);
  }
  if (!response.ok) throw new RequestError(result?.error?.message || '処理に失敗しました。もう一度お試しください。', response.status);
  return result;
}
