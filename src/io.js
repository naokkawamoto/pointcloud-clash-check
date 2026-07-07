import * as THREE from 'three';
import { parse } from '@loaders.gl/core';
import { LASLoader } from '@loaders.gl/las';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { PCDLoader } from 'three/addons/loaders/PCDLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { makePointCloudFromArrays } from './objects.js';

/** ファイル1つを読み込み { root, type, offset } を返す */
export async function loadFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  switch (ext) {
    case 'las':
    case 'laz':
      return loadLAS(file);
    case 'ply':
      return loadPLY(file);
    case 'pcd':
      return loadPCD(file);
    case 'xyz':
    case 'txt':
    case 'csv':
    case 'pts':
      return loadXYZ(file);
    case 'glb':
    case 'gltf':
      return loadGLTF(file);
    case 'obj':
      return loadOBJ(file);
    case 'stl':
      return loadSTL(file);
    default:
      throw new Error(`未対応の形式です (.${ext})`);
  }
}

/** 色配列を Float32Array(n*3, 0..1) に正規化 */
function normalizeColors(value, size, n) {
  const out = new Float32Array(n * 3);
  let scale = 1;
  if (value instanceof Uint16Array) {
    scale = 1 / 65535;
  } else if (value instanceof Uint8Array || value instanceof Uint8ClampedArray) {
    scale = 1 / 255;
  } else {
    let max = 0;
    for (let i = 0; i < Math.min(value.length, 3000); i++) max = Math.max(max, value[i]);
    scale = max > 255 ? 1 / 65535 : max > 1 ? 1 / 255 : 1;
  }
  for (let i = 0; i < n; i++) {
    out[i * 3] = value[i * size] * scale;
    out[i * 3 + 1] = value[i * size + 1] * scale;
    out[i * 3 + 2] = value[i * size + 2] * scale;
  }
  return out;
}

async function loadLAS(file) {
  const buf = await file.arrayBuffer();
  const dv = new DataView(buf);
  const compressed = (dv.getUint8(104) & 0x80) !== 0; // LAZは点フォーマットの上位ビットが立つ

  if (compressed) {
    // LAZ: loaders.gl (laz-perf) で解凍
    const data = await parse(buf, LASLoader, { worker: false, las: { fp64: true } });
    const positions = data.attributes.POSITION.value;
    const n = Math.floor(positions.length / 3);
    let colors = null;
    const c0 = data.attributes.COLOR_0;
    if (c0 && c0.value) colors = normalizeColors(c0.value, c0.size || 3, n);
    if (colors && !colors.some((v) => v > 0)) colors = null; // RGBフィールドが空(全ゼロ)のファイル
    const iv = data.attributes.intensity?.value;
    if (!colors && iv && iv.some((v) => v > 0)) {
      colors = intensityToGray(iv, n);
    }
    const { object, offset } = makePointCloudFromArrays(positions, colors);
    return { root: object, type: 'points', offset };
  }

  // 非圧縮LAS: 自前パース（16bitカラーを正確に読む）
  const { positions, colors } = parseLASBuffer(buf);
  const { object, offset } = makePointCloudFromArrays(positions, colors);
  return { root: object, type: 'points', offset };
}

/** 反射強度をグレースケール色に変換（外れ値対策で98パーセンタイル正規化） */
function intensityToGray(iv, n) {
  const sampleStep = Math.max(1, Math.floor(n / 50000));
  const sample = [];
  for (let i = 0; i < n; i += sampleStep) sample.push(iv[i]);
  sample.sort((a, b) => a - b);
  const p98 = Math.max(1, sample[Math.floor(sample.length * 0.98)]);
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const g = 0.15 + Math.min(1, iv[i] / p98) * 0.85;
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = g;
  }
  return colors;
}

