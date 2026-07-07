# 点群3Dプレイグラウンド

insightScanX / Pix4D などで取得した点群と3Dフリーアセットをブラウザで読み込み、
**移動・回転・スケール／2点間計測／衝突判定** ができる実験用Webアプリ。

## 起動

```bash
npm install
npm run dev   # http://localhost:5192
```

## 対応形式

| 種類 | 形式 | 備考 |
|------|------|------|
| 点群 | LAS / LAZ | loaders.gl（fp64読込→原点付近に自動平行移動、UTM座標OK）|
| 点群 | PLY / PCD / XYZ / PTS / TXT / CSV | PLYは面があればメッシュとして読込 |
| メッシュ | GLB / GLTF / OBJ | Y-up→Z-upに自動回転 |
| メッシュ | STL | |

読み込みはサイドバーの「ファイルを開く」またはドラッグ&ドロップ。
全処理はブラウザ内で完結（データはどこにも送信されない）。

## 機能

- **座標系**: Z-up・単位m（スキャンデータ準拠）
- **変換**: 選択 → 移動/回転/拡縮ギズモ（Q/W/E/R）
- **計測**: Mキー → 2点クリックで距離（点群スナップ、Δ高さも表示）
- **衝突判定**（ツールバーのチェックボックス）
  - メッシュ×メッシュ: three-mesh-bvh の BVH 交差判定
  - 点群×メッシュ: 点の内外判定（レイ交差の偶奇）。干渉点を赤ハイライト＋点数表示
  - 点群×点群: 未対応
- **表示**: 点サイズ、カラーモード（RGB / 高さグラデーション / 単色）
- **デモ**: 「デモ点群を生成」で現場風の合成点群（床・壁・配管・柱、約10万点）

## samples/ のデータ

| ファイル | 内容 | 出典 |
|---|---|---|
| rohbau_site02_scan0.ply | **建設中の躯体(RC造)実スキャン** 365万点, RGB, 31.5×30m | [Rohbau3D](https://github.com/RauchLukas/rohbau3d) (UniBw München, Dataverse) |
| apartment_5m.ply / apartment_1m.ply | 実在マンション1住戸の実スキャン(RGB付き, 原本2,988万点を1/6・1/30に間引き) | [Redwood Indoor Lidar-RGBD](http://redwood-data.org/indoor_lidar_rgbd/)(研究用途) |
| bedroom_4m.ply | 寝室 実スキャン 422万点 7.2×7.1m | 同上 |
| boardroom_5m.ply | 会議室 実スキャン 506万点 9.3×13.5m | 同上 |
| lobby_5m.ply | ロビー 実スキャン 475万点 13.7×8.7m | 同上 |
| loft_4m.ply | ロフト(2層吹抜) 実スキャン 451万点 高さ9.4m | 同上 |
| livingroom_fragment.ply | リビングの実スキャン断片(19.6万点, RGB) | Open3D サンプルデータ |
| livingroom.ply | リビング一室のモデル(ICL-NUIM) | Open3D / augmented ICL-NUIM |
| indoor.laz | 建物内部LiDAR(80.8万点, 色なし→高さ着色) | loaders.gl テストデータ |
| autzen_trim.las | 航空測量(11万点, RGB, UTM座標) | PDAL テストデータ |
| stanford_bunny.ply ほか | スキャンメッシュの定番 | Stanford 3D Scanning Repository |

Redwood 5棟の原本(435MB〜856MB, double座標)は容量節約のため削除済み。再取得は
Redwood download ページの各「merged & resampled」(Google Drive)から。
Rohbau3D は Dataverse の tar.zst をRangeリクエストで先頭だけ取得し、
scene_02000 の coord.npy + color.npy をPLYに変換したもの(全体は数十GB)。

## 実装メモ

- 点群バイナリPLYは自前の高速パーサーで読む(4.75M点: PLYLoader比 約7倍高速・
  ピークメモリ約半減)。メッシュPLY・ASCII PLYは従来どおりPLYLoaderにフォールバック。

## 既知の制限

- LAZ の解凍(laz-perf wasm)は初回にネットワークが必要な場合がある
- E57 は未対応（CloudCompare 等で LAS/PLY に変換して読み込む）
- 点群×メッシュの衝突は最大2万点に間引きサンプリング（点数は推定値）
- 大規模点群(数千万点)はそのままでは重い。事前に間引き推奨
