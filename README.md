# Chronicle

Chronicle is a local-first AI workspace that remembers your work. It captures screen activity and recordings on your machine, stores them in SQLite, and writes a **property graph of episodes and facts into a local HydraDB graph-node**. The Assistant, search, and the Memory view retrieve over that graph with OpenCypher — including current vs superseded facts and explicit abstention when nothing matches.

## Quick start

Need **Node.js 24**, **npm 11**, and a **Gemini API key**.

```bash
git clone https://github.com/Punay04/Chronicle.git
cd Chronicle
cp .env.example .env
# set GEMINI_API_KEY in .env
npm install
```

Then start the app the fastest way for your OS. `npm run dev` launches HydraDB, the capture API on `http://127.0.0.1:3030`, and Vite + Electron (`http://localhost:1420`).

### Windows

Fastest native path — compile `graph-node` once inside WSL, then run:

```bash
wsl --install -d Ubuntu    # once; reboot if Windows asks
npm run memory:bootstrap   # once (several minutes)
npm run dev
```

Skip the compile if Docker Desktop is already running:

```bash
# Git Bash
HYDRADB_USE_DOCKER=1 npm run dev

# PowerShell
$env:HYDRADB_USE_DOCKER="1"; npm run dev
```

### Linux

On Ubuntu/Debian, compile once then run:

```bash
npm run memory:bootstrap   # once (several minutes; uses apt)
npm run dev
```

Skip the compile if Docker is already running:

```bash
HYDRADB_USE_DOCKER=1 npm run dev
```

### macOS

Docker is the fastest path (`npm run memory:bootstrap` is not wired up on macOS):

```bash
# start Docker Desktop first
HYDRADB_USE_DOCKER=1 npm run dev
```

To run without Docker, compile HydraDB yourself and put the binary on the lookup path:

```bash
brew install just cmake pkg-config llvm suite-sparse
brew install cleishm/neo4j/libcypher-parser
git clone https://github.com/hydra-db/hydradb ~/src/hydradb
cd ~/src/hydradb && cargo build --locked --features server-runtime --bin graph-node --release
mkdir -p ~/.chronicle/hydradb/bin
cp ~/src/hydradb/target/release/graph-node ~/.chronicle/hydradb/bin/graph-node
cd /path/to/Chronicle && npm run dev
```

## Why HydraDB

