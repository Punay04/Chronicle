import { api } from "@/lib/api/client";

export interface LiveVoiceHandlers {
  onReady?: () => void;
  onUserTranscript?: (text: string) => void;
  onAssistantTranscript?: (text: string) => void;
  onTurnComplete?: (user: string, assistant: string) => void;
  onInterrupted?: () => void;
  onError?: (message: string) => void;
  onClosed?: () => void;
}

const SETUP_TIMEOUT_MS = 20_000;

/** Snappy-style Constrained Live WebSocket URL. */
function buildLiveWebSocketUrl(ephemeralToken: string): string {
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(ephemeralToken)}`;
}

function floatTo16BitPCM(float32: Float32Array): Int16Array {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]!));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function downsampleTo16k(input: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === 16000) return input;
  const ratio = sourceRate / 16000;
  const newLength = Math.floor(input.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    result[i] = input[Math.floor(i * ratio)] ?? 0;
  }
  return result;
}

function int16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(
    samples.buffer,
    samples.byteOffset,
    samples.byteLength
  );
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

/**
 * Gemini Live voice — same methodology as Snappy:
 * 1) Backend mints ephemeral token + system instruction (with HydraDB context)
 * 2) Renderer opens BidiGenerateContentConstrained directly
 * 3) Model: models/gemini-3.1-flash-live-preview
 *
 * Do NOT seed prior assistant turns via clientContent — Live closes with 1007
 * when model-role turns are injected. History goes in the system instruction.
 */
export class LiveVoiceSession {
  private ws: WebSocket | null = null;
  private mediaStream: MediaStream | null = null;
  private captureCtx: AudioContext | null = null;
  private playbackCtx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private nextPlayTime = 0;
  private closed = false;
  private intentionalClose = false;
  private setupComplete = false;
  private userTranscript = "";
  private assistantTranscript = "";

  constructor(private readonly handlers: LiveVoiceHandlers = {}) {}

  get active(): boolean {
    return !this.closed && this.ws?.readyState === WebSocket.OPEN;
  }

  async start(params: {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    contextQuery?: string;
  }): Promise<void> {
    if (this.ws) throw new Error("live session already started");

    const session = await api.liveSession({
      messages: params.messages,
      context_query: params.contextQuery,
    });

    const model = session.model.startsWith("models/")
      ? session.model
      : `models/${session.model}`;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const setupTimer = window.setTimeout(() => {
        fail(new Error("Gemini Live setup timed out"));
        this.ws?.close();
      }, SETUP_TIMEOUT_MS);

      const ws = new WebSocket(buildLiveWebSocketUrl(session.token));
      ws.binaryType = "arraybuffer";
      this.ws = ws;

      ws.onopen = () => {
        // Client setup owns voice / modalities (token locks systemInstruction).
        // Keep setup minimal — extra fields have caused Live to reject sessions.
        ws.send(
          JSON.stringify({
            setup: {
              model,
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: session.voice || "Aoede",
                    },
                  },
                },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
          })
        );
      };

      ws.onmessage = (event) => {
        void this.handleMessage(event.data)
          .then(() => {
            if (this.setupComplete && !settled) {
              window.clearTimeout(setupTimer);
              void this.startMic()
                .then(() => {
                  this.handlers.onReady?.();
                  succeed();
                })
                .catch(fail);
            }
          })
          .catch((err) =>
            fail(err instanceof Error ? err : new Error(String(err)))
          );
      };

      ws.onerror = () => {
        window.clearTimeout(setupTimer);
        fail(new Error("Gemini Live websocket failed"));
      };

      ws.onclose = (event) => {
        window.clearTimeout(setupTimer);
        this.setupComplete = false;
        const reason =
          event.reason?.trim() ||
          (event.code ? `code ${event.code}` : "connection closed");
        if (!settled) {
          fail(new Error(`Gemini Live closed before ready (${reason})`));
          return;
        }
        void this.teardownMedia();
        if (!this.intentionalClose) {
          this.handlers.onError?.(
            `Live voice disconnected (${reason}). Tap Voice to reconnect.`
          );
        }
        this.handlers.onClosed?.();
      };
    });
  }

  stop(): void {
    this.intentionalClose = true;
    this.closed = true;
    this.setupComplete = false;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
    }
    this.ws = null;
    void this.teardownMedia();
  }

  private async handleMessage(rawData: unknown): Promise<void> {
    let parsed: Record<string, unknown>;
    try {
      if (rawData instanceof ArrayBuffer) {
        parsed = JSON.parse(new TextDecoder().decode(rawData)) as Record<
          string,
          unknown
        >;
      } else if (typeof rawData === "string") {
        parsed = JSON.parse(rawData) as Record<string, unknown>;
      } else if (rawData instanceof Blob) {
        parsed = JSON.parse(await rawData.text()) as Record<string, unknown>;
      } else {
        return;
      }
    } catch {
      return;
    }

    if (parsed.error != null) {
      const errorPayload = parsed.error as Record<string, unknown>;
      const message = String(
        errorPayload.message ?? errorPayload.status ?? "live error"
      );
      this.handlers.onError?.(message);
      return;
    }

    if (parsed.setupComplete != null) {
      this.setupComplete = true;
      return;
    }

    const serverContent = parsed.serverContent as
      | Record<string, unknown>
      | undefined;
    if (!serverContent) return;

    if (serverContent.interrupted) {
      this.assistantTranscript = "";
      this.nextPlayTime = this.playbackCtx?.currentTime ?? 0;
      this.handlers.onInterrupted?.();
    }

    const inputTranscription = serverContent.inputTranscription as
      | { text?: string }
      | undefined;
    if (inputTranscription?.text) {
      this.userTranscript += inputTranscription.text;
      this.handlers.onUserTranscript?.(this.userTranscript);
    }

    const outputTranscription = serverContent.outputTranscription as
      | { text?: string }
      | undefined;
    if (outputTranscription?.text) {
      this.assistantTranscript += outputTranscription.text;
      this.handlers.onAssistantTranscript?.(this.assistantTranscript);
    }

    const modelTurn = serverContent.modelTurn as
      | { parts?: Array<Record<string, unknown>> }
      | undefined;
    if (modelTurn?.parts) {
      for (const part of modelTurn.parts) {
        const inlineData = part.inlineData as
          | { data?: string; mimeType?: string }
          | undefined;
        if (inlineData?.data) {
          const mimeType = inlineData.mimeType ?? "";
          if (
            mimeType.includes("audio") ||
            mimeType.includes("pcm") ||
            mimeType === ""
          ) {
            this.enqueuePlayback(inlineData.data);
          }
        }
      }
    }

    if (serverContent.turnComplete) {
      const user = this.userTranscript.trim();
      const assistant = this.assistantTranscript.trim();
      this.handlers.onTurnComplete?.(user, assistant);
      this.userTranscript = "";
      this.assistantTranscript = "";
    }
  }

  private async startMic(): Promise<void> {
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.captureCtx = new AudioContext();
    const source = this.captureCtx.createMediaStreamSource(this.mediaStream);
    this.processor = this.captureCtx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) => {
      if (
        !this.ws ||
        this.ws.readyState !== WebSocket.OPEN ||
        !this.setupComplete
      ) {
        return;
      }
      const input = event.inputBuffer.getChannelData(0);
      const down = downsampleTo16k(input, this.captureCtx!.sampleRate);
      const pcm = floatTo16BitPCM(down);
      this.ws.send(
        JSON.stringify({
          realtimeInput: {
            audio: {
              data: int16ToBase64(pcm),
              mimeType: "audio/pcm;rate=16000",
            },
          },
        })
      );
    };

    source.connect(this.processor);
    const mute = this.captureCtx.createGain();
    mute.gain.value = 0;
    this.processor.connect(mute);
    mute.connect(this.captureCtx.destination);

    this.playbackCtx = new AudioContext({ sampleRate: 24000 });
    this.nextPlayTime = 0;
  }

  private enqueuePlayback(base64Pcm: string): void {
    if (!this.playbackCtx) {
      this.playbackCtx = new AudioContext({ sampleRate: 24000 });
      this.nextPlayTime = 0;
    }
    const ctx = this.playbackCtx;
    const samples = base64ToInt16(base64Pcm);
    const float32 = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      float32[i] = (samples[i] ?? 0) / 0x8000;
    }

    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const startAt = Math.max(ctx.currentTime, this.nextPlayTime);
    source.start(startAt);
    this.nextPlayTime = startAt + buffer.duration;
  }

  private async teardownMedia(): Promise<void> {
    try {
      this.processor?.disconnect();
    } catch {
      // ignore
    }
    this.processor = null;

    this.mediaStream?.getTracks().forEach((t) => t.stop());
    this.mediaStream = null;

    if (this.captureCtx && this.captureCtx.state !== "closed") {
      await this.captureCtx.close().catch(() => undefined);
    }
    this.captureCtx = null;

    if (this.playbackCtx && this.playbackCtx.state !== "closed") {
      await this.playbackCtx.close().catch(() => undefined);
    }
    this.playbackCtx = null;
    this.nextPlayTime = 0;
  }
}
