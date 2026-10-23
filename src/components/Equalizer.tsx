import SelectField from "./SelectField";
import RangeField from "./RangeField";
import { Switch } from "@animate-ui/react/primitives/radix-ui/switch";
import { Button } from "@animate-ui/react/primitives/buttons/button";
import {
  eqFrequencies,
  eqPresets,
  type EqualizerSettings,
} from "../lib/equalizer";
export default function Equalizer({
  value,
  onChange,
}: {
  value: EqualizerSettings;
  onChange: (value: EqualizerSettings) => void;
}) {
  return (
    <section className="prefs-group equalizer-settings">
      <div className="eq-heading">
        <div>
          <h3>Эквалайзер</h3>
        </div>
        <Switch.Root
          type="button"

          aria-label="Эквалайзер"
          checked={value.enabled}
          className="prefs-switch"
          onCheckedChange={() =>
            onChange({ ...value, enabled: !value.enabled })
          }
        >
          <Switch.Thumb />
        </Switch.Root>
      </div>
      <div className="prefs-group-body eq-body">
        <div className="eq-toolbar">
          <label htmlFor="equalizer-preset">Пресет</label>
          <SelectField
            id="equalizer-preset"
            value={value.preset}
            onValueChange={(value) => {
              const preset = eqPresets[value];
              if (preset)
                onChange({
                  enabled: true,
                  preset: value,
                  gains: [...preset.gains],
                });
            }}
          >
            {Object.entries(eqPresets).map(([key, preset]) => (
              <option key={key} value={key}>
                {preset.name}
              </option>
            ))}
            <option value="custom" disabled>
              Свой
            </option>
          </SelectField>
          <Button
            className="prefs-button"
            onClick={() =>
              onChange({
                ...value,
                preset: "flat",
                gains: [...eqPresets.flat.gains],
              })
            }
          >
            Сбросить
          </Button>
        </div>
        <div className={`eq-bands ${value.enabled ? "" : "is-bypassed"}`}>
          <div className="eq-scale" aria-hidden="true">
            <span>+12 дБ</span>
            <span>0</span>
            <span>−12</span>
          </div>
          {eqFrequencies.map((frequency, index) => (
            <label className="eq-band" key={frequency}>
              <output>
                {value.gains[index] > 0 ? "+" : ""}
                {value.gains[index]}
              </output>
              <RangeField
                orientation="vertical"

                min={-12}
                max={12}
                step={1}
                value={value.gains[index]}
                aria-label={`Эквалайзер ${frequency} Гц`}
                aria-valuetext={`${value.gains[index]} дБ`}
                onValueChange={(gain) => {
                  const gains = [...value.gains];
                  gains[index] = gain;
                  onChange({ enabled: true, preset: "custom", gains });
                }}
              />
              <span>
                {frequency >= 1000 ? `${frequency / 1000}k` : frequency}
              </span>
            </label>
          ))}
        </div>
      </div>
      <p className="prefs-note">
        10 полос · ±12 дБ. Изменения слышны сразу. Усиление компенсируется
        запасом громкости. Эквалайзер использует системный вывод; для
        bit-perfect выключите его и включите эксклюзивный режим.
      </p>
    </section>
  );
}
