#!/usr/bin/env bash
# Sample another process's CPU and RSS. Does not signal that process.
#
#   ./scripts/bench-sample.sh --pid 123 --seconds 30 --out /tmp/layr-bench.csv
#   ./scripts/bench-sample.sh --comm chromium --seconds 30 --out /tmp/chromium.csv
#
# CPU percent is one process's utime+stime over wall time. It is not a claim
# that Qt is faster. Run the same command against Chromium and against this
# prototype on the Pi before comparing.
set -euo pipefail

PID=""
COMM=""
SECONDS_N=30
OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --pid) PID="$2"; shift 2 ;;
    --comm) COMM="$2"; shift 2 ;;
    --seconds) SECONDS_N="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$OUT" ]; then
  echo "Pass --out path.csv" >&2
  exit 2
fi
case "$SECONDS_N" in
  ''|*[!0-9]*) echo "Seconds must be a number" >&2; exit 2 ;;
esac

if [ -z "$PID" ] && [ -n "$COMM" ]; then
  PID=$(ps -eo pid,comm | awk -v name="$COMM" '$2==name {print $1; exit}')
fi
if [ -z "$PID" ] || [ ! -r "/proc/${PID}/stat" ]; then
  echo "Could not read /proc for that process." >&2
  exit 1
fi

HZ=$(getconf CLK_TCK)
echo "elapsed_s,rss_kib,cpu_percent" > "$OUT"
prev_ticks=""
prev_ms=$(date +%s%3N)
i=0
while [ "$i" -lt "$SECONDS_N" ]; do
  if [ ! -r "/proc/${PID}/stat" ]; then
    echo "Process ${PID} exited during the sample." >&2
    exit 1
  fi
  rss=$(awk '/^VmRSS:/ {print $2}' "/proc/${PID}/status")
  ticks=$(awk -F')' '{split($2, a, " "); print a[12] + a[13]}' "/proc/${PID}/stat")
  now_ms=$(date +%s%3N)
  cpu=""
  if [ -n "$prev_ticks" ]; then
    dt_ms=$((now_ms - prev_ms))
    dt_ticks=$((ticks - prev_ticks))
    if [ "$dt_ms" -gt 0 ]; then
      cpu=$(awk -v ticks="$dt_ticks" -v ms="$dt_ms" -v hz="$HZ" 'BEGIN { printf "%.1f", (ticks / hz) / (ms / 1000) * 100 }')
    fi
  fi
  echo "${i},${rss:-},${cpu}" >> "$OUT"
  prev_ticks=$ticks
  prev_ms=$now_ms
  i=$((i + 1))
  sleep 1
done
echo "Wrote ${OUT} for pid ${PID}. This file is not a speed ranking."
