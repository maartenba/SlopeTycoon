#!/bin/zsh
# mega sheet: scripts/promo/mega.sh <tag> <res> shotPrefix...  -> one row of 5 frames per shot (.weave/promo/sheets/mega-<tag>.png)
tag=$1; res=$2; shift 2; rows=()
for p in "$@"; do d=$(ls -d .weave/promo/frames/$res/$p* | head -1); total=$(ls $d/*.jpg | wc -l | tr -d ' ')
  ffmpeg -v error -y -framerate 12 -i $d/%05d.jpg -vf "select='not(mod(n\,$(( (total-1) / 4 ))))',scale=384:-1,tile=5x1" -frames:v 1 /private/tmp/mega-$p.png; rows+=(-i /private/tmp/mega-$p.png); done
ffmpeg -v error -y ${rows[@]} -filter_complex "vstack=inputs=$#" .weave/promo/sheets/mega-$tag.png && echo .weave/promo/sheets/mega-$tag.png
