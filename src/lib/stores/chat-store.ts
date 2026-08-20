import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "@/lib/api/client";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface ChatSession {
  id: string;
  title: string;
  preview: string;
  messages: ChatMessage[];
  updatedAt: number;
  draft?: boolean;
}

interface ChatState {
  sessions: Record<string, ChatSession>;
  currentId: string | null;
  isStreaming: boolean;
  /** Gemini Live voice mode active */
  isLiveVoice: boolean;
  liveUserPartial: string;
  liveAssistantPartial: string;
  actions: {
    setCurrent: (id: string) => void;
    createSession: () => string;
    addMessage: (sessionId: string, message: Omit<ChatMessage, "id" | "timestamp">) => void;
    setStreaming: (streaming: boolean) => void;
    setLiveVoice: (active: boolean) => void;
    setLivePartials: (user: string, assistant: string) => void;
    updateSessionTitle: (id: string, title: string) => void;
  };
}

const welcomeMessage: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "hello. i'm your ai assistant.\n\ni can help you with tasks, answer questions, and collaborate on ideas.\n\nwhat would you like to work on?",
  timestamp: Date.now(),
};

function createDefaultSession(): ChatSession {
  const id = crypto.randomUUID();
  return {
    id,
    title: "untitled",
    preview: welcomeMessage.content.slice(0, 60),
    messages: [welcomeMessage],
    updatedAt: Date.now(),
    draft: true,
  };
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      sessions: {},
      currentId: null,
      isStreaming: false,
      isLiveVoice: false,
      liveUserPartial: "",
      liveAssistantPartial: "",
      actions: {
        setCurrent: (id) => set({ currentId: id }),
        createSession: () => {
          const session = createDefaultSession();
          set((state) => ({
            sessions: { ...state.sessions, [session.id]: session },
            currentId: session.id,
          }));
          return session.id;
        },
        addMessage: (sessionId, message) => {
          const msg: ChatMessage = {
            ...message,
            id: crypto.randomUUID(),
            timestamp: Date.now(),
          };
          set((state) => {
            const session = state.sessions[sessionId];
            if (!session) return state;
            const updated: ChatSession = {
              ...session,
              draft: false,
              messages: [...session.messages, msg],
              preview: msg.content.slice(0, 60),
              updatedAt: Date.now(),
              title:
                session.title === "untitled" && message.role === "user"
                  ? message.content.slice(0, 40).toLowerCase()
                  : session.title,
            };
            return {
              sessions: { ...state.sessions, [sessionId]: updated },
            };
          });
        },
        setStreaming: (streaming) => set({ isStreaming: streaming }),
        setLiveVoice: (active) =>
          set({
            isLiveVoice: active,
            ...(active
              ? {}
              : { liveUserPartial: "", liveAssistantPartial: "" }),
          }),
        setLivePartials: (user, assistant) =>
          set({ liveUserPartial: user, liveAssistantPartial: assistant }),
        updateSessionTitle: (id, title) =>
          set((state) => ({
            sessions: {
              ...state.sessions,
              [id]: { ...state.sessions[id], title },
            },
          })),
      },
    }),
    {
      name: "chronicle-chat",
      partialize: (state) => ({
        sessions: state.sessions,
        currentId: state.currentId,
      }),
      onRehydrateStorage: () => (state) => {
        if (state && !state.currentId) {
          const id = state.actions.createSession();
          state.actions.setCurrent(id);
        }
      },
    }
  )
);

export async function simulateAssistantReply(
  sessionId: string,
  userMessage: string
): Promise<void> {
  const { actions, sessions } = useChatStore.getState();
  actions.setStreaming(true);

  try {
    const session = sessions[sessionId];
    const history =
      session?.messages
        .filter((message) => message.id !== "welcome")
        .map((message) => ({
          role: message.role,
          content: message.content,
          timestamp: new Date(message.timestamp).toISOString(),
        })) ?? [];

    const res = await api.chat({
      messages: history,
      context_query: userMessage,
      session_id: sessionId,
      session_started_at: history[0]?.timestamp,
    });

    actions.addMessage(sessionId, { role: "assistant", content: res.content });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "failed to reach the ai backend";
    actions.addMessage(sessionId, {
      role: "assistant",
      content: `sorry, i couldn't reach gemini right now.\n\n${message}`,
    });
  } finally {
    actions.setStreaming(false);
  }
}

/** Persist a completed live voice turn into the same chat history as typed chat. */
export function commitLiveTurn(
  sessionId: string,
  user: string,
  assistant: string
): void {
  const { actions } = useChatStore.getState();
  const userText = user.trim();
  const assistantText = assistant.trim();
  if (userText) {
    actions.addMessage(sessionId, { role: "user", content: userText });
  }
  if (assistantText) {
    actions.addMessage(sessionId, { role: "assistant", content: assistantText });
  }
  actions.setLivePartials("", "");

  if (userText || assistantText) {
    const session = useChatStore.getState().sessions[sessionId];
    const turns =
      session?.messages
        .filter((message) => message.id !== "welcome")
        .map((message) => ({
          role: message.role,
          content: message.content,
          timestamp: new Date(message.timestamp).toISOString(),
        })) ?? [];
    if (turns.length > 0) {
      void api
        .ingestMemorySession({
          sessionId,
          turns,
          startedAt: turns[0]?.timestamp,
        })
        .catch((err) => console.warn("[memory] live session ingest failed", err));
    }
  }
}
