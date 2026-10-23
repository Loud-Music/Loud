import type { CSSProperties } from "react";
import { Slider } from "@animate-ui/react/primitives/radix-ui/slider";
export default function RangeField({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  orientation = "horizontal",
  disabled,
  style,
  title,
  ...label
}: {
  value: number;
  onValueChange: (value: number) => void;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  orientation?: "horizontal" | "vertical";
  disabled?: boolean;
  style?: CSSProperties;
  title?: string;
  "aria-label"?: string;
  "aria-valuetext"?: string;
}) {
  return (
    <Slider.Root
      className="range-field"
      value={[value]}
      onValueChange={(values) => onValueChange(values[0])}
      min={Number(min)}
      max={Number(max)}
      step={Number(step)}
      orientation={orientation}
      disabled={disabled}
      style={style}
      title={title}
    >
      <Slider.Track className="range-track">
        <Slider.Range className="range-fill" />
      </Slider.Track>
      <Slider.Thumb className="range-thumb" {...label} />
    </Slider.Root>
  );
}
