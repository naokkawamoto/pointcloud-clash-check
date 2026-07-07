#!/bin/bash
# 公開サンプルデータのダウンロード (samples/ に保存)
# 大物(Redwood 4棟, Rohbau3D)の取得手順は README.md を参照
set -e
cd "$(dirname "$0")/../samples"

dl() {
  if [ -f "$2" ]; then echo "skip: $2 (exists)"; else
    echo "get:  $2"
    curl -sL -o "$2" "$1"
  fi
}

dl "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/ply/binary/Lucy100k.ply" Lucy100k.ply
dl "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/ply/ascii/dolphins.ply" dolphins.ply
dl "https://github.com/visgl/loaders.gl/raw/master/modules/las/test/data/indoor.laz" indoor.laz
dl "https://github.com/PDAL/PDAL/raw/master/test/data/las/autzen_trim.las" autzen_trim.las
dl "https://github.com/isl-org/open3d_downloads/releases/download/20220201-data/fragment.ply" livingroom_fragment.ply

# Stanford bunny (tar.gz展開が必要)
if [ ! -f stanford_bunny.ply ]; then
  echo "get:  stanford_bunny.ply"
  curl -sL -o bunny.tar.gz "http://graphics.stanford.edu/pub/3Dscanrep/bunny.tar.gz"
  tar xzf bunny.tar.gz bunny/reconstruction/bun_zipper.ply
  mv bunny/reconstruction/bun_zipper.ply stanford_bunny.ply
  rm -rf bunny bunny.tar.gz
fi

echo "done. -> $(pwd)"
ls -lh
