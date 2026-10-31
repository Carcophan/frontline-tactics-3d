#!/usr/bin/env bash
# ==============================================================================
# Frontline Tactics 3D (Risiko) - Desktop Game Launcher
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

PORT="${PORT:-5174}"
URL="http://localhost:${PORT}"
PID_FILE="$SCRIPT_DIR/.vite.pid"
LOG_FILE="$SCRIPT_DIR/.server.log"

# Function: Stop the server
stop_server() {
  echo "Stoppe Frontline Tactics 3D Server..."
  local stopped=0
  
  if [ -f "$PID_FILE" ]; then
    PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null || true
      sleep 0.5
      kill -9 "$PID" 2>/dev/null || true
      stopped=1
    fi
    rm -f "$PID_FILE"
  fi

  # Also ensure any lingering vite process on this port started by this script is terminated
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${PORT}/tcp" 2>/dev/null || true
  fi

  if [ $stopped -eq 1 ]; then
    echo "Server erfolgreich beendet."
    command -v notify-send >/dev/null 2>&1 && notify-send -i "$SCRIPT_DIR/icon.svg" "Frontline Tactics 3D" "Server wurde beendet." || true
  else
    echo "Kein aktiver Server gefunden."
  fi
}

# Handle --stop argument
if [ "$1" = "--stop" ]; then
  stop_server
  exit 0
fi

# Detect Chrome binary if not already set
if [ -z "$CHROME_BIN" ]; then
  for bin in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$bin" >/dev/null 2>&1; then
      CHROME_BIN="$(command -v "$bin")"
      break
    fi
  done
fi

if [ -z "$CHROME_BIN" ]; then
  echo "Fehler: Google Chrome konnte nicht gefunden werden!" >&2
  command -v notify-send >/dev/null 2>&1 && notify-send -u critical "Frontline Tactics 3D" "Google Chrome wurde nicht gefunden." || true
  exit 1
fi

# Check if our server is already responding
is_server_ready() {
  curl -s -m 1 -o /dev/null -w "%{http_code}" "$URL" 2>/dev/null | grep -q "200"
}

# Check if process from PID file is running
is_pid_running() {
  if [ -f "$PID_FILE" ]; then
    local p
    p="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

if is_pid_running && is_server_ready; then
  echo "Frontline Tactics 3D Server läuft bereits auf $URL (PID: $(cat "$PID_FILE"))"
else
  # If port is used by an unknown process, warn or clean up PID file
  if is_server_ready; then
    echo "Ein Server antwortet bereits auf $URL."
  else
    echo "Starte Frontline Tactics 3D Dev-Server auf Port $PORT..."
    
    # Start Vite server in background (detached with setsid and stdin closed)
    setsid nohup npm run dev -- --port "$PORT" </dev/null > "$LOG_FILE" 2>&1 &
    SERVER_PID=$!
    echo "$SERVER_PID" > "$PID_FILE"

    # Wait for server to be responsive (up to 12 seconds)
    READY=0
    for i in $(seq 1 48); do
      if is_server_ready; then
        READY=1
        break
      fi
      # Check if process died prematurely
      if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "Server-Prozess unerwartet beendet. Siehe Log in $LOG_FILE" >&2
        exit 1
      fi
      sleep 0.25
    done

    if [ $READY -ne 1 ]; then
      echo "Fehler: Zeitüberschreitung beim Starten des Servers!" >&2
      command -v notify-send >/dev/null 2>&1 && notify-send -u critical "Frontline Tactics 3D" "Serverstart fehlgeschlagen (Timeout)." || true
      exit 1
    fi
    echo "Server ist bereit auf $URL!"
  fi
fi

# Notify user
command -v notify-send >/dev/null 2>&1 && notify-send -i "$SCRIPT_DIR/icon.svg" "Frontline Tactics 3D" "Spiel wird in Chrome gestartet..." || true

# Launch Chrome
# Default: Chrome App-Mode (fullscreen/standalone gaming window without browser address bar)
# Pass --tab to open as normal browser tab
if [ "$1" = "--tab" ]; then
  exec "$CHROME_BIN" "$URL"
else
  exec "$CHROME_BIN" --app="$URL"
fi
