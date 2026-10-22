import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { EqualizerGraph } from "../lib/equalizer";
import { waveFragment, waveVertex } from "../lib/waveShader";
import {
  coverPalette,
  neutralPalette,
  type CoverPalette,
} from "../lib/coverPalette";

interface Props {
  audioGraph: RefObject<EqualizerGraph | undefined>;
  playing: boolean;
  exclusive: boolean;
  nativeLevel: number;
  nativeBass: number;
  cover: string;
}

export default function WaveShader({
  audioGraph,
  playing,
  exclusive,
  nativeLevel,
  nativeBass,
  cover,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const signal = useRef({ playing, exclusive, nativeLevel, nativeBass });
  signal.current = { playing, exclusive, nativeLevel, nativeBass };
  const targetPalette = useRef<CoverPalette>(neutralPalette);
  const palette = useRef<CoverPalette>(
    neutralPalette.map((color) => [...color]) as CoverPalette,
  );
  const redraw = useRef<() => void>(() => {});
  const [generation, setGeneration] = useState(0);
  const [fallback, setFallback] = useState(false);
  const [fallbackColors, setFallbackColors] = useState(neutralPalette);

  useEffect(() => {
    let active = true;
    void coverPalette(cover).then(
      (colors) => {
        if (active) {
          targetPalette.current = colors;
          setFallbackColors(colors);
        }
      },
      () => {
        if (active) {
          targetPalette.current = neutralPalette;
          setFallbackColors(neutralPalette);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [cover]);

  useEffect(() => redraw.current(), [playing, exclusive, fallbackColors]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const gl = element.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: "low-power",
    });
    if (!gl) {
      setFallback(true);
      return;
    }
    const program = gl.createProgram();
    const buffer = gl.createBuffer();
    if (!program || !buffer) {
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
      setFallback(true);
      return;
    }
    const shaders: WebGLShader[] = [];
    function compile(kind: number, source: string) {
      const shader = gl!.createShader(kind);
      if (!shader) return false;
      shaders.push(shader);
      gl!.shaderSource(shader, source);
      gl!.compileShader(shader);
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) return false;
      gl!.attachShader(program!, shader);
      return true;
    }
    const dispose = () => {
      shaders.forEach((shader) => gl.deleteShader(shader));
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
    if (
      !compile(gl.VERTEX_SHADER, waveVertex) ||
      !compile(gl.FRAGMENT_SHADER, waveFragment)
    ) {
      dispose();
      setFallback(true);
      return;
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      dispose();
      setFallback(true);
      return;
    }
    setFallback(false);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniforms = {
      resolution: gl.getUniformLocation(program, "resolution"),
      time: gl.getUniformLocation(program, "time"),
      energy: gl.getUniformLocation(program, "energy"),
      bass: gl.getUniformLocation(program, "bass"),
      pulse: gl.getUniformLocation(program, "pulse"),
      palette: [0, 1, 2].map((index) =>
        gl.getUniformLocation(program, `palette${index}`),
      ),
    };
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const samples = new Float32Array(4096);
    const frequencies = new Float32Array(2048);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0,
      last = 0,
      clock = 0,
      energy = 0,
      bass = 0,
      previousBass = 0,
      averageBass = 0,
      pulse = 0;
    let visible = true,
      lost = false;
    const resize = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const scale = Math.min(
        devicePixelRatio || 1,
        1,
        960 / Math.max(1, width),
        Math.sqrt(320000 / Math.max(1, width * height)),
      );
      const nextWidth = Math.max(1, Math.round(width * scale));
      const nextHeight = Math.max(1, Math.round(height * scale));
      if (element.width === nextWidth && element.height === nextHeight) return;
      element.width = nextWidth;
      element.height = nextHeight;
      gl.viewport(0, 0, element.width, element.height);
      wake();
    });
    resize.observe(element);
    const draw = (now: number) => {
      frame = 0;
      if (lost || document.hidden || !visible) return;
      const dt = Math.min(last ? (now - last) / 1000 : 1 / 30, 0.1);
      last = now;
      let target = 0,
        low = 0;
      const state = signal.current;
      const analyser = audioGraph.current?.analyser;
      if (state.playing && !motion.matches && state.exclusive) {
        target = Math.min(1, Math.sqrt(state.nativeLevel) * 1.6);
        low = Math.min(1, state.nativeBass * 6);
      } else if (
        state.playing &&
        !motion.matches &&
        analyser &&
        audioGraph.current?.context.state === "running"
      ) {
        analyser.getFloatTimeDomainData(samples);
        let power = 0;
        for (const value of samples) power += value * value;
        target = Math.min(1, Math.sqrt(power / samples.length) * 3);
        analyser.getFloatFrequencyData(frequencies);
        const binHz = analyser.context.sampleRate / analyser.fftSize;
        let powerLow = 0;
        for (
          let i = Math.max(1, Math.ceil(25 / binHz));
          i <= Math.min(frequencies.length - 1, Math.floor(180 / binHz));
          i++
        )
          if (Number.isFinite(frequencies[i]))
            powerLow += 10 ** (frequencies[i] / 10);
        low = Math.min(1, Math.sqrt(powerLow) * 3.3);
      }
      const response = 1 - Math.exp(-dt / (target > energy ? 0.08 : 0.45));
      energy += (target - energy) * response;
      bass += (low - bass) * (1 - Math.exp(-dt / (low > bass ? 0.035 : 0.18)));
      averageBass += (low - averageBass) * (1 - Math.exp(-dt / 1.2));
      const onset =
        Math.max(0, low - previousBass - 0.025) * 3 +
        Math.max(0, low - averageBass * 1.1 - 0.06) * 0.6;
      pulse = Math.max(pulse * Math.exp(-dt / 0.22), Math.min(1, onset));
      previousBass = low;
      if (state.playing && !motion.matches)
        clock += dt * (0.7 + energy * 0.6 + bass * 1.25 + pulse * 0.6);
      let transitioning = energy > 0.003 || bass > 0.003 || pulse > 0.003;
      for (let color = 0; color < 3; color++) {
        for (let channel = 0; channel < 3; channel++) {
          if (
            Math.abs(
              targetPalette.current[color][channel] -
                palette.current[color][channel],
            ) > 0.003
          )
            transitioning = true;
          palette.current[color][channel] +=
            (targetPalette.current[color][channel] -
              palette.current[color][channel]) *
            (1 - Math.exp(-dt / 0.8));
        }
        gl.uniform3fv(uniforms.palette[color], palette.current[color]);
      }
      gl.uniform2f(uniforms.resolution, element.width, element.height);
      gl.uniform1f(uniforms.time, clock);
      gl.uniform1f(uniforms.energy, energy);
      gl.uniform1f(uniforms.bass, bass);
      gl.uniform1f(uniforms.pulse, motion.matches ? 0 : pulse);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if ((state.playing && !motion.matches) || transitioning) {
        timer = setTimeout(
          () => {
            timer = undefined;
            if (!lost && !document.hidden && visible)
              frame = requestAnimationFrame(draw);
          },
          Math.max(0, 1000 / 30 - (performance.now() - now) - 4),
        );
      }
    };
    const wake = () => {
      if (lost || document.hidden || !visible) {
        clearTimeout(timer);
        timer = undefined;
        cancelAnimationFrame(frame);
        frame = 0;
        return;
      }
      if (!frame && !timer) {
        last = 0;
        frame = requestAnimationFrame(draw);
      }
    };
    redraw.current = wake;
    const intersection = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      wake();
    });
    intersection.observe(element);
    const onLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      clearTimeout(timer);
      timer = undefined;
      cancelAnimationFrame(frame);
      frame = 0;
      setFallback(true);
    };
    const onRestored = () => setGeneration((value) => value + 1);
    element.addEventListener("webglcontextlost", onLost);
    element.addEventListener("webglcontextrestored", onRestored);
    document.addEventListener("visibilitychange", wake);
    motion.addEventListener("change", wake);
    wake();
    return () => {
      redraw.current = () => {};
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      resize.disconnect();
      intersection.disconnect();
      element.removeEventListener("webglcontextlost", onLost);
      element.removeEventListener("webglcontextrestored", onRestored);
      document.removeEventListener("visibilitychange", wake);
      motion.removeEventListener("change", wake);
      dispose();
    };
  }, [audioGraph, generation]);

  return (
    <div
      className={`wave-shader ${fallback ? "wave-shader-fallback" : ""}`}
      style={
        fallback
          ? {
              backgroundImage: `linear-gradient(140deg, ${fallbackColors.map((color) => `rgb(${color.map((value) => Math.round(value * 255)).join(" ")})`).join(", ")})`,
            }
          : undefined
      }
      aria-hidden="true"
    >
      <canvas ref={canvas} />
    </div>
  );
}
