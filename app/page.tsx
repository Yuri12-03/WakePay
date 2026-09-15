"use client";

import { useState } from "react";
import AlarmForm from "../components/AlarmForm";
import AlarmList from "../components/AlarmList";
import AlarmRinger from "../components/AlarmRinger";

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
    <main style={{ padding: "32px", maxWidth: "480px" }}>
      <h1>WakePay</h1>
      <p>早​起きは​三文の​得。​友達と​賭ければ、​な​おお得。​</p>
      <hr style={{ margin: "24px 0" }} />
      <AlarmForm onAdd={addAlarm} />
      <AlarmList alarms={alarms} onDelete={deleteAlarm} />
      <AlarmRinger alarms={alarms} />
    </main>
  );
}
