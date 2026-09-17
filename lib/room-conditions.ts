export const MIN_AMOUNT = 100;
export const MAX_AMOUNT = 2000;
export const MIN_WAKE_TIME = '00:00';
export const MAX_WAKE_TIME = '23:59';

export function japanDate(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function amountInput(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < MIN_AMOUNT || value > MAX_AMOUNT) {
    throw new Error('チャレンジ金額は100〜2000 WPの整数で入力してください。');
  }
  return value;
}

export function creationConditions(input: Record<string, unknown>, now = new Date()) {
  const amount = amountInput(input.challenge_amount);
  if (!isCalendarDate(input.wake_date)) throw new Error('起床日を正しい日付で選択してください。');
  const time = input.wake_time;
  if (typeof time !== 'string' || !/^\d{2}:[0-5]\d$/.test(time) || time < MIN_WAKE_TIME || time > MAX_WAKE_TIME) {
    throw new Error('起床時刻は00:00〜23:59の間で、1分単位で選択してください。');
  }
  const wakeAt = new Date(`${input.wake_date}T${time}:00+09:00`);
  if (wakeAt.getTime() <= now.getTime()) throw new Error('起床日時は現在より未来の日時を選択してください。');
  return { wake_date: input.wake_date, wake_time: time, challenge_amount: amount, wake_at: wakeAt.toISOString() };
}

// Accept timezone-bearing ISO timestamps only, so comparison never depends on
// the server or browser timezone. Supabase can return either UTC or an offset.
export function expectedConditions(input: Record<string, unknown>) {
  if (input.accepted !== true) throw new Error('部屋の条件を確認して、参加に同意してください。');
  const value = input.expected_conditions;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('部屋の条件をもう一度確認してください。');
  const expected = value as Record<string, unknown>;
  const stamp = expected.wake_at;
  if (typeof stamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(stamp) || !isCalendarDate(stamp.slice(0, 10)) || !Number.isFinite(Date.parse(stamp))) {
    throw new Error('部屋の起床日時をもう一度確認してください。');
  }
  return { wake_at: new Date(stamp).toISOString(), challenge_amount: amountInput(expected.challenge_amount) };
}

export function formatWakeAt(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return '未設定';
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
}
