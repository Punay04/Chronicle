export type PipeId =
  | "daily-summary"
  | "meeting-recap"
  | "focus-tracker"
  | "action-items";

export interface PipeDefinition {
  id: PipeId;
  name: string;
  description: string;
  schedule: string;
  defaultInstalled: boolean;
  defaultEnabled: boolean;
}

export const BUILTIN_PIPES: PipeDefinition[] = [
  {
    id: "daily-summary",
    name: "Daily Summary",
    description: "Summarize your day every evening",
    schedule: "Daily at 6pm",
    defaultInstalled: true,
    defaultEnabled: true,
  },
  {
    id: "meeting-recap",
    name: "Meeting Recap",
    description: "Turn recorded conversations into notes automatically",
    schedule: "Every 15 minutes",
    defaultInstalled: true,
    defaultEnabled: true,
  },
  {
    id: "focus-tracker",
    name: "Focus Tracker",
    description: "Track app usage and suggest focus blocks",
    schedule: "Every 2 hours",
    defaultInstalled: false,
    defaultEnabled: false,
  },
  {
    id: "action-items",
    name: "Action Items",
    description: "Extract to-dos from your conversations",
    schedule: "Hourly",
    defaultInstalled: false,
    defaultEnabled: false,
  },
];

export function getPipeDefinition(id: string): PipeDefinition | undefined {
  return BUILTIN_PIPES.find((pipe) => pipe.id === id);
}
