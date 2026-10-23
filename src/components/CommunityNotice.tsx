import { useEffect, useState } from "react";
import { persistentGet, persistentSet } from "../lib/persistence";
import { X } from "../icons";
import CommunityLinks from "./CommunityLinks";
import IconButton from "./IconButton";

const dismissedKey = "loud:community-invite:dismissed:v1";

export default function CommunityNotice({ enabled }: { enabled: boolean }) {
  const [dismissed, setDismissed] = useState(
    () => persistentGet(dismissedKey) === "true",
  );
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (dismissed || !enabled || visible) return;
    const timer = window.setTimeout(() => setVisible(true), 15000);
    return () => window.clearTimeout(timer);
  }, [dismissed, enabled, visible]);
  if (dismissed || !visible || !enabled) return null;
  return (
    <aside
      className="community-notice"
      aria-label="Поддержать LOUD"
      aria-live="polite"
    >
      <div className="community-notice-heading">
        <h2>Поддержать LOUD</h2>
        <IconButton
          icon={X}
          label="Больше не показывать приглашение"
          onClick={() => {
            setDismissed(true);
            persistentSet(dismissedKey, "true");
          }}
        />
      </div>
      <p>
        Заходите в наш канал за новостями и поддержите LOUD звездой на GitHub.
      </p>
      <CommunityLinks />
    </aside>
  );
}
