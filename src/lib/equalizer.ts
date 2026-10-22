export const eqFrequencies = [
  32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
];
export interface EqualizerSettings {
  enabled: boolean;
  gains: number[];
  preset: string;
}
export const eqPresets: Record<string, { name: string; gains: number[] }> = {
  flat: { name: "Ровно", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bass: { name: "Больше баса", gains: [5, 4, 3, 1, 0, 0, 0, 0, 0, 0] },
  vocal: { name: "Вокал", gains: [-2, -2, -1, 0, 2, 3, 3, 2, 0, -1] },
  electronic: { name: "Электроника", gains: [4, 3, 1, 0, -1, 0, 2, 3, 3, 2] },
  rock: { name: "Рок", gains: [3, 2, 0, -1, -2, 1, 2, 3, 3, 2] },
  soft: { name: "Мягче", gains: [1, 1, 0, 0, 0, -1, -2, -3, -4, -5] },
};
export const defaultEqualizer = (): EqualizerSettings => ({
  enabled: false,
  gains: [...eqPresets.flat.gains],
  preset: "flat",
});
export function normalizeEqualizer(
  value: Partial<EqualizerSettings>,
): EqualizerSettings {
  return {
    enabled: value.enabled === true,
    preset: typeof value.preset === "string" ? value.preset : "custom",
    gains: eqFrequencies.map((_, i) =>
      Math.max(
        -12,
        Math.min(12, Number.isFinite(value.gains?.[i]) ? value.gains![i] : 0),
      ),
    ),
  };
}
function createEqualizerNodes(context: BaseAudioContext) {
  const input = context.createGain();
  const bands = eqFrequencies.map((frequency) => {
    const filter = context.createBiquadFilter();
    filter.type = "peaking";
    filter.frequency.value = Math.min(frequency, context.sampleRate * 0.47);
    filter.Q.value = 1.4;
    return filter;
  });
  let tail: AudioNode = input;
  for (const band of bands) {
    tail.connect(band);
    tail = band;
  }
  const output = context.createGain();
  tail.connect(output);
  const configure = (raw: EqualizerSettings) => {
    const settings = normalizeEqualizer(raw);
    const now = context.currentTime;
    bands.forEach((band, i) => {
      band.gain.cancelScheduledValues(now);
      band.gain.setTargetAtTime(
        settings.enabled ? settings.gains[i] : 0,
        now,
        0.025,
      );
    });
    const peak = settings.enabled ? Math.max(0, ...settings.gains) : 0;
    input.gain.cancelScheduledValues(now);
    input.gain.setTargetAtTime(Math.pow(10, -peak / 20), now, 0.025);
  };
  return { input, output, bands, configure };
}
export type EqualizerGraph = ReturnType<typeof createEqualizerNodes> & {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  analyser: AnalyserNode;
};
export function connectEqualizer(audio: HTMLAudioElement): EqualizerGraph {
  const context = new AudioContext();
  const nodes = createEqualizerNodes(context);
  const source = context.createMediaElementSource(audio);
  source.connect(nodes.input);
  nodes.output.connect(context.destination);
  const analyser = context.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0.25;
  nodes.output.connect(analyser);
  return { ...nodes, context, source, analyser };
}
