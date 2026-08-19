/**
 * Composio connector configuration.
 *
 * Only `COMPOSIO_API_KEY` is required — connectors use Composio-managed auth
 * (Composio's shared OAuth apps), and the per-toolkit auth config is created
 * automatically on first connect. The `COMPOSIO_AUTH_CONFIG_*` vars are optional
 * overrides for anyone who wants to bring their own auth config from the dashboard.
 */

export const COMPOSIO_API_KEY = process.env.COMPOSIO_API_KEY ?? "";

/** Single local user — this is a personal desktop app, one identity is enough. */
export const COMPOSIO_USER_ID = process.env.COMPOSIO_USER_ID ?? "chronicle-default";

export interface ToolkitConfig {
  /** Composio toolkit slug (lowercase). */
  slug: string;
  /** Human label shown in the Connections UI. */
  label: string;
  /** Optional auth config id override (env). Empty → managed auth auto-provisioned. */
  authConfigId: string;
  /**
   * Curated tool slugs exposed to the chat LLM. Composio ships 40-160+ tools per
   * toolkit; we surface a high-signal subset covering read + common write actions.
   * (Fetching by `limit` alone returns tools alphabetically, which drops the
   * important read/fetch tools — hence the explicit allowlist.)
   */
  tools: string[];
}

export const TOOLKITS: ToolkitConfig[] = [
  {
    slug: "gmail",
    label: "gmail",
    authConfigId: process.env.COMPOSIO_AUTH_CONFIG_GMAIL ?? "",
    tools: [
      "GMAIL_FETCH_EMAILS",
      "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
      "GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
      "GMAIL_LIST_THREADS",
      "GMAIL_SEND_EMAIL",
      "GMAIL_CREATE_EMAIL_DRAFT",
      "GMAIL_REPLY_TO_THREAD",
      "GMAIL_ADD_LABEL_TO_EMAIL",
      "GMAIL_LIST_LABELS",
      "GMAIL_GET_PROFILE",
      "GMAIL_GET_CONTACTS",
    ],
  },
  {
    slug: "googlecalendar",
    label: "google calendar",
    authConfigId: process.env.COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR ?? "",
    tools: [
      "GOOGLECALENDAR_EVENTS_LIST",
      "GOOGLECALENDAR_FIND_EVENT",
      "GOOGLECALENDAR_CREATE_EVENT",
      "GOOGLECALENDAR_QUICK_ADD",
      "GOOGLECALENDAR_UPDATE_EVENT",
      "GOOGLECALENDAR_DELETE_EVENT",
      "GOOGLECALENDAR_FIND_FREE_SLOTS",
      "GOOGLECALENDAR_LIST_CALENDARS",
      "GOOGLECALENDAR_GET_CURRENT_DATE_TIME",
    ],
  },
  {
    slug: "slack",
    label: "slack",
    authConfigId: process.env.COMPOSIO_AUTH_CONFIG_SLACK ?? "",
    tools: [
      "SLACK_CHAT_POST_MESSAGE",
      "SLACK_FETCH_CONVERSATION_HISTORY",
      "SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION",
      "SLACK_FIND_CHANNELS",
      "SLACK_LIST_ALL_CHANNELS",
      "SLACK_LIST_ALL_USERS",
      "SLACK_FIND_USER_BY_EMAIL_ADDRESS",
      "SLACK_ADD_REACTION_TO_AN_ITEM",
    ],
  },
  {
    slug: "notion",
    label: "notion",
    authConfigId: process.env.COMPOSIO_AUTH_CONFIG_NOTION ?? "",
    tools: [
      "NOTION_SEARCH_NOTION_PAGE",
      "NOTION_FETCH_DATA",
      "NOTION_GET_PAGE_MARKDOWN",
      "NOTION_RETRIEVE_PAGE",
      "NOTION_CREATE_NOTION_PAGE",
      "NOTION_ADD_PAGE_CONTENT",
      "NOTION_UPDATE_PAGE",
      "NOTION_QUERY_DATABASE",
      "NOTION_FETCH_DATABASE",
    ],
  },
];

export const COMPOSIO_ENABLED = COMPOSIO_API_KEY.length > 0;

export function getToolkit(slug: string): ToolkitConfig | undefined {
  return TOOLKITS.find((t) => t.slug === slug.toLowerCase());
}
