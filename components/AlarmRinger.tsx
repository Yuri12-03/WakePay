"use client";

import { useEffect, useRef } from "react";

type Alarm = {
  id: string;
  name: string;
  time: string;
};

type Props = {
  alarms: Alarm[];
};

export default function AlarmRinger({ alarms }: Props) {
  const firedRef = useRef<Set<string>>(new Set());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const showingRef = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const current = `${hh}:${mm}`;

      alarms.forEach((a) => {
        const key = a.id + "_" + current;
        if (
          a.time === current &&
          !firedRef.current.has(key) &&
          !showingRef.current
        ) {
          firedRef.current.add(key);
          showingRef.current = true;
          ringAlarm(a.name, a.time);
        }
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [alarms]);

  function beep() {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  function ringAlarm(name: string, time: string) {
    beep();
    intervalRef.current = setInterval(beep, 900);
    alert(`⏰ ${time}\n${name}`);
    if (intervalRef.current) clearInterval(intervalRef.current);
    showingRef.current = false;
  }

  return null;
}
