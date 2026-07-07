# Point Cloud 3D Playground

A browser-based playground for point clouds (from insightScanX / Pix4D / any LiDAR)
and 3D assets: **transform, measure, and clash-check** — everything runs client-side,
no data leaves the machine.

Built with Three.js + three-mesh-bvh (BVH collision) + a custom binary parser
for LAS / point-cloud PLY.

## Quick start

```bash
npm install
npm run dev   # http://localhost:5192
```

Requires Node.js 18+.

## Features

| Feature | How |
|---|---|
| Load data | Drag & drop LAS / LAZ / PLY / PCD / XYZ / PTS / GLB / OBJ / STL |
| Place assets | Click an asset button (box / pipe / sphere / duct / **stairs**), then click a point on the cloud — the asset lands on the clicked surface |
| Transform | Select object → move / rotate / scale gizmo (Q/W/E/R keys) |
| Measure | M key → click 2 points (snaps to cloud points), shows distance + Δheight |
| Clash detection | Toolbar checkbox. Mesh×mesh via BVH; points×mesh via inside-mesh parity test — intruding points are highlighted red with an estimated count |
| Display | Point size slider, color mode (RGB / height gradient / single) |
| Demo data | "デモ点群を生成" button generates a synthetic job-site cloud (floor, walls, pipes, column) |

Coordinate system: **Z-up, meters**. Huge UTM coordinates are auto-recentered
(offset kept on the item). glTF/OBJ (Y-up) are rotated to Z-up on import.

## Sample data

Small samples are included in `samples/`. Large ones (Redwood room scans,
Rohbau3D construction site) can be re-fetched — see `README.md` (Japanese)
for sources, or run:

```bash
./scripts/fetch_samples.sh   # downloads the public small samples
```

- **rohbau_site02_scan0.ply** — real shell-construction site scan (3.6M pts, RGB),
  extracted from [Rohbau3D](https://github.com/RauchLukas/rohbau3d)
  (research dataset — credit the source if shown externally)
- **apartment_1m.ply** — real apartment scan (1M pts), from
  [Redwood Indoor Lidar-RGBD](http://redwood-data.org/indoor_lidar_rgbd/) (research use)

`scripts/downsample_ply.js` converts/downsamples huge double-precision PLYs
(e.g. Redwood originals) into browser-friendly float PLYs:

```bash
node scripts/downsample_ply.js input.ply output.ply 6   # keep every 6th point
```

## Code map

```
index.html        UI layout (sidebar / toolbar / statusbar)
src/main.js       scene setup, modes, selection, click-to-place, wiring
src/objects.js    ObjectManager, assets (incl. parametric stairs), demo cloud, color modes
src/io.js         file loaders — fast binary PLY & LAS parsers, LAZ via loaders.gl,
                  PCD/XYZ/GLB/OBJ/STL
src/measure.js    2-point distance tool (CSS2D labels)
src/collision.js  clash detection (BVH mesh×mesh, point-in-mesh parity, red highlight)
```

Implementation notes:
- Uncompressed LAS is parsed by hand (loaders.gl mangles 16-bit LAS colors);
  loaders.gl is used only for LAZ decompression.
- Point-cloud binary PLY has a custom fast path (~7× faster than THREE.PLYLoader,
  ~half the peak memory at 5M points). Mesh/ASCII PLY falls back to PLYLoader.
- Points×mesh clash subsamples to ~20k tests per pair; the reported count is an estimate.

## Known limits

- E57 not supported (convert to LAS/PLY with CloudCompare)
- No points×points clash
- Tens of millions of points will be slow — downsample first
