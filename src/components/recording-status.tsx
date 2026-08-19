import React from "react";
import { Monitor, MonitorOff, Mic, MicOff, Volume2, VolumeX, Phone, Pause, Play } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRecordingStore, type RecordingDevice } from "@/lib/stores/recording-store";

const KIND_ICONS: Record<
  RecordingDevice["kind"],
  { active: typeof Monitor; paused: typeof Monitor }
> = {
  monitor: { active: Monitor, paused: MonitorOff },
  input: { active: Mic, paused: MicOff },
  output: { active: Volume2, paused: VolumeX },
};

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

interface RecordingStatusProps {
  isTranslucent?: boolean;
  floatingOverMedia?: boolean;
}

export function RecordingStatus({ floatingOverMedia }: RecordingStatusProps) {
  const [open, setOpen] = React.useState(false);
  const {
    devices,
    meetingActive,
    isGloballyPaused,
    elapsedSeconds,
    toggleDevice,
    toggleMeeting,
    pauseAll,
    resumeAll,
  } = useRecordingStore();

  const monitorDevices = devices.filter((d) => d.kind === "monitor");
  const monitorsPaused = monitorDevices.length > 0 && monitorDevices.every((d) => !d.active);
  const isScreenPaused = isGloballyPaused || monitorsPaused;
  const summary =
    devices.length === 0
      ? "Not recording"
      : isScreenPaused
        ? "Paused"
        : "Recording";
  const label = meetingActive ? `${summary} · Meeting` : summary;
  const isActive = !isScreenPaused && devices.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-2 h-8 px-3 rounded-md text-xs font-medium transition-colors duration-150 border",
            floatingOverMedia
              ? "border-border/60 bg-background/80 backdrop-blur-sm"
              : "border-border bg-background hover:bg-accent"
          )}
        >
          <span
            className={cn(
              "w-2 h-2 rounded-full",
              isActive && "bg-foreground",
              isScreenPaused && devices.length > 0 && "bg-muted-foreground",
              devices.length === 0 && "bg-muted-foreground/40",
              meetingActive && isActive && "animate-pulse"
            )}
          />
          <span className="text-foreground">{label}</span>
          <span className="tabular-nums text-muted-foreground">{formatElapsed(elapsedSeconds)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="px-4 py-3 border-b border-border">
          <span className="text-sm font-medium text-foreground">Recording</span>
        </div>
        <div className="flex flex-col">
          {devices.map((device) => {
            const Icon = device.active
              ? KIND_ICONS[device.kind].active
              : KIND_ICONS[device.kind].paused;
            const isMonitor = device.kind === "monitor";
            return (
              <div
                key={device.fullName}
                className={cn(
                  "flex items-center justify-between px-4 py-2.5 text-sm",
                  !isMonitor && "hover:bg-accent transition-colors duration-150"
                )}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  <span>{device.name}</span>
                </div>
                {isMonitor ? (
                  <button
                    type="button"
                    onClick={() => (isScreenPaused ? resumeAll() : pauseAll())}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {device.active ? "On" : "Off"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleDevice(device.fullName)}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {device.active ? "On" : "Off"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="p-3 flex flex-col gap-2 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={isScreenPaused ? resumeAll : pauseAll}
          >
            {isScreenPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            {isScreenPaused ? "Resume all" : "Pause all"}
          </Button>
          <Button
            variant={meetingActive ? "default" : "outline"}
            size="sm"
            className="w-full gap-2"
            onClick={toggleMeeting}
          >
            <Phone className="w-3.5 h-3.5" />
            {meetingActive ? "Stop meeting notes" : "Start meeting notes"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
