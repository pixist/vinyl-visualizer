# Vinyl Visualizer

Real-time, low-latency waveform visualizer for mixing on vinyl. Captures the
output of your turntables (via your audio interface) and draws a past-only
scrolling waveform per deck, stacked so you can compare decks while beatmatching.

This is **M0** — the capture → ring buffer → waveform foundation. BPM/beat-grid
detection, the 4-block bar indicator, and the predicted-beat line come next
(see Roadmap).

## Why web / how latency stays low

The app never outputs audio — your signal path stays turntable → mixer →
speakers. Latency only matters for *display*. Capture runs on the realtime audio
thread (an `AudioWorkletProcessor`) which does nothing but copy samples into
per-channel `SharedArrayBuffer` ring buffers; binning and rendering happen off
that thread. End-to-end display latency is ~25–35ms, well under the ~40–50ms
"feels live" threshold.

## Architecture

```
Audio interface (multichannel input)
   │  getUserMedia — echoCancellation/AGC/noiseSuppression OFF, channelCount ideal
   ▼
AudioWorklet (capture-processor)  ── writes each channel ──►  SharedArrayBuffer ring (one per channel)
                                                                   │
                                              main-thread rAF loop ─┤
                                              • read recent samples (delay-adjusted)
                                              • mix to mono per deck (stereo/mono-sum/L/R)
                                              • bin to columns (min/max/rms)
                                              • scroll Canvas 2D left, draw new columns
```

Key modules:

| File | Responsibility |
|------|----------------|
| `src/audio/ringBuffer.ts` | SPSC lock-free ring over `SharedArrayBuffer` (writer + reader, delay offset) |
| `src/audio/capture-worklet.ts` | Realtime thread: copies input channels into rings |
| `src/audio/captureManager.ts` | Opens multichannel input, wires the worklet |
| `src/dsp/waveformBinner.ts` | Reduces a sample window to per-column min/max/rms |
| `src/util/channelMix.ts` | Deck channel modes: `stereo` / `mono-sum` / `left` / `right` |
| `src/config/decks.ts` | Deck routing + per-deck delay, persisted to localStorage |
| `src/render/scrollDriver.ts` | Paces the scroll by whole columns of new audio |
| `src/render/waveformRenderer.ts` | Canvas 2D scroll + column draw |

## Delay compensation

Each deck has a 0–200ms delay slider. It's implemented as a read-pointer offset
into that deck's ring buffer — free, sample-accurate, and glitch-free — so you
can align two ADCs of different brands that clock in at different latencies.

## Run

```bash
npm install
npm run dev      # http://localhost:5173  (serves COOP/COEP for SharedArrayBuffer)
```

Then click **Start capture** and grant microphone permission (Chrome routes the
selected input device through the mic permission). Pick your interface from the
device dropdown.

### Testing with your hardware

- Each deck has its own **device dropdown** in its header — pick a different
  input per deck. This is the normal setup for two turntables on two separate
  USB ADCs: Deck A → ADC 1, Deck B → ADC 2.
- Each deck reads channels 0/1 of its chosen device by default (a stereo ADC).
  Change channels/mode in `src/config/decks.ts` for now (routing UI is M1).
- Alternatively, put both ADCs into one macOS **Aggregate Device** and select it
  on both decks, mapping Deck B to the aggregate's higher channels.
- Use the per-deck delay slider to align two ADCs that clock in at different
  latencies.
- Use the per-deck **gain** slider (±18 dB) to scale the display for quiet or
  hot signals. A turntable without a phono preamp arrives ~30–40 dB below line
  level; prefer fixing the hardware chain (phono preamp / PHONO switch on the
  ADC) and use gain for the remainder.

> **Chrome multichannel caveat:** all browser audio processing must be off or
> Chrome silently downmixes to mono. `captureManager.ts` already disables
> `echoCancellation`, `noiseSuppression`, and `autoGainControl`. If your interface
> still reports fewer channels than expected, that device/driver is the limit.

## Commands

```bash
npm test          # vitest unit tests (ring buffer, binner, mixing, config, scroll pacing)
npm run build     # tsc --noEmit + vite production build
```

## Roadmap

- **M1** — routing UI (stereo/mono/L/R per deck), 3-band frequency coloring, zoom levels
  (per-deck display gain shipped early)
- **M2** — BPM detection with drift tracking (spectral-flux onset → PLL beat tracker),
  4-block bar indicator, tap-1 / nudge downbeat controls
- **M3** — predicted-beat line, inter-deck phase-offset readout, optional Tauri packaging
