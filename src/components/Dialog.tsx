import ModalFrame from "./ModalFrame";
import type { ReactNode } from "react";
import { X } from "../icons";
import IconButton from "./IconButton";
export default function Dialog({
  title,
  children: content,
  close,
  busy = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  busy?: boolean;
  className?: string;
}) {
  return (
    <ModalFrame
      title={title}
      close={close}
      busy={busy}
      className={`dialog ${className}`}
    >
      {(dismiss) => (
        <>
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
              onClick={dismiss}
              disabled={busy}
            />
          </div>
          <h2>{title}</h2>
          {content}
        </>
      )}
    </ModalFrame>
  );
}
