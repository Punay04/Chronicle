#!/usr/bin/env bash
set -euo pipefail

# Builds a native HydraDB graph-node inside WSL. No Docker.
# Writes the Linux binary path to ~/.chronicle/hydradb/wsl-bin so
# `npm run memory:start` can spawn it.

SRC="${HYDRADB_SRC:-$HOME/src/hydradb}"
MARKER="${HYDRADB_MARKER:-}"

if [[ -z "$MARKER" ]]; then
  if command -v wslpath >/dev/null 2>&1 && [[ -n "${USERPROFILE:-}" ]]; then
    MARKER="$(wslpath -a "$USERPROFILE")/.chronicle/hydradb/wsl-bin"
  else
    MARKER="$HOME/.chronicle/hydradb/wsl-bin"
  fi
fi

mkdir -p "$(dirname "$MARKER")"
mkdir -p "$(dirname "$SRC")"

echo "[hydradb] installing native build deps"
sudo apt-get update
sudo apt-get install -y \
  build-essential clang libclang-dev cmake pkg-config \
  libcypher-parser-dev libgraphblas-dev \
  curl git python3

if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi
# shellcheck disable=SC1091
source "$HOME/.cargo/env"

if [[ ! -d "$SRC/.git" ]]; then
  echo "[hydradb] cloning https://github.com/hydra-db/hydradb"
  git clone --depth 1 https://github.com/hydra-db/hydradb "$SRC"
fi

cd "$SRC"
echo "[hydradb] compiling graph-node (this takes a while)"
cargo build --locked --features server-runtime --bin graph-node --release

BIN="$SRC/target/release/graph-node"
if [[ ! -x "$BIN" ]]; then
  echo "[hydradb] expected binary missing: $BIN" >&2
  exit 1
fi

# WSL builds stay as a Linux binary launched via `wsl`. Native Linux copies
# into ~/.chronicle/hydradb/bin so Electron can spawn graph-node directly.
if grep -qi microsoft /proc/version 2>/dev/null; then
  echo "$BIN" > "$MARKER"
  echo "[hydradb] WSL binary ready: $BIN"
  echo "[hydradb] marker written: $MARKER"
else
  HOST_BIN="$(dirname "$MARKER")/bin/graph-node"
  mkdir -p "$(dirname "$HOST_BIN")"
  cp "$BIN" "$HOST_BIN"
  chmod +x "$HOST_BIN"
  echo "[hydradb] native binary ready: $HOST_BIN"
fi

echo "[hydradb] next: npm run memory:start"
