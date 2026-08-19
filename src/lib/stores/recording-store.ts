import { create } from "zustand";
import { api } from "@/lib/api/client";
import type { MonitorInfo, AudioDeviceInfo } from "@/lib/api/client";

export interface RecordingDevice {
  name: string;
  fullName: string;
  kind: "monitor" | "input" | "output";
  active: boolean;
  id?: number | string;
}

interface RecordingState {
  devices: RecordingDevice[];
  meetingActive: boolean;
  isGloballyPaused: boolean;
  elapsedSeconds: number;
  isConnected: boolean;
  framesCaptured: number;
  /** Last backend pause flag — used to detect transitions only */
  lastBackendPaused: boolean | null;
  /** Last backend audio flag — used to detect transitions only */
  lastBackendAudioRecording: boolean | null;
  syncFromBackend: () => Promise<void>;
  toggleDevice: (fullName: string) => void;
  toggleMeeting: () => Promise<void>;
  pauseAll: () => Promise<void>;
  resumeAll: () => Promise<void>;
  tick: () => void;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function buildDeviceList(
  monitors: MonitorInfo[],
  audio: AudioDeviceInfo[]
): RecordingDevice[] {
  const monitorDevices = monitors.map((m) => ({
    name: m.name.toLowerCase(),
    fullName: `monitor-${m.id}`,
    kind: "monitor" as const,
    active: true,
    id: m.id,
  }));

  const audioDevices = audio.map((d, i) => ({
    name: d.name.toLowerCase(),
    fullName: `audio-${d.device_type}-${slugify(d.name) || i}`,
    kind: d.device_type === "input" ? ("input" as const) : ("output" as const),
    active: d.device_type === "input" ? false : true,
  }));

  return [...monitorDevices, ...audioDevices];
}

/**
 * Merge refreshed device list with prior UI state.
 * Only applies backend-driven active changes when pause/audio flags actually transition.
 */
function mergeDevicesOnSync(
  nextDevices: RecordingDevice[],
  previous: RecordingDevice[],
  backend: { paused: boolean; audioRecording: boolean },
  lastBackend: { paused: boolean | null; audioRecording: boolean | null }
): RecordingDevice[] {
  if (nextDevices.length === 0) return previous;

  const prevActive = new Map(previous.map((d) => [d.fullName, d.active]));
  const audioChanged =
    lastBackend.audioRecording !== null &&
    backend.audioRecording !== lastBackend.audioRecording;
  const isFirstSync = lastBackend.paused === null;

  return nextDevices.map((device) => {
    const wasActive = prevActive.get(device.fullName);

    if (device.kind === "monitor") {
      return { ...device, active: !backend.paused };
    }

    if (device.kind === "input") {
      if (isFirstSync || audioChanged) {
        return { ...device, active: backend.audioRecording };
      }
      return { ...device, active: wasActive ?? backend.audioRecording };
    }

    return { ...device, active: wasActive ?? true };
  });
}

export const useRecordingStore = create<RecordingState>((set, get) => ({
  devices: [],
  meetingActive: false,
  isGloballyPaused: false,
  elapsedSeconds: 0,
  isConnected: false,
  framesCaptured: 0,
  lastBackendPaused: null,
  lastBackendAudioRecording: null,

  syncFromBackend: async () => {
    try {
      const [health, vision, audio, status] = await Promise.all([
        api.health(),
        api.visionList(),
        api.audioList(),
        api.engineStatus(),
      ]);

      const state = get();
      const nextDevices = buildDeviceList(vision.data, audio.data);
      const devices = mergeDevicesOnSync(
        nextDevices,
        state.devices,
        { paused: status.paused, audioRecording: status.audioRecording },
        {
          paused: state.lastBackendPaused,
          audioRecording: state.lastBackendAudioRecording,
        }
      );

      set({
        devices,
        isConnected: true,
        isGloballyPaused: status.paused,
        meetingActive: status.audioRecording,
        framesCaptured: health.frames_captured,
        elapsedSeconds: health.uptime_seconds,
        lastBackendPaused: status.paused,
        lastBackendAudioRecording: status.audioRecording,
      });
    } catch {
      set({ isConnected: false });
    }
  },

  toggleDevice: (fullName) => {
    const state = get();
    const device = state.devices.find((d) => d.fullName === fullName);
    if (!device) return;

    // Monitors mirror screen capture state — use pause all / resume all instead.
    if (device.kind === "monitor") return;

    const nextActive = !device.active;

    if (device.kind === "input") {
      set({
        devices: state.devices.map((d) =>
          d.fullName === fullName ? { ...d, active: nextActive } : d
        ),
        meetingActive: nextActive,
        lastBackendAudioRecording: nextActive,
      });

      void (async () => {
        try {
          if (nextActive) await api.audioStart();
          else await api.audioStop();
        } catch (err) {
          console.error("[recording] audio toggle failed:", err);
        }
      })();
      return;
    }

    set({
      devices: state.devices.map((d) =>
        d.fullName === fullName ? { ...d, active: nextActive } : d
      ),
    });
  },

  toggleMeeting: async () => {
    const { meetingActive, devices } = get();
    const nextActive = !meetingActive;
    try {
      if (nextActive) await api.audioStart();
      else await api.audioStop();

      set({
        meetingActive: nextActive,
        lastBackendAudioRecording: nextActive,
        devices: devices.map((d) =>
          d.kind === "input" ? { ...d, active: nextActive } : d
        ),
      });
    } catch (err) {
      console.error("[recording] meeting toggle failed:", err);
    }
  },

  pauseAll: async () => {
    try {
      await api.enginePause();
      set((state) => ({
        isGloballyPaused: true,
        lastBackendPaused: true,
        devices: state.devices.map((d) =>
          d.kind === "monitor" ? { ...d, active: false } : d
        ),
      }));
    } catch (err) {
      console.error("[recording] pause failed:", err);
    }
  },

  resumeAll: async () => {
    try {
      await api.engineResume();
      set((state) => ({
        isGloballyPaused: false,
        lastBackendPaused: false,
        devices: state.devices.map((d) =>
          d.kind === "monitor" ? { ...d, active: true } : d
        ),
      }));
    } catch (err) {
      console.error("[recording] resume failed:", err);
    }
  },

  tick: () => {
    void get().syncFromBackend();
  },
}));
