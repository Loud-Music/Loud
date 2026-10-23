import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog } from "@animate-ui/react/primitives/radix-ui/dialog";
import { useMotionTokens } from "@animate-ui/react/utils/motion";

export default function ModalFrame({
  title,
  close,
  busy = false,
  className = "dialog",
  backdropClassName = "",
  children,
}: {
  title: string;
  close: () => void;
  busy?: boolean;
  className?: string;
  backdropClassName?: string;
  children: (dismiss: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const closing = useRef(close);
  closing.current = close;
  const { transition } = useMotionTokens();
  useEffect(() => {
    if (open) return;
    const timer = setTimeout(
      () => closing.current(),
      transition.dismiss.duration * 1000 + 32,
    );
    return () => clearTimeout(timer);
  }, [open, transition.dismiss.duration]);
  const dismiss = () => {
    if (!busy) setOpen(false);
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) dismiss();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={`modal-backdrop animate-modal ${backdropClassName}`}
          exitTransition={transition.dismiss}
        >
          <Dialog.Content
            className={className}
            aria-describedby={undefined}
            exitTransition={transition.dismiss}
            onEscapeKeyDown={(event) => {
              event.preventDefault();
              if (!document.querySelector('[role="listbox"], [role="menu"]'))
                dismiss();
            }}
            onPointerDownOutside={(event) => {
              if (busy) event.preventDefault();
            }}
          >
            <Dialog.Title className="visually-hidden">{title}</Dialog.Title>
            {children(dismiss)}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
