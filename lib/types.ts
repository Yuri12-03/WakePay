export const ICONS = { cat: '🐱', dog: '🐶', rabbit: '🐰', panda: '🐼', bear: '🐻', fox: '🦊', koala: '🐨', penguin: '🐧' } as const;
export const ICON_LABELS = { cat: 'ねこ', dog: 'いぬ', rabbit: 'うさぎ', panda: 'パンダ', bear: 'くま', fox: 'きつね', koala: 'コアラ', penguin: 'ペンギン' } as const;
export type Icon = keyof typeof ICONS;
export type User = { balance?: number; id: string; nickname: string; icon: Icon; created_at: string };
export type Room = { id: string; room_code: string; group_name: string; max_members: number; creator_id: string; wake_time: string | null; wake_at: string | null; challenge_amount: number | null; status: string; created_at: string };
export type Member = { id: string; user_id: string; approved: boolean; joined_at: string; user: User };
export type RoomDetail = { room: Room; members: Member[] };
export type WaitingRoom = {
  room: Room;
  checks: { check_number: number; opens_at: string; deadline: string }[];
  server_now: string;
};
export type UnavailableReason = 'full' | 'closed' | 'expired' | 'conditions_missing';
export type RoomPreview = {
  room: Pick<Room, 'room_code' | 'group_name' | 'max_members' | 'wake_at' | 'challenge_amount' | 'status'> & { member_count: number };
  is_member: boolean;
  can_join: boolean;
  unavailable_reason: UnavailableReason | null;
};

export type DemoResult = { balance?: number; balance_applied?: boolean;
  round: number; user_id: string; can_reset: boolean; complete: boolean;
  answered: number; total: number; amount: number; pool: number | null; success_count: number;
  members: { user_id: string; nickname: string; icon: Icon; success: boolean | null; delta: number | null }[];
};