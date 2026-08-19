# Chronicle

Chronicle is a local-first AI desktop workspace. It captures screen activity and meetings on your machine, stores them in SQLite, and writes a **property graph of episodes and facts into a local HydraDB graph-node**. Chat, search, and the Brain view retrieve over that graph with OpenCypher — including current vs superseded facts and explicit abstention when nothing matches.

## Why HydraDB

Vector search cannot tell you whether a fact is still true, what it replaced, or that the answer is not in memory. Chronicle uses the [HydraDB](https://github.com/hydra-db/hydradb) open-source graph database as the memory substrate:

| Graph object | Role |
| --- | --- |
| `Episode` | A screen chunk, transcript, meeting, pinned note, or chat turn |
| `Fact` | A durable claim with `current`, `valid_from`, `valid_to` |
| `Session` | A multi-turn conversation spanning time |
| `FOLLOWS` | Chronological chain of episodes |
| `SUPERSEDES` | Later fact replacing an earlier one |
| `RECORDED_AS` / `IN_SESSION` | Provenance from episode → fact → session |

Chat retrieval runs Cypher against **current** facts first, then superseded facts (labeled so the model must not treat them as live), then related episodes. If the graph has no match, Chronicle injects an `[abstain]` instruction so the model says it does not know instead of inventing history.

HydraDB is required for memory. Without the local graph-node, capture still works in SQLite, but the Brain graph, profile, and graph-aware chat context are empty.

## What you can do

- Capture screen frames locally (deduplicated JPEG/MP4, OCR)
- Record meeting audio, transcribe, summarize, and extract action items
- Search history with SQLite FTS5 (`Ctrl/Cmd+K`)
- Chat (typed or live voice) with HydraDB-retrieved context plus Gemini
- Inspect the memory graph in **Brain**
- Run built-in workflows (daily summary, meeting recap, focus tracker, action items)
- Optionally connect Gmail, Calendar, Slack, and Notion through Composio

## Local data

| Data | Where |
| --- | --- |
| Screenshots, video, audio, OCR, SQLite | `~/.chronicle/` |
| HydraDB object store + cache | `~/.chronicle/hydradb/` |
| Capture API | `http://127.0.0.1:3030` |
| HydraDB HTTP / Bolt / admin | `8443` / `7687` / `9090` |
| Chat, STT, summaries | Retrieved graph snippets are sent to Gemini when an API key is set |

## Requirements

- Node.js 24 and npm 11
- Docker Desktop (runs the HydraDB `graph-node` image)
- A Gemini API key for chat, transcription, and summaries

## Setup

```bash
git clone <this-repo>
cd Chronicle
cp .env.example .env
# put GEMINI_API_KEY in .env
npm install
npm run dev
```

`npm run dev` starts:

1. HydraDB via Docker (`ghcr.io/hydra-db/hydradb:latest`)
2. The capture backend on port 3030
3. Vite + Electron

First HydraDB start downloads the image and may take a few minutes. Data is kept under `~/.chronicle/hydradb/`.

### HydraDB only

```bash
npm run memory:start
```

Health check: `GET http://127.0.0.1:9090/readyz`

### Ingest a chat session (graph memory)

```bash
curl -s http://127.0.0.1:3030/memory/sessions \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"demo-1\",\"turns\":[{\"role\":\"user\",\"content\":\"I live in Austin\"},{\"role\":\"assistant\",\"content\":\"Noted.\"}]}"
```

A later session with a different city writes a new `Fact` and a `SUPERSEDES` edge. Chat questions about the current city should use the new fact; questions about the old city should treat it as replaced.

## Architecture

```
Renderer (React) --IPC--> Electron main
                              |-- scripts/hydradb-start.mjs --> Docker graph-node
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
| `npm run memory:start` | Start the local HydraDB graph-node |
| `npm run typecheck` | Typecheck the desktop app |
| `npm run test:runtime` | Runtime policy tests |
| `npm run build:win` | Windows installer |
| `npm run build:mac` | macOS DMG |
| `npm run build:linux` | Linux AppImage |

## License

MIT. HydraDB itself is AGPL-3.0 and is run as a separate Docker process, not vendored into this repository.
