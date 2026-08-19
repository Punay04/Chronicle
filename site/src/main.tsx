import React from "react";
import ReactDOM from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { track } from "@vercel/analytics";
import "./styles.css";

const RELEASE_ROOT = "https://github.com/chronicle-app/chronicle/releases/latest/download";
const DOWNLOADS = {
  mac: `${RELEASE_ROOT}/Chronicle-universal.dmg`,
  linux: `${RELEASE_ROOT}/Chronicle-x86_64.AppImage`,
};

type Platform = keyof typeof DOWNLOADS;

function detectedPlatform(): Platform {
  if (typeof navigator === "undefined") return "mac";
  return /Linux/i.test(navigator.userAgent) ? "linux" : "mac";
}

function DownloadLink({
  platform,
  variant = "outline",
  size,
}: {
  platform: Platform;
  variant?: "primary" | "outline";
  size?: "lg";
}) {
  const label = platform === "mac" ? "Download for macOS" : "Download for Linux";
  return (
    <a
      className={`btn btn-${variant}${size === "lg" ? " btn-lg" : ""}`}
      href={DOWNLOADS[platform]}
      onClick={() =>
        track("download", {
          platform,
          artifact: DOWNLOADS[platform].split("/").at(-1) ?? "unknown",
        })
      }
    >
      {label}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    </a>
  );
}

const NAV_ITEMS = [
  { label: "Assistant", active: true, icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )},
  { label: "History", icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  )},
  { label: "Routines", icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
    </svg>
  )},
  { label: "Recordings", icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    </svg>
  )},
  { label: "Memory", icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.54" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.54" />
    </svg>
  )},
];