/** 非圧縮LAS 1.2〜1.4 のパーサー（点フォーマット 0〜3, 6〜8） */
function parseLASBuffer(buf) {
  const dv = new DataView(buf);
  if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'LASF') {
    throw new Error('LASファイルではありません（シグネチャ不一致）');
  }
  const versionMinor = dv.getUint8(25);
  const dataOffset = dv.getUint32(96, true);
  const format = dv.getUint8(104) & 0x3f;
  const recLen = dv.getUint16(105, true);
  let count = dv.getUint32(107, true); // legacy count
  if (count === 0 && versionMinor >= 4) count = Number(dv.getBigUint64(247, true));

  const sx = dv.getFloat64(131, true), sy = dv.getFloat64(139, true), sz = dv.getFloat64(147, true);
  const ox = dv.getFloat64(155, true), oy = dv.getFloat64(163, true), oz = dv.getFloat64(171, true);

  const COLOR_OFFSET = { 2: 20, 3: 28, 5: 28, 7: 30, 8: 30 };
  const colOff = COLOR_OFFSET[format] ?? -1;
  const maxCount = Math.floor((buf.byteLength - dataOffset) / recLen);
  count = Math.min(count, maxCount);

  const positions = new Float64Array(count * 3);
  const raw = colOff >= 0 ? new Uint16Array(count * 3) : null;
  const intensity = new Uint16Array(count);
  let maxColor = 0;
  let maxIntensity = 0;

  for (let i = 0; i < count; i++) {
    const o = dataOffset + i * recLen;
    positions[i * 3] = dv.getInt32(o, true) * sx + ox;
    positions[i * 3 + 1] = dv.getInt32(o + 4, true) * sy + oy;
    positions[i * 3 + 2] = dv.getInt32(o + 8, true) * sz + oz;
    const iv = dv.getUint16(o + 12, true);
    intensity[i] = iv;
    if (iv > maxIntensity) maxIntensity = iv;
    if (raw) {
      const r = dv.getUint16(o + colOff, true);
      const g = dv.getUint16(o + colOff + 2, true);
      const b = dv.getUint16(o + colOff + 4, true);
      raw[i * 3] = r; raw[i * 3 + 1] = g; raw[i * 3 + 2] = b;
      if (r > maxColor) maxColor = r;
      if (g > maxColor) maxColor = g;
      if (b > maxColor) maxColor = b;
    }
  }

  let colors = null;
  if (raw && maxColor > 0) {
    // 8bit格納か16bit格納かを値域で判定
    const scale = maxColor > 255 ? 1 / 65535 : 1 / 255;
    colors = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) colors[i] = raw[i] * scale;
  } else if (maxIntensity > 0) {
    // RGBフィールドが無い/全ゼロ → 反射強度で着色
    colors = intensityToGray(intensity, count);
  }
  return { positions, colors };
}

/** スキャン由来メッシュの巨大座標(UTM等)対策 */
function recenterGeometryIfFar(geom) {
  geom.computeBoundingBox();
  const c = geom.boundingBox.getCenter(new THREE.Vector3());
  if (c.length() > 1000) {
    geom.translate(-c.x, -c.y, -c.z);
    return c;
  }
  return null;
}

const PLY_TYPE_SIZE = {
  char: 1, uchar: 1, int8: 1, uint8: 1,
  short: 2, ushort: 2, int16: 2, uint16: 2,
  int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4,
  double: 8, float64: 8,
};

/**
 * 点群バイナリPLYの高速パーサー。
 * PLYLoaderは中間データを通常のJS配列に積むため、数百万点で
 * ピークメモリが数百MBになる。スキャン点群(面なし・スカラー属性のみ・
 * binary_little_endian)はここで直接TypedArrayに読む。
 * 対象外の形式は null を返し PLYLoader にフォールバック。
 */
function parsePointCloudPLY(buf) {
  const headBytes = new Uint8Array(buf, 0, Math.min(buf.byteLength, 4096));
  const headText = new TextDecoder().decode(headBytes);
  const endIdx = headText.indexOf('end_header\n');
  if (endIdx === -1 || !headText.startsWith('ply')) return null;
  const dataOffset = endIdx + 'end_header\n'.length;
  const lines = headText.slice(0, endIdx).split('\n').map((l) => l.trim());

  if (!lines.some((l) => l === 'format binary_little_endian 1.0')) return null;

  let vertexCount = 0;
  let inVertex = false;
  const props = []; // {name, size}
  for (const line of lines) {
    const t = line.split(/\s+/);
    if (t[0] === 'element') {
      if (t[1] === 'vertex') { vertexCount = parseInt(t[2]); inVertex = true; }
      else {
        if (t[1] === 'face' && parseInt(t[2]) > 0) return null; // メッシュはPLYLoaderへ
        inVertex = false;
      }
    } else if (t[0] === 'property' && inVertex) {
      if (t[1] === 'list') return null; // リスト属性は対象外
      const size = PLY_TYPE_SIZE[t[1]];
      if (!size) return null;
      props.push({ name: t[2], type: t[1], size });
    }
  }
  if (!vertexCount || !props.length) return null;

  let stride = 0;
  const offsets = {};
  for (const p of props) { offsets[p.name] = { off: stride, type: p.type }; stride += p.size; }
  const need = ['x', 'y', 'z'];
  if (!need.every((n) => offsets[n])) return null;

  const count = Math.min(vertexCount, Math.floor((buf.byteLength - dataOffset) / stride));
  const dv = new DataView(buf);
  const readerOf = ({ off, type }) => {
    switch (type) {
      case 'double': case 'float64': return (o) => dv.getFloat64(o + off, true);
      case 'float': case 'float32': return (o) => dv.getFloat32(o + off, true);
      case 'uchar': case 'uint8': return (o) => dv.getUint8(o + off);
      case 'ushort': case 'uint16': return (o) => dv.getUint16(o + off, true);
      case 'char': case 'int8': return (o) => dv.getInt8(o + off);
      case 'short': case 'int16': return (o) => dv.getInt16(o + off, true);
      default: return (o) => dv.getInt32(o + off, true);
    }
  };
  const [rx, ry, rz] = [offsets.x, offsets.y, offsets.z].map(readerOf);
  const positions = new Float64Array(count * 3);

  // 色: red/green/blue または diffuse_red/... に対応
  const cKeys = offsets.red ? ['red', 'green', 'blue']
    : offsets.diffuse_red ? ['diffuse_red', 'diffuse_green', 'diffuse_blue'] : null;
  let colors = null, cr, cg, cb, cScale = 1;
  if (cKeys && cKeys.every((k) => offsets[k])) {
    [cr, cg, cb] = cKeys.map((k) => readerOf(offsets[k]));
    const t = offsets[cKeys[0]].type;
    cScale = (t === 'uchar' || t === 'uint8') ? 1 / 255
      : (t === 'ushort' || t === 'uint16') ? 1 / 65535 : 1;
    colors = new Float32Array(count * 3);
  }

  for (let i = 0; i < count; i++) {
    const o = dataOffset + i * stride;
    positions[i * 3] = rx(o);
    positions[i * 3 + 1] = ry(o);
    positions[i * 3 + 2] = rz(o);
    if (colors) {
      colors[i * 3] = cr(o) * cScale;
      colors[i * 3 + 1] = cg(o) * cScale;
      colors[i * 3 + 2] = cb(o) * cScale;
    }
  }
  return { positions, colors };
}

