import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ForwardRefExoticComponent,
  type ReactNode,
  type RefAttributes,
} from "react";
export type LoudIconProps = Omit<
  ComponentPropsWithoutRef<"svg">,
  "children"
> & { size?: number | string };
export type LoudIcon = ForwardRefExoticComponent<
  LoudIconProps & RefAttributes<SVGSVGElement>
>;
export function createIcon(name: string, drawing: ReactNode): LoudIcon {
  const Icon = forwardRef<SVGSVGElement, LoudIconProps>(function LoudSoftIcon(
    { size = 24, className, strokeWidth = 1.8, ...props },
    ref,
  ) {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={["loud-icon", `loud-icon-${name}`, className]
          .filter(Boolean)
          .join(" ")}
        data-loud-icon={name}
        aria-hidden={
          props["aria-label"] || props["aria-labelledby"] ? undefined : true
        }
        focusable="false"
        {...props}
      >
        {drawing}
      </svg>
    );
  });
  Icon.displayName = `LoudSoft(${name})`;
  return Icon;
}
