import { invoke } from "@tauri-apps/api/core";
import type { Track } from "./library";

interface GaplessResource {
  url: string;
  mime: string;
}
interface GaplessSegment {
  track: Track;
  offset: number;
  duration: number;
  complete: boolean;
}

export async function prepareGapless(track: Track): Promise<GaplessResource> {
  if (!track.src || track.streamType || !("__TAURI_INTERNALS__" in window))
    throw new Error("Gapless source is not ready");
  const mime =
    track.format === "FLAC"
      ? 'audio/mp4; codecs="flac"'
      : track.format === "AAC"
        ? 'audio/mp4; codecs="mp4a.40.2"'
        : 'audio/mp4; codecs="mp4a.6B"';
  if (!MediaSource.isTypeSupported(mime))
    throw new Error("Gapless codec is unavailable");
  const url = new URL(track.src);
  const path =
    url.protocol === "asset:" && url.hostname === "localhost"
      ? decodeURIComponent(url.pathname)
      : url.hostname === "asset.localhost"
        ? decodeURIComponent(url.pathname.slice(1))
        : undefined;
  const resource = await invoke<GaplessResource>("gapless_prepare", {
    src: track.src,
    path,
    format: track.format,
  });
  if (!MediaSource.isTypeSupported(resource.mime)) {
    void invoke("gapless_release", { url: resource.url });
    throw new Error("Gapless codec is unavailable");
  }
  return resource;
}

function idle(buffer: SourceBuffer): Promise<void> {
  if (!buffer.updating) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      buffer.removeEventListener("updateend", done);
      buffer.removeEventListener("error", fail);
      resolve();
    };
    const fail = () => {
      buffer.removeEventListener("updateend", done);
      buffer.removeEventListener("error", fail);
      reject(new Error("Unable to append gapless audio"));
    };
    buffer.addEventListener("updateend", done, { once: true });
    buffer.addEventListener("error", fail, { once: true });
  });
}

export class GaplessSession {
  readonly segments: GaplessSegment[] = [];
  readonly media = new MediaSource();
  private buffer?: SourceBuffer;
  private mime = "";
  private blob = "";
  private closed = false;
  private tail = Promise.resolve();
  private requests = new Set<AbortController>();
  private queuedId = "";
  private queueRevision = 0;
  private resources = new Set<string>();

  constructor(
    private audio: HTMLAudioElement,
    private failed: (error: unknown) => void,
  ) {}

  async start(track: Track, resource: GaplessResource) {
    this.blob = URL.createObjectURL(this.media);
    const open = new Promise<void>((resolve, reject) => {
      this.media.addEventListener("sourceopen", () => resolve(), {
        once: true,
      });
      this.media.addEventListener(
        "sourceclose",
        () => reject(new Error("Gapless stream closed")),
        { once: true },
      );
    });
    this.audio.src = this.blob;
    this.audio.load();
    await open;
    if (this.closed) return;
    this.mime = resource.mime;
    this.buffer = this.media.addSourceBuffer(resource.mime);
    this.buffer.mode = "segments";
    this.segments.push({
      track,
      offset: 0,
      duration: track.duration,
      complete: false,
    });
    this.tail = this.append(this.segments[0], resource);
    void this.tail.catch((error) => {
      if (!this.closed) this.failed(error);
    });
  }

