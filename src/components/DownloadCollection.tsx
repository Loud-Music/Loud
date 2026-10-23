import { useState } from "react";
import { Button } from "@animate-ui/react/primitives/buttons/button";
import { Check, Download, Spinner } from "../icons";
import type { Track } from "../lib/library";
import type { OfflineGroup, OfflineJob } from "../lib/offlineStore";
import { errorMessage } from "../lib/errors";

export default function DownloadCollection({
  group,
  tracks,
  jobs,
  enqueue,
  open,
}: {
  group: OfflineGroup;
  tracks: Track[];
  jobs: Record<string, OfflineJob>;
  enqueue: (group: OfflineGroup, tracks: Track[]) => Promise<void>;
  open: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const done = tracks.filter(
    (track) => jobs[track.id]?.state === "done",
  ).length;
  const active = tracks.some((track) =>
    ["queued", "loading", "retry"].includes(jobs[track.id]?.state),
  );
  const complete = tracks.length > 0 && done === tracks.length;
  return (
    <span className="download-collection">
      <Button
        className="button button-subtle"
        disabled={!tracks.length || busy}
        onClick={async () => {
          if (complete || active) {
            open();
            return;
          }
          setBusy(true);
          setError("");
          try {
            await enqueue(group, tracks);
          } catch (cause) {
            setError(errorMessage(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        {complete ? (
          <Check size={16} />
        ) : active || busy ? (
          <Spinner size={16} className="spin" />
        ) : (
          <Download size={16} />
        )}
        {complete
          ? "Скачано"
          : active
            ? `Загрузка · ${done}/${tracks.length}`
            : done
              ? "Продолжить загрузку"
              : "Скачать всё"}
      </Button>
      {error && (
        <span className="download-collection-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
