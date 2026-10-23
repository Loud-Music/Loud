import type { ComponentProps, ReactNode } from "react";
import * as SidebarPrimitive from "@animate-ui/react/primitives/sidebar";
import { Button } from "@animate-ui/react/primitives/buttons/button";
import { Dialog as Sheet } from "@animate-ui/react/primitives/radix-ui/dialog";
import { Tooltip } from "@animate-ui/react/primitives/radix-ui/tooltip";
import { SidebarCollapse, SidebarExpand, X } from "../../icons";
export const useSidebar = SidebarPrimitive.useSidebar;
export function SidebarProvider(
  props: ComponentProps<typeof SidebarPrimitive.Provider>,
) {
  return (
    <Tooltip.Provider delayDuration={300}>
      <SidebarPrimitive.Provider {...props} />
    </Tooltip.Provider>
  );
}
export function SidebarSurface({ children }: { children: ReactNode }) {
  const { state, isMobile, openMobile, setOpenMobile } = useSidebar();
  if (isMobile)
    return (
      <Sheet.Root open={openMobile} onOpenChange={setOpenMobile}>
        <Sheet.Portal>
          <Sheet.Overlay className="sidebar-sheet-overlay" />
          <Sheet.Content
            data-side="left"
            className="sidebar-sheet"
            aria-describedby={undefined}
          >
            <Sheet.Title className="visually-hidden">
              Навигация LOUD
            </Sheet.Title>
            <SidebarPrimitive.Highlight
              className="sidebar"
              data-slot="sidebar-inner"
            >
              <Button
                className="icon-button sidebar-sheet-close"
                aria-label="Закрыть меню"
                onClick={() => setOpenMobile(false)}
              >
                <X size={18} />
              </Button>
              {children}
            </SidebarPrimitive.Highlight>
          </Sheet.Content>
        </Sheet.Portal>
      </Sheet.Root>
    );
  return (
    <div
      className="sidebar-shell"
      data-state={state}
      data-collapsible={state === "collapsed" ? "icon" : ""}
      data-slot="sidebar"
    >
      <SidebarPrimitive.Gap className="sidebar-gap" />
      <SidebarPrimitive.Container className="sidebar-container">
        <SidebarPrimitive.Highlight
          className="sidebar"
          data-slot="sidebar-inner"
          role="complementary"
          aria-label="Навигация LOUD"
        >
          {children}
        </SidebarPrimitive.Highlight>
      </SidebarPrimitive.Container>
    </div>
  );
}
export function SidebarTrigger() {
  const { toggleSidebar, isMobile, open } = useSidebar();
  return (
    <Button
      className="icon-button sidebar-trigger"
      aria-label={
        isMobile ? "Открыть меню" : open ? "Свернуть меню" : "Развернуть меню"
      }
      onClick={toggleSidebar}
    >
      <SidebarPrimitive.TriggerIcon
        open={<SidebarCollapse size={18} />}
        closed={<SidebarExpand size={18} />}
      />
    </Button>
  );
}
export function SidebarMenuButton({
  label,
  active = false,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "asChild" | "children"> & {
  children: ReactNode;
  label: string;
  active?: boolean;
}) {
  const { state, isMobile } = useSidebar();
  return (
    <div className="sidebar-menu-item" data-slot="sidebar-menu-item">
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            {...props}
            data-sidebar="menu-button"
            data-active={active}
            aria-label={label}
          >
            {children}
          </Button>
        </Tooltip.Trigger>
        {state === "collapsed" && !isMobile && (
          <Tooltip.Portal>
            <Tooltip.Content
              className="sidebar-tooltip"
              side="right"
              sideOffset={12}
            >
              {label}
            </Tooltip.Content>
          </Tooltip.Portal>
        )}
      </Tooltip.Root>
    </div>
  );
}
