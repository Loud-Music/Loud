import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type KeyboardEvent,
} from "react";
import type { Track } from "./library";

export default function useTrackSelection(list: Track[]) {
  const [ids, setIds] = useState(new Set<string>());
  const anchor = useRef<string | undefined>(undefined);
  const selected = useMemo(
    () => list.filter((track) => ids.has(track.id)),
    [list, ids],
  );
  useEffect(() => {
    const visible = new Set(list.map((track) => track.id));
    setIds((old) =>
      [...old].every((id) => visible.has(id))
        ? old
        : new Set([...old].filter((id) => visible.has(id))),
    );
  }, [list]);
  const clear = () => {
    setIds(new Set());
    anchor.current = undefined;
  };
  const all = () => {
    setIds(new Set(list.map((track) => track.id)));
  };
  const select = (
    id: string,
    modifiers: {
      shiftKey?: boolean;
      ctrlKey?: boolean;
      metaKey?: boolean;
    } = {},
  ) => {
    const additive = modifiers.ctrlKey || modifiers.metaKey;
    const index = list.findIndex((track) => track.id === id);
    const from = list.findIndex((track) => track.id === anchor.current);
    if (modifiers.shiftKey && from >= 0 && index >= 0) {
      const range = list
        .slice(Math.min(from, index), Math.max(from, index) + 1)
        .map((track) => track.id);
      setIds((old) => new Set([...(additive ? old : []), ...range]));
    } else {
      setIds((old) => {
        if (!additive) return new Set([id]);
        const next = new Set(old);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      anchor.current = id;
    }
  };
  const rowClick = (event: MouseEvent<HTMLElement>, id: string) => {
    if ((event.target as HTMLElement).closest("button, a, input, select"))
      return;
    select(id, event);
  };
  const capture = (event: MouseEvent<HTMLElement>, id: string) => {
    if (
      event.shiftKey ||
      ((event.ctrlKey || event.metaKey) &&
        !(event.target as HTMLElement).closest('[role="checkbox"]'))
    ) {
      event.preventDefault();
      event.stopPropagation();
      select(id, event);
    }
  };
  const keyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      event.stopPropagation();
      all();
    } else if (event.key === "Escape") {
      event.preventDefault();
      clear();
    } else if (event.target !== event.currentTarget) return;
    else if (event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      select(list[index].id, { ctrlKey: true, shiftKey: event.shiftKey });
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.max(
        0,
        Math.min(list.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)),
      );
      const rows = event.currentTarget
        .closest(".track-table")
        ?.querySelectorAll<HTMLElement>("[data-selection-row]");
      rows?.[next]?.focus();
      if (event.shiftKey)
        select(list[next].id, {
          shiftKey: true,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
        });
    }
  };
  return { selected, ids, select, clear, all, rowClick, capture, keyDown };
}
