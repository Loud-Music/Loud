import type { ReactNode } from "react";
import { X } from "lucide-react";
import IconButton from "./IconButton";
export default function Dialog({
  title,
  children: content,
  close,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  busy?: boolean;
}) {
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) close();
      }}
    >
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const elements = Array.from(
            e.currentTarget.querySelectorAll<HTMLElement>(
              "button:not(:disabled),input,a[href]",
            ),
          );
          const first = elements[0],
            last = elements[elements.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="dialog-top">
          <img
            className="dialog-wordmark"
            src="/loud-logo.svg"
            alt="LOUD"
            width={84}
            height={26}
          />
          <IconButton
            icon={X}
            label="Закрыть окно"
            onClick={close}
            disabled={busy}
          />
        </div>
        <h2>{title}</h2>
        {content}
      </section>
    </div>
  );
}
