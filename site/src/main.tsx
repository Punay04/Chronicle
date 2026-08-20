import React from "react";
import ReactDOM from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { track } from "@vercel/analytics";
import "./styles.css";

const REPO_SLUG = "Punay04/Chronicle";
const REPO_URL = `https://github.com/${REPO_SLUG}`;
const REPO_API = `https://api.github.com/repos/${REPO_SLUG}`;

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* ------------------------------------------------------------------ hooks */

/** Adds `.is-in` to every `[data-reveal]` element once it scrolls into view. */
function useScrollReveal() {
  React.useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
      nodes.forEach((node) => node.classList.add("is-in"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);
}

/** Tracks page scroll for the progress bar and the condensed header state. */
function useScrollProgress() {
  const [progress, setProgress] = React.useState(0);
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
      setScrolled(window.scrollY > 8);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return { progress, scrolled };
}

/** Highlights the nav link whose section is currently on screen. */
function useActiveSection(ids: string[]) {
  const [active, setActive] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { threshold: [0.25, 0.5], rootMargin: "-20% 0px -40% 0px" }
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [ids]);

  return active;
}

/** Writes pointer position into CSS vars so cards can render a cursor spotlight. */
function useSpotlight<T extends HTMLElement>() {
  return React.useCallback((event: React.PointerEvent<T>) => {
    const target = event.currentTarget;
    const rect = target.getBoundingClientRect();
    target.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    target.style.setProperty("--my", `${event.clientY - rect.top}px`);
  }, []);
}

/* ------------------------------------------------------------- primitives */

const GitHubIcon = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

const StarIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

/** Live star count from the public GitHub API; renders nothing if unavailable. */
function useStarCount() {
  const [stars, setStars] = React.useState<number | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch(REPO_API, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (typeof data?.stargazers_count === "number") setStars(data.stargazers_count);
      })
      .catch(() => {
        /* rate limited or offline — the button just renders without a count */
      });
    return () => controller.abort();
  }, []);

  return stars;
}