const FEATURES = [
  {
    title: "Screen & audio capture",
    description: "Chronicle watches your screen and listens to meetings, turning activity into structured context automatically.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
  {
    title: "Local memory graph",
    description: "HydraDB runs on your machine and connects moments into a searchable graph you own completely.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" /><circle cx="4" cy="6" r="2" /><circle cx="20" cy="6" r="2" /><circle cx="4" cy="18" r="2" /><circle cx="20" cy="18" r="2" />
        <line x1="6" y1="7" x2="10" y2="10" /><line x1="18" y1="7" x2="14" y2="10" /><line x1="6" y1="17" x2="10" y2="14" /><line x1="18" y1="17" x2="14" y2="14" />
      </svg>
    ),
  },
  {
    title: "Chat with your context",
    description: "Ask questions about what happened, search the timeline, and trigger workflows from real work — not generic prompts.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
];

const STEPS = [
  {
    title: "Capture",
    description: "Screen, audio, active windows, meetings, and the text inside your work — all recorded locally.",
  },
  {
    title: "Remember",
    description: "HydraDB connects moments into durable context that persists across sessions and apps.",
  },
  {
    title: "Act",
    description: "Search the timeline, ask questions in chat, and run workflows triggered by what actually happened.",
  },
];

const PRIVACY_POINTS = [
  {
    title: "Runs entirely on your device",
    description: "Chronicle and HydraDB are one managed local experience. Your data never leaves your machine.",
  },
  {
    title: "No content in analytics",
    description: "Download tracking records only the platform and artifact — never captured screen or audio content.",
  },
  {
    title: "You control what's stored",
    description: "Review, search, and manage your memory graph. Delete anything, anytime.",
  },
];

function App() {
  const platform = detectedPlatform();
  const alternate: Platform = platform === "mac" ? "linux" : "mac";

  return (
    <>
      <header className="site-header">
        <div className="shell">
          <a href="#top" className="brand" aria-label="Chronicle home">
            <img src="/logo.png" alt="" />
            <span>Chronicle</span>
          </a>
          <nav className="site-nav" aria-label="Main navigation">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#privacy">Privacy</a>
            <a href="https://github.com/chronicle-app/chronicle">GitHub</a>
            <DownloadLink platform={platform} variant="primary" />
          </nav>
        </div>
      </header>

      <main id="top">
        <section className="hero shell">
          <div className="hero-badge">
            <span aria-hidden="true" />
            Powered by HydraDB
          </div>
          <h1>Your context, connected</h1>
          <p className="hero-copy">
            Chronicle captures the work happening on your screen and in your meetings,
            then turns it into context you can search, chat with, and act on — backed by
            the same memory infrastructure as{" "}
            <a href="https://hydradb.ai/" className="hero-powered" target="_blank" rel="noreferrer">
              HydraDB
            </a>
            .
          </p>
          <div className="download-row">
            <DownloadLink platform={platform} variant="primary" size="lg" />
            <DownloadLink platform={alternate} variant="outline" size="lg" />
          </div>
          <p className="fine-print">macOS universal · Linux x64 · HydraDB installs automatically</p>
        </section>

        <section className="preview-section shell" aria-label="Chronicle product preview">
          <div className="preview-frame">
            <div className="preview-chrome">
              <div className="preview-chrome-dots" aria-hidden="true">
                <span /><span /><span />
              </div>
              <span>Chronicle</span>
              <span>Local · Ready</span>
            </div>
            <div className="preview-body">
              <aside className="preview-sidebar" aria-hidden="true">
                {NAV_ITEMS.map((item) => (
                  <div
                    key={item.label}
                    className={`preview-nav-item${item.active ? " active" : ""}`}
                  >
                    {item.icon}
                    {item.label}
                  </div>
                ))}
              </aside>
              <div className="preview-main">
                <div className="preview-topbar">
                  <span>Chat</span>
                  <div className="recording-pill">
                    <span className="dot" aria-hidden="true" />
                    Recording
                  </div>
                </div>
                <div className="preview-chat">
                  <div className="chat-bubble user">
                    What did we decide in yesterday&apos;s standup about the auth refactor?
                  </div>
                  <div className="chat-bubble assistant">
                    In yesterday&apos;s standup at 9:42 AM, the team agreed to defer OAuth
                    provider changes until after the v2 release. Alex noted the migration
                    script is ready but needs testing on staging.
                  </div>
                  <div className="chat-input-mock">
                    Ask about your work…
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="section shell">
          <div className="section-label">Features</div>
          <h2>Everything you need to remember your work</h2>
          <p className="section-intro">
            A single workspace that captures, organizes, and makes your context actionable.
          </p>
          <div className="feature-grid">
            {FEATURES.map((feature) => (
              <article key={feature.title} className="feature-card">
                <div className="feature-icon">{feature.icon}</div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="how" className="section shell">
          <div className="section-label">How it works</div>
          <h2>From capture to action in three steps</h2>
          <div className="steps">
            {STEPS.map((step, i) => (
              <article key={step.title} className="step-card">
                <div className="step-number">{String(i + 1).padStart(2, "0")}</div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="privacy" className="section shell">
          <div className="section-label">Privacy</div>
          <div className="privacy-grid">
            <div>
              <h2>The memory stays on your machine</h2>
              <p className="section-intro">
                Chronicle is built for people who want AI that understands their work
                without sending it to the cloud.
              </p>
            </div>
            <div className="privacy-points">
              {PRIVACY_POINTS.map((point) => (
                <div key={point.title} className="privacy-point">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  <div>
                    <strong>{point.title}</strong>
                    <span>{point.description}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section shell">
          <div className="section-label">Install</div>
          <h2>Get started in minutes</h2>
          <div className="install-grid">
            <div className="install-card">
              <h3>macOS</h3>
              <p>
                Open the DMG, drag Chronicle to Applications, and launch it.
                Gatekeeper-compatible signed releases are published on GitHub.
              </p>
            </div>
            <div className="install-card">
              <h3>Linux</h3>
              <p>Download the AppImage, make it executable, then open it.</p>
              <code>chmod +x Chronicle-x86_64.AppImage</code>
            </div>
          </div>
        </section>

        <section className="final-cta shell">
          <h2>Remember more. Repeat less.</h2>
          <p>Download Chronicle and start building your local memory graph.</p>
          <DownloadLink platform={platform} variant="primary" size="lg" />
        </section>
      </main>

      <footer className="site-footer">
        <div className="shell">
          <span>© {new Date().getFullYear()} Chronicle</span>
          <span>
            Memory by{" "}
            <a href="https://hydradb.ai/" target="_blank" rel="noreferrer">
              HydraDB
            </a>
          </span>
        </div>
      </footer>

      <Analytics />
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
