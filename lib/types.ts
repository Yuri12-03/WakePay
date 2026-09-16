export const ICONS = { cat: '🐱', dog: '🐶', rabbit: '🐰', panda: '🐼', bear: '🐻', fox: '🦊', koala: '🐨', penguin: '🐧' } as const;
export const ICON_LABELS = { cat: 'ねこ', dog: 'いぬ', rabbit: 'うさぎ', panda: 'パンダ', bear: 'くま', fox: 'きつね', koala: 'コアラ', penguin: 'ペンギン' } as const;
export type Icon = keyof typeof ICONS;
export type User = { id: string; nickname: string; icon: Icon; created_at: string };
export type Room = { id: string; room_code: string; group_name: string; max_members: number; creator_id: string; wake_time: string | null; challenge_amount: number | null; status: string; created_at: string };
export type Member = { id: string; user_id: string; approved: boolean; joined_at: string; user: User };
export type RoomDetail = { room: Room; members: Member[] };
