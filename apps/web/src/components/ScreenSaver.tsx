import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const IDLE_MS = 5 * 60_000;

/** TV only: after 5 idle minutes in the menus, dim the screen with a drifting clock (prevents burn-in). Any key wakes it. */
export function ScreenSaver() {
  const { i18n } = useTranslation();
  const [on, setOn] = useState(false);
  const [now, setNow] = useState(new Date());
  const [pos, setPos] = useState({ x: 40, y: 40 });

  useEffect(() => {
    let timer = setTimeout(() => setOn(true), IDLE_MS);
    const wake = (e: Event) => {
      clearTimeout(timer);
      timer = setTimeout(() => setOn(true), IDLE_MS);
      setOn((was) => {
        if (was) {
          e.stopImmediatePropagation();
          e.preventDefault();
        }
        return false;
      });
    };
    for (const ev of ['keydown', 'pointerdown', 'pointermove', 'wheel']) addEventListener(ev, wake, true);
    return () => {
      clearTimeout(timer);
      for (const ev of ['keydown', 'pointerdown', 'pointermove', 'wheel']) removeEventListener(ev, wake, true);
    };
  }, []);

  useEffect(() => {
    if (!on) return;
    const iv = setInterval(() => {
      setNow(new Date());
      setPos({ x: 10 + Math.random() * 60, y: 10 + Math.random() * 60 });
    }, 20_000);
    return () => clearInterval(iv);
  }, [on]);

  if (!on) return null;
  return (
    <div className="fixed inset-0 z-[100] bg-black" data-testid="screensaver">
      <div className="absolute text-white/70 transition-all duration-[3000ms]" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
        <p className="text-7xl font-light tabular-nums">{now.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}</p>
        <p className="mt-2 text-xl">{now.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      </div>
    </div>
  );
}
