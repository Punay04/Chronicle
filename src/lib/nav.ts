import type React from "react";
import {
  Blocks,
  Brain,
  Clock,
  HardDrive,
  Keyboard,
  Layout,
  LifeBuoy,
  MessageSquare,
  NotebookPen,
  Settings as SettingsIcon,
  Shield,
  Sparkles,
  Video,
  Workflow,
} from "lucide-react";

/**
 * The single source of navigation labels for the whole app.
 *
 * `id` values are written into the URL (`?section=…`) and into persisted state,
 * so they are deliberately NOT renamed when a label changes — only `label` and
 * `description` are user-facing. `HomePage` still redirects the legacy
 * `section=pipes` id for the same reason.
 */

export type MainSection =
  | "home"
  | "timeline"
  | "workflows"
  | "meetings"
  | "brain"
  | "connections"
  | "help";

export interface NavItem<Id extends string> {
  id: Id;
  label: string;
  description: string;
  icon: React.ElementType;
}

export const MAIN_NAV: NavItem<MainSection>[] = [
  {
    id: "home",
    label: "Assistant",
    description: "Ask anything about what you have captured",
    icon: MessageSquare,
  },
  {
    id: "timeline",
    label: "History",
    description: "Every screen snapshot Chronicle has taken",
    icon: Clock,
  },
  {
    id: "workflows",
    label: "Routines",
    description: "Scheduled automations over your captured context",
    icon: Workflow,
  },
  {
    id: "meetings",
    label: "Recordings",
    description: "Recorded conversations, transcripts, and notes",
    icon: NotebookPen,
  },
  {
    id: "brain",
    label: "Memory",
    description: "The graph of what Chronicle remembers",
    icon: Brain,
  },
  {
    id: "connections",
    label: "Integrations",
    description: "Third-party apps connected through Composio",
    icon: Blocks,
  },
  {
    id: "help",
    label: "Support",
    description: "Get help or send feedback",
    icon: LifeBuoy,
  },
];

export const SETTINGS_LABEL = "Preferences";
export const SETTINGS_ICON = SettingsIcon;

export type SettingsSection =
  | "display"
  | "general"
  | "recording"
  | "ai"
  | "shortcuts"
  | "privacy"
  | "storage";

export interface NavGroup {
  label: string;
  items: NavItem<SettingsSection>[];
}

export const SETTINGS_NAV: NavGroup[] = [
  {
    label: "App",
    items: [
      {
        id: "display",
        label: "Display",
        description: "Theme, density, and text size",
        icon: Layout,
      },
      {
        id: "general",
        label: "General",
        description: "Startup behavior and app updates",
        icon: SettingsIcon,
      },
      {
        id: "shortcuts",
        label: "Shortcuts",
        description: "Global keyboard shortcuts",
        icon: Keyboard,
      },
    ],
  },
  {
    label: "Capture",
    items: [
      {
        id: "recording",
        label: "Recording",
        description: "What Chronicle records, and from where",
        icon: Video,
      },
      {
        id: "privacy",
        label: "Privacy",
        description: "Permissions and what stays on this machine",
        icon: Shield,
      },
    ],
  },
  {
    label: "Data & AI",
    items: [
      {
        id: "ai",
        label: "AI",
        description: "Gemini model and API key",
        icon: Sparkles,
      },
      {
        id: "storage",
        label: "Storage",
        description: "What is stored locally, and how much of it",
        icon: HardDrive,
      },
    ],
  },
];

/** Flat lookup so a section title can never drift from its nav label. */
export const SETTINGS_SECTIONS: NavItem<SettingsSection>[] = SETTINGS_NAV.flatMap((g) => g.items);

export const SETTINGS_SECTION_IDS = new Set<string>(SETTINGS_SECTIONS.map((i) => i.id));

export function findSettingsSection(id: SettingsSection) {
  return SETTINGS_SECTIONS.find((i) => i.id === id);
}

export function findMainSection(id: MainSection) {
  return MAIN_NAV.find((i) => i.id === id);
}