Vector search cannot tell you whether a fact is still true, what it replaced, or that the answer is not in memory. Chronicle uses the [HydraDB](https://github.com/hydra-db/hydradb) open-source graph database as the memory substrate:

These are **graph schema names**, not product vocabulary — none of them appear in the interface. See [What you see](#what-you-see) for the words the app actually uses.

| Graph object | Role |
| --- | --- |
| `Episode` | A screen chunk, transcript, meeting, pinned note, or chat turn |
| `Fact` | A durable claim with `current`, `valid_from`, `valid_to` |
| `Session` | A multi-turn conversation spanning time |
| `FOLLOWS` | Chronological chain of episodes |
| `SUPERSEDES` | Later fact replacing an earlier one |
| `RECORDED_AS` / `IN_SESSION` | Provenance from episode → fact → session |

Chat retrieval runs Cypher against **current** facts first, then superseded facts (labeled so the model must not treat them as live), then related episodes. If the graph has no match, Chronicle injects an `[abstain]` instruction so the model says it does not know instead of inventing history.

Completed typed and live Assistant turns are written back into HydraDB automatically. Chronicle conservatively extracts declarative key/value facts (for example, `I live in Austin`, `My city is Austin`, or `Project Atlas launch is Friday`) while ignoring questions and requests. A later fact with the same normalized subject becomes current, marks the earlier value inactive, and links the pair with `SUPERSEDES`. Replayed session payloads are idempotent and cannot make an older value current again.

HydraDB is required for memory. Without the local graph-node, capture still works in SQLite, but the Memory graph, profile, and graph-aware chat context are empty.

## What you see

The interface deliberately speaks plain English rather than schema. The mapping:

| In the app | Underneath |
| --- | --- |
| **Assistant** | Chat over graph-retrieved context |
| **History** | `frames` — screen snapshots with OCR text |
| **Routines** | `pipes` — scheduled automations |
| **Recordings** | `meetings` — audio, transcripts, summaries |
| **Memory** | The HydraDB graph of `Episode` / `Fact` / `Session` |
| **Integrations** | Composio connectors |
| **Support** | Feedback and help |
| Snapshot / Audio segment / Memory | `frame` / `audio_chunk` / graph node |

Renaming anything in the left column is a UI-copy change only; the right column is schema and is never renamed without a migration.

## What you can do

Chronicle follows a **Capture → Remember → Act** loop:

- **Capture** screen snapshots locally (deduplicated JPEG/MP4, OCR)
- **Capture** meeting audio, then transcribe, summarize, and extract action items
- **Remember** — everything becomes a queryable graph you can inspect in **Memory**
- **Act** — search your history with SQLite FTS5 (`Ctrl/Cmd+K`)
- **Act** — ask the **Assistant** (typed or live voice) with graph-retrieved context plus Gemini
- **Act** — run built-in **Routines** (Daily Summary, Meeting Recap, Focus Tracker, Action Items)
- Optionally connect Gmail, Calendar, Slack, and Notion through **Integrations**

## Local data

| Data | Where |
| --- | --- |
| Screenshots, video, audio, OCR, SQLite | `~/.chronicle/` |
| HydraDB object store + cache | `~/.chronicle/hydradb/` |
| Capture API | `http://127.0.0.1:3030` |
| HydraDB HTTP / Bolt / admin | `8443` / `7687` / `9090` |
| Chat, STT, summaries | Retrieved graph snippets are sent to Gemini when an API key is set |

## HydraDB only

```bash
npm run memory:bootstrap   # once (Windows / Linux)
npm run memory:start
```

Lookup order: `HYDRADB_BIN` or `~/.chronicle/hydradb/bin/graph-node`, then a WSL binary (`HYDRADB_WSL_BIN` or `~/.chronicle/hydradb/wsl-bin`). Docker is opt-in: `HYDRADB_USE_DOCKER=1 npm run memory:start`.

Health check: `GET http://127.0.0.1:9090/readyz`. Data lives under `~/.chronicle/hydradb/`.

## Ingest a chat session (graph memory)

```bash
curl -s http://127.0.0.1:3030/memory/sessions \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"demo-1\",\"turns\":[{\"role\":\"user\",\"content\":\"I live in Austin\"},{\"role\":\"assistant\",\"content\":\"Noted.\"}]}"
```

A later session with a different city writes a new `Fact` and a `SUPERSEDES` edge. Chat questions about the current city should use the new fact; questions about the old city should treat it as replaced.

## Verify temporal memory

With HydraDB and the Chronicle backend running, execute:

```bash
npm run eval:memory
```

The deterministic smoke evaluation ingests an old and a new value for the same fact slot, queries the retrieval layer directly, and checks three behaviors: the new value is tagged `[current]`, the old value is tagged `[superseded]`, and an unknown query produces `[abstain]`. It does not depend on Gemini wording.

## Architecture

```
Renderer (React) --IPC--> Electron main
                              |-- scripts/hydradb-start.mjs --> native / WSL graph-node
                              |-- Hono capture API :3030
                                    |-- Capture engine (screen / OCR / audio)
                                    |-- SQLite + FTS5
                                    |-- HydraDB Cypher ingest + retrieve
                                    |-- Gemini chat / live / pipes
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | HydraDB + backend + Vite/Electron |
| `npm run memory:bootstrap` | Compile native `graph-node` (WSL on Windows, apt on Linux) |
| `npm run memory:start` | Start the local HydraDB graph-node |
| `npm run eval:memory` | Verify current, superseded, and abstention retrieval |
| `npm run typecheck` | Typecheck the desktop app |
| `npm run test:runtime` | Runtime policy tests |
| `npm run build:win` | Windows installer |
| `npm run build:mac` | macOS DMG |
| `npm run build:linux` | Linux AppImage |

## License

MIT. HydraDB itself is AGPL-3.0 and is run as a separate `graph-node` process, not vendored into this repository.
