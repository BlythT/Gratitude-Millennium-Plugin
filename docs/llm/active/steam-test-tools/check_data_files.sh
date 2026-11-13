#!/usr/bin/env bash
# Usage: check_data_files.sh <mtime snapshot file>
# Checks every store file is non-empty and parses, compares mtimes with the snapshot, and lists
# any leftover .tmp or .corrupted copies. Prints no file contents.
cd /home/tim/personalprojects/Gratitude-Millennium-Plugin || exit 1
SNAPSHOT=$1
status=0
for f in backend/gratitude_*.json; do
    if [ ! -s "$f" ]; then
        echo "EMPTY $f"
        status=1
        continue
    fi
    if python3 -I -c 'import json, sys; json.load(open(sys.argv[1]))' "$f" 2>/dev/null; then
        result="parses"
    else
        result="DOES NOT PARSE"
        status=1
    fi
    before=$(grep -F " $f" "$SNAPSHOT" | cut -d' ' -f1)
    now=$(stat -c '%Y' "$f")
    if [ "$before" = "$now" ]; then changed="mtime unchanged"; else changed="REWRITTEN"; fi
    echo "$result, $changed: $f"
done
ls backend | grep -E '\.tmp$|\.corrupted\.' | sed 's/^/extra copy: /'
exit $status