  private async append(
    segment: GaplessSegment,
    resource: GaplessResource,
    revision?: number,
  ) {
    this.resources.add(resource.url);
    const controller = new AbortController();
    this.requests.add(controller);
    try {
      if (!this.buffer || this.closed) return;
      await idle(this.buffer);
      if (revision !== undefined && revision !== this.queueRevision) return;
      if (this.mime !== resource.mime) {
        this.buffer.changeType(resource.mime);
        this.mime = resource.mime;
      }
      this.buffer.timestampOffset = segment.offset;
      const response = await fetch(resource.url, { signal: controller.signal });
      if (!response.ok || !response.body)
        throw new Error("Unable to read gapless audio");
      const reader = response.body.getReader();
      while (!this.closed) {
        const { value, done } = await reader.read();
        if (done) break;
        if (
          revision !== undefined &&
          revision !== this.queueRevision &&
          this.audio.currentTime < segment.offset
        ) {
          await reader.cancel();
          return;
        }
        await idle(this.buffer);
        this.buffer.appendBuffer(value as Uint8Array<ArrayBuffer>);
        await idle(this.buffer);
      }
      if (this.closed) return;
      const ranges = this.buffer.buffered;
      if (!ranges.length) throw new Error("Gapless stream contained no audio");
      segment.duration = ranges.end(ranges.length - 1) - segment.offset;
      segment.complete = true;
      if (
        !(segment.duration > 0) ||
        Math.abs(segment.duration - segment.track.duration) > 3
      )
        throw new Error("Gapless source is a different recording");
    } finally {
      this.requests.delete(controller);
      this.resources.delete(resource.url);
      void invoke("gapless_release", { url: resource.url }).catch(() => {});
    }
  }

  enqueue(track: Track, resource: GaplessResource) {
    const active = this.active();
    if (
      this.closed ||
      !active ||
      this.queuedId === track.id ||
      active.track.id === track.id
    ) {
      void invoke("gapless_release", { url: resource.url }).catch(() => {});
      return;
    }
    this.queuedId = track.id;
    const revision = ++this.queueRevision;
    this.tail = this.tail
      .catch(() => {})
      .then(async () => {
        if (this.closed || revision !== this.queueRevision || !this.buffer) {
          void invoke("gapless_release", { url: resource.url }).catch(() => {});
          return;
        }
        const current = this.active();
        if (!current?.complete) return;
        const offset = current.offset + current.duration;
        await idle(this.buffer);
        if (
          current.offset > 2 &&
          this.buffer.buffered.length &&
          this.buffer.buffered.start(0) < current.offset - 2
        ) {
          this.buffer.remove(0, current.offset - 2);
          await idle(this.buffer);
        }
        if (
          this.buffer.buffered.length &&
          this.buffer.buffered.end(this.buffer.buffered.length - 1) >
            offset + 0.0001
        ) {
          this.buffer.remove(offset, Infinity);
          await idle(this.buffer);
        }
        const index = this.segments.indexOf(current);
        this.segments.splice(index + 1);
        const next = {
          track,
          offset,
          duration: track.duration,
          complete: false,
        };
        this.segments.push(next);
        await this.append(next, resource, revision);
      })
      .catch((error) => {
        this.queuedId = "";
        if (!this.closed && this.active()?.track.id === track.id)
          this.failed(error);
        else this.clearUpcoming();
      });
  }

  clearUpcoming() {
    this.queuedId = "";
    ++this.queueRevision;
    this.tail = this.tail
      .catch(() => {})
      .then(async () => {
        const active = this.active();
        if (this.closed || !active?.complete || !this.buffer) return;
        await idle(this.buffer);
        const end = active.offset + active.duration;
        if (
          this.buffer.buffered.length &&
          this.buffer.buffered.end(this.buffer.buffered.length - 1) >
            end + 0.0001
        ) {
          this.buffer.remove(end, Infinity);
          await idle(this.buffer);
        }
        this.segments.splice(this.segments.indexOf(active) + 1);
      });
  }

  active(): GaplessSegment | undefined {
    const position = this.audio.currentTime + 0.000001;
    for (let i = this.segments.length - 1; i >= 0; i--) {
      if (position >= this.segments[i].offset) return this.segments[i];
    }
    return undefined;
  }

  finishIfNeeded() {
    const active = this.active();
    if (
      !this.closed &&
      active?.complete &&
      active === this.segments.at(-1) &&
      this.audio.currentTime >= active.offset + active.duration - 0.03 &&
      this.media.readyState === "open" &&
      !this.buffer?.updating
    ) {
      this.media.endOfStream();
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    ++this.queueRevision;
    this.requests.forEach((request) => request.abort());
    this.resources.forEach(
      (url) => void invoke("gapless_release", { url }).catch(() => {}),
    );
    this.resources.clear();
    if (this.blob) URL.revokeObjectURL(this.blob);
  }
}
