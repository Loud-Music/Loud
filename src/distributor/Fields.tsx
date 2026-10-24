import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@animate-ui/react/primitives/buttons/button";
import { Switch } from "@animate-ui/react/primitives/radix-ui/switch";
import { Upload, Spinner } from "../icons";
import { media, upload } from "./api";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="studio-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="studio-toggle">
      <label htmlFor={id}>{label}</label>
      <Switch.Root
        id={id}
        className="studio-switch"
        checked={checked}
        onCheckedChange={onChange}
      >
        <Switch.Thumb />
      </Switch.Root>
    </div>
  );
}
export function FileField({
  label,
  accept,
  value,
  onChange,
  onError,
  onBusy,
}: {
  label: string;
  accept: string;
  value?: string;
  onChange: (value: string) => void;
  onError: (value: string) => void;
  onBusy?: (value: boolean) => void;
}) {
  const id = useId();
  const [progress, setProgress] = useState<number>();
  const pending = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => pending.current?.abort(), []);
  const busy = progress !== undefined && progress < 100;
  return (
    <div className="studio-file">
      <span>{label}</span>
      <div>
        {value && accept.includes("image") && (
          <img src={media(value)} alt="Загруженное изображение" />
        )}
        <label
          className={`button button-subtle${busy ? " is-busy" : ""}`}
          htmlFor={id}
        >
          {busy ? <Spinner size={16} className="spin" /> : <Upload size={16} />}{" "}
          {busy
            ? `Загрузка ${progress}%`
            : value
              ? "Заменить файл"
              : "Выбрать файл"}
        </label>
        <input
          id={id}
          type="file"
          accept={accept}
          disabled={busy}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const limit = accept.includes("image") ? 8 : 200;
            if (file.size > limit * 1024 * 1024) {
              onError(`Файл должен быть меньше ${limit} МиБ.`);
              event.target.value = "";
              return;
            }
            onError("");
            setProgress(0);
            pending.current = new AbortController();
            onBusy?.(true);
            try {
              const result = await upload(
                file,
                setProgress,
                pending.current.signal,
              );
              onChange(result.path);
            } catch (error) {
              onError(String(error instanceof Error ? error.message : error));
              setProgress(undefined);
            } finally {
              onBusy?.(false);
              pending.current = undefined;
            }
            event.target.value = "";
          }}
        />
        {value && <small>Файл загружен</small>}
      </div>
      {busy && <progress value={progress} max="100" />}
    </div>
  );
}
export function Actions({
  busy,
  save,
  children,
}: {
  busy: boolean;
  save?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="studio-actions">
      {save && (
        <Button className="button button-accent" disabled={busy} onClick={save}>
          {busy ? <Spinner size={16} className="spin" /> : null}Сохранить
          изменения
        </Button>
      )}
      {children}
    </div>
  );
}
