"use client";

import { useState } from "react";
import AlarmForm from "../../components/AlarmForm";
import AlarmList from "../../components/AlarmList";
import AlarmRinger from "../../components/AlarmRinger";

type Alarm = {
  id: string;
  name: string;
  time: string;
};

export default function Home() {
  const [alarms, setAlarms] = useState<Alarm[]>([]);

  function addAlarm(name: string, time: string) {
    setAlarms([...alarms, { id: Date.now().toString(), name, time }]);
  }

  function deleteAlarm(id: string) {
    setAlarms(alarms.filter((a) => a.id !== id));
  }

  return (
    <main style={{ padding: "32px", maxWidth: "480px", margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: "32px" }}>
        <h1
          style={{
            fontFamily: "'Nunito', sans-serif",
            fontSize: "42px",
            fontWeight: 900,
            color: "#3B82F6",
            letterSpacing: "1px",
            marginBottom: "12px",
          }}
        >
          WakePay
        </h1>
        <p
          style={{
            fontFamily: "'Zen Maru Gothic', sans-serif",
            fontSize: "15px",
            color: "#2a2a2a",
            fontWeight: 500,
            lineHeight: 1.8,
          }}
        >
          早起きは三文の得。友達と賭ければ、なおお得。
        </p>
      </div>
      <hr
        style={{
          border: "none",
          borderTop: "1px solid #e0e0e0",
          margin: "0 0 24px",
        }}
      />
      <AlarmForm onAdd={addAlarm} />
      <AlarmList alarms={alarms} onDelete={deleteAlarm} />
      <AlarmRinger alarms={alarms} />
    </main>
  );
}
