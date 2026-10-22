import { Button } from "@animate-ui/react/primitives/buttons/button";
import type { LucideIcon } from "lucide-react";
export default function IconButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  className = "",
  disabled = false,
}: {
  icon: LucideIcon;
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
      <Icon size={19} strokeWidth={1.7} />
    </Button>
  );
}
