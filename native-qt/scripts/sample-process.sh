#!/bin/sh
# Sample RSS and CPU ticks for one existing process. Read-only.
# Usage: sample-process.sh <pid> [seconds]
set -eu
pid=${1:?pid}
seconds=${2:-60}
if ! [ -d "/proc/$pid" ]; then
  echo "No such process $pid" >&2
  exit 1
fi
echo "ms,rss_kib,cpu_ticks"
end=$(awk -v extra="$seconds" '{print int($1)+extra}' /proc/uptime)
while true; do
  now=$(awk '{print int($1*1000)}' /proc/uptime)
  rss=$(awk '/^VmRSS:/ {print $2}' "/proc/$pid/status" 2>/dev/null || echo "")
  if [ -z "$rss" ]; then
    echo "process $pid exited" >&2
    exit 0
  fi
  ticks=$(python3 -c 'import pathlib,sys; pid=sys.argv[1]; text=pathlib.Path("/proc/"+pid+"/stat").read_text(); rest=text[text.rfind(")")+2:].split(); print(int(rest[11])+int(rest[12]))' "$pid")
  echo "$now,$rss,$ticks"
  up=$(awk '{print int($1)}' /proc/uptime)
  if [ "$up" -ge "$end" ]; then
    break
  fi
  sleep 1
done
