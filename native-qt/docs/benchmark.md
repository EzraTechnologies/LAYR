# On-hardware comparison with Chromium

This repository does not contain a Pi measurement. Do not treat the offscreen screenshots, or a laptop run, as evidence that Qt is faster or slower than Chromium. WPE WebKit Cog 0.16.1 was already found sluggish on this Pi 4; Chromium is the thing to compare against.

Run both samples yourself, on the same Pi, with the same print (or both idle), and keep the existing display stack installed.

## What to record

For each UI, for 60 seconds idle on the home screen and again while a print is moving:

- resident memory (RSS)
- CPU percent of that one process
- time from process start until the first frame, when the UI can report it
- touch to the next visible change

Qt writes the last two into the on-screen "This process" card and, if you pass `--perf-log`, a JSON line per sample. Those numbers are only the Qt process. Chromium does not emit the same touch probe. Use the sampler below for CPU and RSS of both, and a camera or a stopwatch for Chromium touch latency so the method matches.

## CPU and RSS

The sampler only reads `/proc`. It does not signal the process.

```bash
# Chromium kiosk, or whatever the panel is running. Find the pid yourself.
./native-qt/scripts/bench-sample.sh --comm chromium --seconds 60 --out /tmp/chromium-idle.csv

# In another shell, one Qt window. This does not stop Chromium.
./native-qt/scripts/launch-session.sh --geometry 1024x600
# Then, from a second shell, sample the python pid printed by ps.
./native-qt/scripts/bench-sample.sh --pid PID --seconds 60 --out /tmp/qt-idle.csv
```

Repeat while a known G-code file is printing. Compare the two CSV files. A single short sample is not a result.

Startup for Qt is `startupMs` in the settings card: monotonic time from process start to the first rendered frame. For Chromium, time `systemctl show -p ActiveEnterTimestamp layr-kiosk.service` against when the page is visibly up, or start Chromium yourself with a stopwatch. Do not mix those methods and call them the same metric.

## Touch latency

Qt records the delay from a pointer press to the next frame (`touchMs`, and a rolling `touchP50Ms`). That includes the touch stack only up to Qt's input event, then until the scene graph swaps a frame. It does not include the panel's own scan-out delay.

Chromium has no matching probe in LAYR. A fair check is a high-frame-rate video of the same tap target on each UI, counted from finger-down to the pixel change. Report both or neither.

## Rules for the write-up

- Say which image, kernel, panel mode, and whether the UI was fullscreen or a window.
- Say whether Cage, Xorg, or a desktop compositor was running.
- Publish the CSV files with the notes.
- If the Qt window was offscreen or on a PC, it is not a Pi result.
