#!/bin/sh
# usage: scripts/glitch-shot.sh <name> <type> <spread> <seed> <season> <hour> [zoom] [yaw]
N=$1; T=$2; SP=$3; SEED=$4; SEA=$5; HR=$6; Z=${7:-8}; Y=${8:-0.8}
npm run shot -- --size 128 --seed $SEED --start $SEA --hour $HR --ticks 1 --w 900 --h 600 --out glitch-$N --eval "window.__G={type:'$T',sp:$SP,zoom:$Z,yaw:$Y,clear:5};$(cat scripts/glitch-scene.js)" 2>&1 | grep -a "^\[log\] placed\|no spot\|^saved\|pageerror"
