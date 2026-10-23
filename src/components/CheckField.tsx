import { Checkbox } from "@animate-ui/react/primitives/radix-ui/checkbox";
import { Check } from "../icons";
export default function CheckField({
  checked,
  onCheckedChange,
  disabled,
  ...label
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <Checkbox.Root
      className="check-field"
      checked={checked}
      onCheckedChange={(value) => onCheckedChange(value === true)}
      disabled={disabled}
      {...label}
    >
      <Checkbox.Indicator className="check-indicator">
        <Check size={12} />
      </Checkbox.Indicator>
    </Checkbox.Root>
  );
}
