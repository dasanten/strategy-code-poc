#!/usr/bin/env bash
# waits until no cargo/rustc process has run for $1 seconds (sampled every 15 s), then runs the rest
need=${1:-60}; shift; quiet=0
while [ $quiet -lt $need ]; do
  n=$(powershell -NoProfile -Command "(Get-Process cargo,rustc -ErrorAction SilentlyContinue | Measure-Object).Count" | tr -d '\r')
  if [ "$n" = "0" ]; then quiet=$((quiet+15)); else quiet=0; fi
  sleep 15
done
echo "quiet at $(date +%H:%M:%S)"; "$@"
