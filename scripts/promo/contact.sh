#!/bin/zsh
# contact sheet of a shot: scripts/promo/contact.sh <shot-prefix> <tag> [res=draft] [n=8]  -> .weave/promo/sheets/<shot>-<tag>.png
res=${3:-draft}; n=${4:-8}; d=$(ls -d .weave/promo/frames/$res/$1* | head -1); id=$(basename $d)
mkdir -p .weave/promo/sheets; total=$(ls $d/*.jpg | wc -l | tr -d ' ')
ffmpeg -v error -y -framerate 12 -i $d/%05d.jpg -vf "select='not(mod(n\,$(( total / n ))))',scale=480:-1,tile=4x$(( (n+3)/4 ))" -frames:v 1 .weave/promo/sheets/$id-$2.png && echo .weave/promo/sheets/$id-$2.png
