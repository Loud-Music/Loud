import { useLayoutEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useMotionTokens } from "@animate-ui/react/utils/motion";

export default function ArtworkTransition({
  open,
  cover,
  source,
  destination,
  enabled,
}: {
  open: boolean;
  cover: string;
  source: RefObject<HTMLImageElement | null>;
  destination: RefObject<HTMLImageElement | null>;
  enabled: boolean;
}) {
  const image = useRef<HTMLImageElement>(null);
  const previous = useRef(open);
  const animation = useRef<Animation | undefined>(undefined);
  const hidden = useRef<{ element: HTMLElement; visibility: string }[]>([]);
  const { transition } = useMotionTokens();
  const duration =
    (open ? transition.sheet.duration : transition.collapse.duration) * 1000;

  const restore = () => {
    for (const { element, visibility } of hidden.current)
      element.style.visibility = visibility;
    hidden.current = [];
    if (image.current) image.current.style.visibility = "hidden";
  };

  useLayoutEffect(() => {
    const overlay = image.current;
    const changed = previous.current !== open;
    previous.current = open;
    const from = open ? source.current : destination.current;
    const to = open ? destination.current : source.current;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    if (!changed || !enabled || reduced.matches || !overlay || !from || !to) {
      animation.current?.cancel();
      animation.current = undefined;
      restore();
      return;
    }
    const start = animation.current
      ? overlay.getBoundingClientRect()
      : from.getBoundingClientRect();
    const end = to.getBoundingClientRect();
    const borderRadius = (element: HTMLElement) =>
      parseFloat(getComputedStyle(element).borderRadius) ||
      (element.parentElement
        ? parseFloat(getComputedStyle(element.parentElement).borderRadius)
        : 0);
    const startRadius = animation.current
      ? parseFloat(getComputedStyle(overlay).borderRadius) * (start.width / 512)
      : borderRadius(from);
    animation.current?.cancel();
    restore();
    if (!start.width || !end.width) return;
    const transform = (rect: DOMRect) =>
      `translate3d(${rect.left}px, ${rect.top}px, 0) scale(${rect.width / 512})`;
    const radius = (value: number, rect: DOMRect) =>
      `${(Number.isFinite(value) ? value : 0) / (rect.width / 512)}px`;
    const endRadius = radius(borderRadius(to), end);
    hidden.current = [from, to].map((element) => ({
      element,
      visibility: element.style.visibility,
    }));
    hidden.current.forEach(({ element }) => {
      element.style.visibility = "hidden";
    });
    overlay.style.transform = transform(end);
    overlay.style.borderRadius = endRadius;
    overlay.style.visibility = "visible";
    const flight = overlay.animate(
      [
        {
          transform: transform(start),
          borderRadius: radius(startRadius, start),
        },
        { transform: transform(end), borderRadius: endRadius },
      ],
      {
        duration,
        easing:
          getComputedStyle(document.documentElement)
            .getPropertyValue("--motion-ease")
            .trim() || "ease-out",
      },
    );
    animation.current = flight;
    flight.onfinish = () => {
      if (animation.current !== flight) return;
      animation.current = undefined;
      restore();
    };
  }, [open, cover, source, destination, enabled, duration]);

  useLayoutEffect(() => {
    const stop = () => {
      animation.current?.cancel();
      animation.current = undefined;
      restore();
    };
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => {
      if (reduced.matches) stop();
    };
    window.addEventListener("resize", stop);
    reduced.addEventListener("change", onMotion);
    return () => {
      window.removeEventListener("resize", stop);
      reduced.removeEventListener("change", onMotion);
      stop();
    };
  }, []);

  return createPortal(
    <img
      ref={image}
      src={cover}
      alt=""
      aria-hidden="true"
      className="artwork-transition"
    />,
    document.body,
  );
}
