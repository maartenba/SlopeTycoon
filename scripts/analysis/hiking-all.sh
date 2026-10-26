#!/bin/sh
# Full hiking analysis in chunks (one vitest process per size/scenario group; keeps each process short). Then prints the merged tables.
# Usage: sh scripts/analysis/hiking-all.sh [seeds]   (default seeds: 11,23,37,41,59)
SEEDS=${1:-11,23,37,41,59}
OUT=scripts/analysis/out
rm -f $OUT/*.json
run() { # size scenarios tag
  for try in 1 2 3; do
    HIKING_SIZES=$1 HIKING_SCENARIOS=$2 HIKING_SEEDS=$SEEDS HIKING_OUT=$OUT/$1_$3.json npm run analysis:hiking >/tmp/hiking_$1_$3.log 2>&1 && { grep '^\[' /tmp/hiking_$1_$3.log; return; }
  done
  echo "FAILED $1 $2 (see /tmp/hiking_$1_$3.log)"
}
for size in 64 128 256; do
  run $size legacy,new a
done
npm run analysis:hiking:report
