"use client";

type Alarm = {
  id: string;
  name: string;
  time: string;
};

type Props = {
  alarms: Alarm[];
  onDelete: (id: string) => void;
};

export default function AlarmList({ alarms, onDelete }: Props) {
  if (alarms.length === 0) {
    return <p>まだアラームがありません</p>;
  }

  return (
    <div>
      <h2>登録済みアラーム</h2>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {alarms.map((a) => (
          <li
            key={a.id}
            dir="ltr"
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "8px",
              marginBottom: "8px",
              fontSize: "18px",
            }}
          >
            <strong style={{ flexShrink: 0 }}>{a.time}</strong>
            <span aria-hidden="true">—</span>
            <bdi dir="auto" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
              {a.name}
            </bdi>
            <button
              onClick={() => onDelete(a.id)}
              style={{ flexShrink: 0 }}
            >
              削除
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
