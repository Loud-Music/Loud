import { Checkbox } from "@animate-ui/react/primitives/radix-ui/checkbox";
import { Check, Minus } from "../icons";
export default function CheckField({
  checked,
  onCheckedChange,
  disabled,
  ...label
}: {
  checked: boolean | "indeterminate";
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
        {checked === "indeterminate" ? (
          <Minus size={12} />
        ) : (
          <Check size={12} />
        )}
      </Checkbox.Indicator>
    </Checkbox.Root>
  );
}
