import { createRingBuffer, RingReader, type RingLayout } from "./ringBuffer";

const RING_SECONDS = 5; // history kept per channel; also the delay-comp headroom

export interface CaptureHandle {
  sampleRate: number;
  channelCount: number;
  readers: RingReader[];
  stop(): Promise<void>;
}

export interface CaptureRequest {
  deviceId?: string;
  requestedChannels: number;
}

/**
 * Open a multichannel input, disable all browser audio processing (which would
 * silently downmix to mono), and pump every channel into its own ring buffer.
 */
export async function startCapture(req: CaptureRequest): Promise<CaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: req.deviceId ? { exact: req.deviceId } : undefined,
      channelCount: { ideal: req.requestedChannels },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    } as MediaTrackConstraints,
    video: false,
  });

  const ctx = new AudioContext({ latencyHint: "interactive" });
  await ctx.audioWorklet.addModule(new URL("./capture-worklet.ts", import.meta.url));

  const source = ctx.createMediaStreamSource(stream);
  const channelCount = source.channelCount;
  const capacity = Math.ceil(ctx.sampleRate * RING_SECONDS);

  const layouts: RingLayout[] = [];
  const readers: RingReader[] = [];
  for (let i = 0; i < channelCount; i++) {
    const layout = createRingBuffer(capacity);
    layouts.push(layout);
    readers.push(new RingReader(layout));
  }

  const node = new AudioWorkletNode(ctx, "capture-processor", {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount,
    channelCountMode: "explicit",
    processorOptions: { layouts },
  });
  source.connect(node);

  return {
    sampleRate: ctx.sampleRate,
    channelCount,
    readers,
    async stop() {
      source.disconnect();
      node.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close();
    },
  };
}

export async function listInputDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "audioinput");
}

export { RING_SECONDS };