async function loadPLY(file) {
  const buf = await file.arrayBuffer();

  // 点群PLYの高速パス（メッシュ・ASCII等は従来のPLYLoaderで処理）
  const fast = parsePointCloudPLY(buf);
  if (fast) {
    const { object, offset } = makePointCloudFromArrays(fast.positions, fast.colors);
    return { root: object, type: 'points', offset };
  }

  const geom = new PLYLoader().parse(buf);

  if (geom.index && geom.index.count > 0) {
    // メッシュPLY
    const offset = recenterGeometryIfFar(geom);
    if (!geom.getAttribute('normal')) geom.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xb8bcc4,
      roughness: 0.7,
      side: THREE.DoubleSide,
      vertexColors: !!geom.getAttribute('color'),
    });
    return { root: new THREE.Mesh(geom, mat), type: 'mesh', offset };
  }

  // 点群PLY
  const pos = geom.getAttribute('position').array;
  const colAttr = geom.getAttribute('color');
  const n = Math.floor(pos.length / 3);
  const colors = colAttr ? normalizeColors(colAttr.array, colAttr.itemSize, n) : null;
  const { object, offset } = makePointCloudFromArrays(pos, colors);
  return { root: object, type: 'points', offset };
}

async function loadPCD(file) {
  const pts = new PCDLoader().parse(await file.arrayBuffer());
  const pos = pts.geometry.getAttribute('position').array;
  const colAttr = pts.geometry.getAttribute('color');
  const n = Math.floor(pos.length / 3);
  const colors = colAttr ? normalizeColors(colAttr.array, colAttr.itemSize, n) : null;
  const { object, offset } = makePointCloudFromArrays(pos, colors);
  return { root: object, type: 'points', offset };
}

async function loadXYZ(file) {
  const text = await file.text();
  const lines = text.split('\n');
  const P = [];
  const C = [];
  let hasColor = false;

  for (const line of lines) {
    const cols = line.trim().split(/[,;\s]+/).map(Number);
    if (cols.length < 3 || cols.slice(0, 3).some(Number.isNaN)) continue; // ヘッダ行等をスキップ
    P.push(cols[0], cols[1], cols[2]);
    // 6列: x y z r g b / 7列(PTS): x y z intensity r g b
    let rgb = null;
    if (cols.length >= 7 && !Number.isNaN(cols[6])) rgb = [cols[4], cols[5], cols[6]];
    else if (cols.length >= 6 && !Number.isNaN(cols[5])) rgb = [cols[3], cols[4], cols[5]];
    if (rgb) {
      hasColor = true;
      const s = Math.max(rgb[0], rgb[1], rgb[2]) > 1 ? 1 / 255 : 1;
      C.push(rgb[0] * s, rgb[1] * s, rgb[2] * s);
    } else {
      C.push(0.75, 0.75, 0.75);
    }
  }
  if (P.length === 0) throw new Error('座標データが見つかりません');

  const { object, offset } = makePointCloudFromArrays(
    new Float64Array(P),
    hasColor ? new Float32Array(C) : null,
  );
  return { root: object, type: 'points', offset };
}

async function loadGLTF(file) {
  const gltf = await new GLTFLoader().parseAsync(await file.arrayBuffer(), '');
  const root = gltf.scene;
  root.rotation.x = Math.PI / 2; // glTFはY-up → このシーンはZ-up
  return { root, type: 'mesh', offset: null };
}

async function loadOBJ(file) {
  const root = new OBJLoader().parse(await file.text());
  root.rotation.x = Math.PI / 2; // OBJもY-up想定
  return { root, type: 'mesh', offset: null };
}

async function loadSTL(file) {
  const geom = new STLLoader().parse(await file.arrayBuffer());
  const offset = recenterGeometryIfFar(geom);
  const mat = new THREE.MeshStandardMaterial({ color: 0xa8b6c8, roughness: 0.6, metalness: 0.1 });
  return { root: new THREE.Mesh(geom, mat), type: 'mesh', offset };
}
