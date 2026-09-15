"use client";

type Props = {
  onAdd: (name: string, time: string) => void;
};

import { useState } from "react";

export default function AlarmForm({ onAdd }: Props) {
  const [name, setName] = useState("");
  const [time, setTime] = useState("");

  return (
    <div style={{ marginBottom: "24px" }}>
      <h2>アラームを追加</h2>
      <input
        type="text"
        placeholder="アプリ名（例: 朝の準備）"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ marginRight: "8px", padding: "8px" }}
      />
      <input
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        style={{ marginRight: "8px", padding: "8px" }}
      />
      <button
        onClick={() => {
          if (time) {
            onAdd(name || "名前なし", time);
            setName("");
            setTime("");
          }
        }}
        style={{ padding: "8px 16px" }}
      >
        追加
      </button>
    </div>
  );
}