function formatStars(count: number) {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

/**
 * Primary call to action: opens the repository. When `showStars` is set the
 * button carries a live stargazer count in a trailing badge.
 */
function RepoButton({
  variant = "primary",
  size,
  label = "View on GitHub",
  showStars = false,
  location,
}: {
  variant?: "primary" | "outline";
  size?: "lg";
  label?: string;
  showStars?: boolean;
  location: string;
}) {
  const stars = useStarCount();

  return (
    <a
      className={`btn btn-${variant}${size === "lg" ? " btn-lg" : ""}${showStars ? " btn-repo" : ""}`}
      href={REPO_URL}
      target="_blank"
      rel="noreferrer"
      onClick={() => track("github", { repo: REPO_SLUG, location })}
    >
      <span className="btn-label">
        <GitHubIcon />
        {label}
        {showStars && stars !== null && (
          <span className="star-badge">
            <StarIcon />
            {formatStars(stars)}
          </span>
        )}
      </span>
    </a>
  );
}

/** Secondary CTA that deep-links to the repo's star action. */
function StarButton({ size, location }: { size?: "lg"; location: string }) {
  return (
    <a
      className={`btn btn-outline${size === "lg" ? " btn-lg" : ""}`}
      href={REPO_URL}
      target="_blank"
      rel="noreferrer"
      onClick={() => track("github_star", { repo: REPO_SLUG, location })}
    >
      <span className="btn-label">
        <StarIcon />
        Star the repo
      </span>
    </a>
  );
}

/* ------------------------------------------------------------------- data */

const NAV_ITEMS = [
  { label: "Assistant", icon: (
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

const STATS = [
  { value: "100%", label: "On-device" },
  { value: "0", label: "Bytes uploaded" },
  { value: "24/7", label: "Passive capture" },
  { value: "<1s", label: "Recall latency" },
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

const QUICK_START: { kind: "cmd" | "comment" | "out"; text: string }[] = [
  { kind: "cmd", text: `git clone ${REPO_URL}.git` },
  { kind: "cmd", text: "cd Chronicle" },
  { kind: "cmd", text: "cp .env.example .env" },
  { kind: "comment", text: "# set GEMINI_API_KEY in .env" },
  { kind: "cmd", text: "npm install" },
  { kind: "cmd", text: "npm run dev" },
  { kind: "out", text: "→ HydraDB, capture API, and Electron all start up" },
];

const PLATFORM_NOTES = [
  {
    title: "Requirements",
    description: "Node.js 24, npm 11, and a Gemini API key. Everything else is pulled in by npm install.",
  },
  {
    title: "macOS",
    description: "Docker is the fastest path — start Docker Desktop, then run HYDRADB_USE_DOCKER=1 npm run dev.",
  },
  {
    title: "Linux & Windows",
    description: "Run npm run memory:bootstrap once to compile graph-node natively (WSL on Windows), or use the Docker flag to skip it.",
  },
];

const PRIVACY_POINTS = [
  {
    title: "Runs entirely on your device",
    description: "Chronicle and HydraDB are one managed local experience. Your data never leaves your machine.",
  },
  {
    title: "Auditable by design",
    description: "Every line of the capture pipeline is open source. Read it, fork it, or verify it yourself before you run it.",
  },
  {
    title: "You control what's stored",
    description: "Review, search, and manage your memory graph. Delete anything, anytime.",
  },
];

const CONVERSATIONS = [
  {
    nav: "Assistant",
    question: "What did we decide in yesterday's standup about the auth refactor?",
    answer:
      "In yesterday's standup at 9:42 AM, the team agreed to defer OAuth provider changes until after the v2 release. Alex noted the migration script is ready but needs testing on staging.",
    sources: ["standup-recording.m4a", "auth-refactor.md"],
  },
  {
    nav: "History",
    question: "Show me everything I touched on the billing migration last week.",
    answer:
      "Across Tuesday and Thursday you spent 4h 12m in billing/: the Stripe webhook retry fix, two Linear tickets, and a Notion doc on proration edge cases.",
    sources: ["stripe-webhooks.ts", "CHR-482"],
  },
  {
    nav: "Memory",
    question: "Who owns the deploy pipeline now?",
    answer:
      "Priya took it over on March 3rd — she announced it in #eng-infra and has merged every release PR since. The runbook still lists the old owner.",
    sources: ["#eng-infra", "runbook.md"],
  },
];

/* ---------------------------------------------------------- live demo */

type DemoPhase = "typing" | "thinking" | "answering" | "hold";

/**
 * Cycles through CONVERSATIONS, typing the question a character at a time,
 * pausing to "think", then revealing the answer. Falls back to the fully
 * rendered first conversation when reduced motion is requested.
 */
function useConversationDemo(active: boolean) {
  const reduced = React.useMemo(prefersReducedMotion, []);
  const [index, setIndex] = React.useState(0);
  const [typed, setTyped] = React.useState(reduced ? CONVERSATIONS[0].question : "");
  const [phase, setPhase] = React.useState<DemoPhase>(reduced ? "hold" : "typing");

  const current = CONVERSATIONS[index];

  React.useEffect(() => {
    if (reduced || !active) return;
    let timer: number;

    if (phase === "typing") {
      if (typed.length < current.question.length) {
        timer = window.setTimeout(
          () => setTyped(current.question.slice(0, typed.length + 1)),
          18 + Math.random() * 42
        );
      } else {
        timer = window.setTimeout(() => setPhase("thinking"), 420);
      }
    } else if (phase === "thinking") {
      timer = window.setTimeout(() => setPhase("answering"), 1100);
    } else if (phase === "answering") {
      timer = window.setTimeout(() => setPhase("hold"), 1400);
    } else {
      timer = window.setTimeout(() => {
        setIndex((i) => (i + 1) % CONVERSATIONS.length);
        setTyped("");
        setPhase("typing");
      }, 4200);
    }

    return () => window.clearTimeout(timer);
  }, [active, current.question, phase, reduced, typed]);

  return { current, typed, phase, reduced };
}

function ProductPreview() {
  const frameRef = React.useRef<HTMLDivElement>(null);
  const [active, setActive] = React.useState(false);
  const { current, typed, phase, reduced } = useConversationDemo(active);

  // Only animate the demo while the frame is actually on screen.
  React.useEffect(() => {
    const node = frameRef.current;
    if (!node || !("IntersectionObserver" in window)) {
      setActive(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setActive(entry.isIntersecting),
      { threshold: 0.25 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const showAnswer = phase === "answering" || phase === "hold";

  return (
    <section className="preview-section shell" aria-label="Chronicle product preview">
      <div className="preview-frame" ref={frameRef} data-reveal="scale">
        <div className="preview-glow" aria-hidden="true" />
        <div className="preview-chrome">
          <div className="preview-chrome-dots" aria-hidden="true">
            <span /><span /><span />
          </div>
          <span>Chronicle</span>
          <span className="preview-chrome-status">
            <i aria-hidden="true" />
            Local · Ready
          </span>
        </div>
        <div className="preview-body">
          <aside className="preview-sidebar" aria-hidden="true">
            {NAV_ITEMS.map((item) => (
              <div
                key={item.label}
                className={`preview-nav-item${item.label === current.nav ? " active" : ""}`}
              >
                {item.icon}
                {item.label}
              </div>
            ))}
          </aside>
          <div className="preview-main">
            <div className="preview-topbar">
              <span>{current.nav}</span>
              <div className="recording-pill">
                <span className="dot" aria-hidden="true" />
                Recording
              </div>
            </div>
            <div className="preview-chat" aria-live="polite">
              <div className={`chat-bubble user${typed ? " is-in" : " is-empty"}`}>
                {typed || " "}
              </div>

              {phase === "thinking" && (
                <div className="chat-bubble assistant thinking">
                  <span className="typing-dots" aria-label="Chronicle is thinking">
                    <i /><i /><i />
                  </span>
                </div>
              )}

              {showAnswer && (
                <div className="chat-bubble assistant is-in" key={current.answer}>
                  {current.answer}
                  <div className="chat-sources">
                    {current.sources.map((source) => (
                      <span key={source} className="chat-source">{source}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="chat-input-mock">
                {phase === "typing" && !reduced ? (
                  <>
                    <span className="chat-input-typed">{typed}</span>
                    <span className="caret" aria-hidden="true" />
                  </>
                ) : (
                  <span>Ask about your work…</span>
                )}
                <span className="chat-send" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- sections */

function SiteHeader() {
  const { progress, scrolled } = useScrollProgress();
  const activeSection = useActiveSection(React.useMemo(() => ["features", "how", "privacy"], []));
  const [menuOpen, setMenuOpen] = React.useState(false);

  React.useEffect(() => {
    document.body.classList.toggle("menu-open", menuOpen);
    return () => document.body.classList.remove("menu-open");
  }, [menuOpen]);

  const links = [
    { href: "#features", label: "Features", id: "features" },
    { href: "#how", label: "How it works", id: "how" },
    { href: "#privacy", label: "Privacy", id: "privacy" },
    { href: "#install", label: "Install", id: "install" },
  ];

  return (
    <header className={`site-header${scrolled ? " is-scrolled" : ""}`}>
      <div className="scroll-progress" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />
      <div className="shell">
        <a href="#top" className="brand" aria-label="Chronicle home">
          <img src="/logo.png" alt="" />
          <span>Chronicle</span>
        </a>

        <nav className="site-nav" aria-label="Main navigation">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className={link.id && activeSection === link.id ? "is-active" : undefined}
            >
              {link.label}
            </a>
          ))}
          <RepoButton variant="primary" showStars location="header" />
        </nav>

        <button
          type="button"
          className={`menu-toggle${menuOpen ? " is-open" : ""}`}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span /><span /><span />
        </button>
      </div>

      <div className={`mobile-menu${menuOpen ? " is-open" : ""}`}>
        {links.map((link) => (
          <a key={link.label} href={link.href} onClick={() => setMenuOpen(false)}>
            {link.label}
          </a>
        ))}
        <RepoButton variant="primary" size="lg" showStars location="mobile-menu" />
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="hero shell">
      <div className="hero-backdrop" aria-hidden="true">
        <div className="aurora aurora-1" />
        <div className="aurora aurora-2" />
        <div className="aurora aurora-3" />
        <div className="hero-grid" />
      </div>

      <a className="hero-badge" href="https://hydradb.com/" target="_blank" rel="noreferrer">
        <span className="hero-badge-dot" aria-hidden="true" />
        Powered by HydraDB
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </a>

      <h1>
        <span className="line"><span>Your context,</span></span>
        <span className="line"><span className="gradient-text">connected</span></span>
      </h1>

      <p className="hero-copy">
        Chronicle captures the work happening on your screen and in your meetings,
        then turns it into context you can search, chat with, and act on — backed by
        the same memory infrastructure as{" "}
        <a href="https://hydradb.com/" className="hero-powered" target="_blank" rel="noreferrer">
          HydraDB
        </a>
        .
      </p>

      <div className="hero-actions">
        <RepoButton variant="primary" size="lg" showStars location="hero" />
        <a className="btn btn-outline btn-lg" href="#install">
          <span className="btn-label">
            Quick start
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
        </a>
      </div>

      <p className="fine-print">MIT licensed · macOS, Linux & Windows · HydraDB installs automatically</p>
    </section>
  );
}

function StatBand() {
  return (
    <section className="stat-band shell" aria-label="Chronicle at a glance">
      {STATS.map((stat, i) => (
        <div key={stat.label} className="stat" data-reveal style={{ "--delay": `${i * 70}ms` } as React.CSSProperties}>
          <strong>{stat.value}</strong>
          <span>{stat.label}</span>
        </div>
      ))}
    </section>
  );
}

/* -------------------------------------------------------------------- app */

function App() {
  const spotlight = useSpotlight<HTMLElement>();

  useScrollReveal();

  return (
    <>
      <SiteHeader />

      <main id="top">
        <Hero />

        <ProductPreview />

        <StatBand />

        <section id="features" className="section shell">
          <div className="section-label" data-reveal>Features</div>
          <h2 data-reveal style={{ "--delay": "60ms" } as React.CSSProperties}>
            Everything you need to remember your work
          </h2>
          <p className="section-intro" data-reveal style={{ "--delay": "120ms" } as React.CSSProperties}>
            A single workspace that captures, organizes, and makes your context actionable.
          </p>
          <div className="feature-grid">
            {FEATURES.map((feature, i) => (
              <article
                key={feature.title}
                className="feature-card spotlight"
                onPointerMove={spotlight}
                data-reveal
                style={{ "--delay": `${180 + i * 90}ms` } as React.CSSProperties}
              >
                <div className="feature-icon">{feature.icon}</div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="how" className="section shell">
          <div className="section-label" data-reveal>How it works</div>
          <h2 data-reveal style={{ "--delay": "60ms" } as React.CSSProperties}>
            From capture to action in three steps
          </h2>
          <div className="steps">
            <div className="steps-rail" aria-hidden="true" data-reveal="rail" />
            {STEPS.map((step, i) => (
              <article
                key={step.title}
                className="step-card spotlight"
                onPointerMove={spotlight}
                data-reveal
                style={{ "--delay": `${140 + i * 110}ms` } as React.CSSProperties}
              >
                <div className="step-number">{String(i + 1).padStart(2, "0")}</div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="privacy" className="section shell">
          <div className="section-label" data-reveal>Privacy</div>
          <div className="privacy-grid">
            <div>
              <h2 data-reveal style={{ "--delay": "60ms" } as React.CSSProperties}>
                The memory stays on your machine
              </h2>
              <p className="section-intro" data-reveal style={{ "--delay": "120ms" } as React.CSSProperties}>
                Chronicle is built for people who want AI that understands their work
                without sending it to the cloud.
              </p>
            </div>
            <div className="privacy-points">
              {PRIVACY_POINTS.map((point, i) => (
                <div
                  key={point.title}
                  className="privacy-point"
                  data-reveal="right"
                  style={{ "--delay": `${100 + i * 100}ms` } as React.CSSProperties}
                >
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

        <section id="install" className="section shell">
          <div className="section-label" data-reveal>Install</div>
          <h2 data-reveal style={{ "--delay": "60ms" } as React.CSSProperties}>
            Clone it, run it, own it
          </h2>
          <p className="section-intro" data-reveal style={{ "--delay": "120ms" } as React.CSSProperties}>
            Chronicle is MIT licensed and builds from source on every platform.
            One command starts HydraDB, the capture API, and the desktop app.
          </p>

          <div className="install-grid">
            <div className="terminal spotlight" onPointerMove={spotlight} data-reveal style={{ "--delay": "180ms" } as React.CSSProperties}>
              <div className="terminal-chrome" aria-hidden="true">
                <span /><span /><span />
                <em>zsh</em>
              </div>
              <pre>
                {QUICK_START.map((line) => (
                  <code key={line.text} className={`term-line term-${line.kind}`}>
                    {line.kind === "cmd" && <span className="term-prompt">$</span>}
                    {line.text}
                  </code>
                ))}
              </pre>
            </div>

            <div className="platform-notes">
              {PLATFORM_NOTES.map((note, i) => (
                <div
                  key={note.title}
                  className="platform-note"
                  data-reveal="right"
                  style={{ "--delay": `${220 + i * 90}ms` } as React.CSSProperties}
                >
                  <strong>{note.title}</strong>
                  <span>{note.description}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="final-cta">
          <div className="shell">
            <div className="cta-glow" aria-hidden="true" />
            <h2 data-reveal>Remember more. Repeat less.</h2>
            <p data-reveal style={{ "--delay": "80ms" } as React.CSSProperties}>
              Chronicle is free and open source. Clone it, read every line, make it yours.
            </p>
            <div className="cta-actions" data-reveal style={{ "--delay": "160ms" } as React.CSSProperties}>
              <RepoButton variant="primary" size="lg" showStars location="footer-cta" />
              <StarButton size="lg" location="footer-cta" />
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="shell">
          <span>© {new Date().getFullYear()} Chronicle · MIT licensed</span>
          <span className="footer-links">
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              GitHub
            </a>
            <span aria-hidden="true">·</span>
            Memory by{" "}
            <a href="https://hydradb.com/" target="_blank" rel="noreferrer">
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
