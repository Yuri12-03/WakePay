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
          <li key={a.id} style={{ marginBottom: "8px", fontSize: "18px" }}>
            <strong>{a.time}</strong> — {a.name}
            <button
              onClick={() => onDelete(a.id)}
              style={{ marginLeft: "12px" }}
            >
              削除
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
