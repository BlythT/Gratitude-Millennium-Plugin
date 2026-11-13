#!/usr/bin/env bash
# Usage: kill_mid_sync.sh <steam|luahost> [timeout seconds]
# Waits for the third licence page save after it starts, then kill -9s the target.
LOG=~/.local/share/Steam/logs/console-linux.txt
TARGET=$1
TIMEOUT=${2:-180}
START=$(wc -l < "$LOG")
seen=0
for ((i = 0; i < TIMEOUT * 10; i++)); do
    seen=$(tail -n +$((START + 1)) "$LOG" | grep -a -c 'SetGameLicenseData called')
    if [ "$seen" -ge 3 ]; then
        if [ "$TARGET" = "steam" ]; then
            pid=$(pgrep -x steam)
        else
            pid=$(pgrep -f 'libmillennium_luavm_x86 .*gratitude' | head -1)
        fi
        if [ -z "$pid" ]; then
            echo "no $TARGET process found"
            exit 1
        fi
        kill -KILL "$pid" && echo "killed $TARGET (pid $pid) after $seen page saves at $(date +%T.%3N)"
        exit 0
    fi
    sleep 0.1
done
echo "timed out after ${TIMEOUT}s with $seen page saves seen"
exit 1
