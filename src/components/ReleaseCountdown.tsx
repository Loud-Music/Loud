import { useEffect, useRef, useState } from "react";
import { Clock } from "../icons";
import { clearCatalogCache } from "../lib/catalogRequest";

export default function ReleaseCountdown({
  at,
  onAvailable,
}: {
  at?: string;
  onAvailable?: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const notified = useRef(false);
  const ready = useRef(onAvailable);
  ready.current = onAvailable;
  const target = at ? Date.parse(at) : NaN;
  useEffect(() => {
    notified.current = false;
  }, [at]);
  useEffect(() => {
    if (!Number.isFinite(target)) return;
    const update = () => {
      const value = Date.now();
      setNow(value);
      if (value >= target && !notified.current) {
        notified.current = true;
        clearCatalogCache(["loud"]);
        ready.current?.();
      }
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [target]);
  if (!Number.isFinite(target)) return null;
  const seconds = Math.max(0, Math.ceil((target - now) / 1000));
  const days = Math.floor(seconds / 86400),
    hours = Math.floor(seconds / 3600) % 24,
    minutes = Math.floor(seconds / 60) % 60;
  return (
    <div className="release-countdown">
      <Clock size={16} />
      <span>
        {seconds
          ? `До выхода ${days ? `${days} д ` : ""}${hours} ч ${minutes} мин ${seconds % 60} с`
          : "Релиз вышел — обновляем треки…"}
      </span>
    </div>
  );
}
