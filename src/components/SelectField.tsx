import { Children, isValidElement, type ReactNode } from "react";
import { Select } from "@animate-ui/react/primitives/radix-ui/select";
import { Check, ChevronDown } from "../icons";

type Option = {
  value: string | number;
  disabled?: boolean;
  children?: ReactNode;
};
export default function SelectField({
  value,
  onValueChange,
  children,
  ...props
}: {
  value: string | number;
  onValueChange: (value: string) => void;
  children: ReactNode;
  id?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <Select.Root
      value={String(value)}
      onValueChange={onValueChange}
      disabled={props.disabled}
    >
      <Select.Trigger {...props} className="select-field">
        <Select.Value />
        <Select.Icon>
          <ChevronDown size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="select-menu"
          position="popper"
          sideOffset={6}
        >
          <Select.Viewport>
            {Children.toArray(children).map((child) =>
              isValidElement<Option>(child) ? (
                <Select.Item
                  className="select-option"
                  key={String(child.props.value)}
                  value={String(child.props.value)}
                  disabled={child.props.disabled}
                >
                  <Select.ItemText>{child.props.children}</Select.ItemText>
                  <Select.ItemIndicator className="select-check">
                    <Check size={14} />
                  </Select.ItemIndicator>
                </Select.Item>
              ) : null,
            )}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
