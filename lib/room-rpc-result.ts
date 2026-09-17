import type { Room } from './types';

// Production RPCs wrap the row in `room`; the repository SQL returns the row directly.
export function roomRpcResult(value: unknown): { room: Room } {
  const room = value && typeof value === 'object' && 'room' in value ? value.room : value;
  if (!room || typeof room !== 'object' || Array.isArray(room)
    || !('room_code' in room) || typeof room.room_code !== 'string'
    || !/^[A-Z0-9]{6}$/.test(room.room_code)
    || !('id' in room) || typeof room.id !== 'string' || !room.id) {
    throw new Error('部屋情報を読み取れませんでした。保存されている可能性があるため、ホームの参加中の部屋を確認してください。');
  }
  return { room: room as Room };
}
