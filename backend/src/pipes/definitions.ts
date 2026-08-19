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
    name: "daily summary",
    description: "summarize your day every evening",
    schedule: "daily at 6pm",
    defaultInstalled: true,
    defaultEnabled: true,
  },
  {
    id: "meeting-recap",
    name: "meeting recap",
    description: "auto-generate meeting notes from transcripts",
    schedule: "every 15 minutes",
    defaultInstalled: true,
    defaultEnabled: true,
  },
  {
    id: "focus-tracker",
    name: "focus tracker",
    description: "track app usage and suggest focus blocks",
    schedule: "every 2 hours",
    defaultInstalled: false,
    defaultEnabled: false,
  },
  {
    id: "action-items",
    name: "action items",
    description: "extract todos from conversations",
    schedule: "hourly",
    defaultInstalled: false,
    defaultEnabled: false,
  },
];

export function getPipeDefinition(id: string): PipeDefinition | undefined {
  return BUILTIN_PIPES.find((pipe) => pipe.id === id);
}
