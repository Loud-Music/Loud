import { Button } from "@animate-ui/react/primitives/buttons/button";
import type { LoudIcon } from "../icons";
export default function IconButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  className = "",
  disabled = false,
}: {
  icon: LoudIcon;
  label: string;
  onClick?: () => void;
  active?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Button
      className={`icon-button ${active ? "is-active" : ""} ${className}`}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={19} />
    </Button>
  );
}
