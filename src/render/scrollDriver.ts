import type { RingReader } from "../audio/ringBuffer";
import { binWaveform, rmsBins } from "../dsp/waveformBinner";
import { mixToMono, type ChannelMode } from "../util/channelMix";
import { WaveformRenderer, type RenderColumn } from "./waveformRenderer";
import { colorForBands } from "./bandColor";
import type { BandSplitter } from "../dsp/bandSplit";

export interface DeckStreams {
  left: RingReader;
  right: RingReader | null;
  mode: ChannelMode;
  renderer: WaveformRenderer;
  delaySamples: number;
  gain: number; // linear display gain applied before binning; 1 = unity
  bands?: BandSplitter;
}

const SAMPLES_PER_COLUMN = 256; // ~5.3ms/column @ 48kHz; zoom knob lives here (M1)

/**
 * Advances one deck's scrolling waveform by however many whole columns of new
 * audio have arrived since the last call. `consumedHead` is the absolute
 * sample index (delay-adjusted) already drawn; returns the updated value.
 */
export function advanceDeck(
  stream: DeckStreams,
  consumedHead: number | null,
  scratchL: Float32Array,
  scratchR: Float32Array,
  maxColumns: number,
  samplesPerColumn: number = SAMPLES_PER_COLUMN,
): number {
  const written = stream.left.totalWritten();
  const head = written - stream.delaySamples;

  // On first frame (or after a delay jump), start near the head so we don't
  // try to redraw seconds of backlog at once.
  if (consumedHead === null || head - consumedHead > maxColumns * samplesPerColumn) {
    return head;
  }

  const avail = head - consumedHead;
  const columns = Math.min(maxColumns, Math.floor(avail / samplesPerColumn));
  if (columns <= 0) return consumedHead;

  const blockLen = columns * samplesPerColumn;
  const end = consumedHead + blockLen;
  const delayForBlock = written - end;

  const left = stream.left.readRecent(scratchL, blockLen, delayForBlock);
  const right = stream.right ? stream.right.readRecent(scratchR, blockLen, delayForBlock) : null;
  const mono = mixToMono(left.subarray(0, blockLen), right ? right.subarray(0, blockLen) : null, stream.mode, stream.gain);

  const bins: RenderColumn[] = binWaveform(mono, columns);
  if (stream.bands) {
    const { low, mid, high } = stream.bands.process(mono);
    const l = rmsBins(low, columns), m = rmsBins(mid, columns), h = rmsBins(high, columns);
    for (let i = 0; i < columns; i++) {
      const c = colorForBands(l[i]!, m[i]!, h[i]!);
      if (c) bins[i]!.color = c;
    }
  }
  stream.renderer.pushColumns(bins);
  return end;
}

export { SAMPLES_PER_COLUMN };
