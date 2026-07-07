import * as THREE from 'three';

let nextId = 1;

/** シーン内オブジェクト（点群・メッシュ）の管理 */
export class ObjectManager {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.onChange = null;
  }

  add(root, { name, type, offset = null }) {
    const item = {
      id: nextId++,
      name,
      type, // 'points' | 'mesh'
      root,
      meshes: [],
      points: [],
      pointCount: 0,
      triCount: 0,
      offset, // 巨大座標(UTM等)を原点付近に平行移動した量
      visible: true,
      baseBox: new THREE.Box3(),
    };
    root.userData.itemId = item.id;
    this.scene.add(root);
    root.updateWorldMatrix(true, true);

    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const tmpBox = new THREE.Box3();
    const rel = new THREE.Matrix4();
    root.traverse((c) => {
      if (c.isMesh && c.geometry) {
        item.meshes.push(c);
        const idx = c.geometry.index;
        item.triCount += Math.floor((idx ? idx.count : c.geometry.getAttribute('position').count) / 3);
        if (!c.geometry.boundsTree) c.geometry.computeBoundsTree();
        if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
      } else if (c.isPoints && c.geometry) {
        item.points.push(c);
        item.pointCount += c.geometry.getAttribute('position').count;
        if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
      }
      if ((c.isMesh || c.isPoints) && c.geometry) {
        rel.copy(inv).multiply(c.matrixWorld);
        tmpBox.copy(c.geometry.boundingBox).applyMatrix4(rel);
        item.baseBox.union(tmpBox);
      }
    });

    this.items.push(item);
    this.onChange?.();
    return item;
  }

  remove(item) {
    const i = this.items.indexOf(item);
    if (i === -1) return;
    this.scene.remove(item.root);
    item.root.traverse((c) => {
      if (c.geometry) {
        if (c.geometry.boundsTree) c.geometry.disposeBoundsTree();
        c.geometry.dispose();
      }
      if (c.material) {
        (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m.dispose());
      }
    });
    this.items.splice(i, 1);
    this.onChange?.();
  }

  get(id) {
    return this.items.find((it) => it.id === id) || null;
  }

  itemFromObject(obj) {
    let o = obj;
    while (o) {
      if (o.userData.itemId) return this.get(o.userData.itemId);
      o = o.parent;
    }
    return null;
  }

  setVisible(item, v) {
    item.visible = v;
    item.root.visible = v;
    this.onChange?.();
  }

  get pickables() {
    return this.items.filter((it) => it.visible).map((it) => it.root);
  }

  get totalPoints() {
    return this.items.reduce((s, it) => s + it.pointCount, 0);
  }
}

/**
 * 座標配列から点群オブジェクトを作る。
 * recenter=true のとき UTM 等の巨大座標を bbox 中心で原点付近に平行移動する。
 */
export function makePointCloudFromArrays(positions, colors, { recenter = true } = {}) {
  const n = Math.floor(positions.length / 3);
  const offset = new THREE.Vector3();
  let pos32;

  if (recenter && n > 0) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    offset.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    pos32 = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos32[i * 3] = positions[i * 3] - offset.x;
      pos32[i * 3 + 1] = positions[i * 3 + 1] - offset.y;
      pos32[i * 3 + 2] = positions[i * 3 + 2] - offset.z;
    }
  } else {
    pos32 = positions instanceof Float32Array ? positions : new Float32Array(positions);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos32, 3));

  let colArr;
  if (colors && colors.length >= n * 3) {
    colArr = colors instanceof Float32Array ? colors : new Float32Array(colors);
  } else {
    colArr = new Float32Array(n * 3).fill(0.75);
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  geom.computeBoundingBox();

  const mat = new THREE.PointsMaterial({ size: 0.03, vertexColors: true });
  const pts = new THREE.Points(geom, mat);
  pts.userData.originalColors = colors ? colArr.slice() : null;
  return { object: pts, offset };
}

/** 点群のカラーモード切替: 'rgb' | 'height' | 'single' */
export function applyColorMode(item, mode) {
  const c = new THREE.Color();
  for (const pts of item.points) {
    const geom = pts.geometry;
    const attr = geom.getAttribute('color');
    if (!attr) continue;
    const orig = pts.userData.originalColors;

    if (mode === 'rgb' && orig) {
      attr.array.set(orig);
    } else if (mode === 'single') {
      for (let i = 0; i < attr.count; i++) attr.setXYZ(i, 0.42, 0.62, 0.85);
    } else {
      // height（RGBなしのrgb指定もここにフォールバック）
      geom.computeBoundingBox();
      const zmin = geom.boundingBox.min.z;
      const range = Math.max(1e-6, geom.boundingBox.max.z - zmin);
      const p = geom.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const t = (p.getZ(i) - zmin) / range;
        c.setHSL(0.66 - t * 0.66, 0.85, 0.5);
        attr.setXYZ(i, c.r, c.g, c.b);
      }
    }
    attr.needsUpdate = true;
  }
}

/** 階段: 側面プロファイル(のこぎり形)を押し出した水密な一体ジオメトリ */
function makeStairsGeometry({ steps = 6, riser = 0.18, tread = 0.25, width = 0.9 } = {}) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  for (let i = 0; i < steps; i++) {
    shape.lineTo(i * tread, (i + 1) * riser);
    shape.lineTo((i + 1) * tread, (i + 1) * riser);
  }
  shape.lineTo(steps * tread, 0);
  shape.closePath();
  const geom = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geom.rotateX(Math.PI / 2); // プロファイルをXZ面(Z-up)に、奥行きをY方向に
  geom.translate(-steps * tread / 2, width / 2, 0); // 原点=底面中央
  geom.computeVertexNormals();
  return geom;
}

/**
 * 追加できる3Dアセット（Z-up・単位m）。
 * baseOffset = 原点から底面までの距離（点群表面に置くときに使う）
 */
export function createAsset(kind) {
  let geom, color, z, name, baseOffset;
  switch (kind) {
    case 'pipe':
      geom = new THREE.CylinderGeometry(0.1, 0.1, 2, 24).rotateZ(Math.PI / 2); // 軸をX方向に
      color = 0x7f96b2; z = 1.0; name = '配管 φ200×2m'; baseOffset = 0.1;
      break;
    case 'sphere':
      geom = new THREE.SphereGeometry(0.4, 32, 16);
      color = 0x74b06c; z = 0.4; name = '球 φ800'; baseOffset = 0.4;
      break;
    case 'duct':
      geom = new THREE.BoxGeometry(2, 0.5, 0.35);
      color = 0xb08fc9; z = 1.8; name = 'ダクト 500×350×2m'; baseOffset = 0.175;
      break;
    case 'stairs':
      geom = makeStairsGeometry();
      color = 0xc9a26b; z = 0; name = '階段 6段(蹴上180×踏面250)'; baseOffset = 0;
      break;
    case 'box':
    default:
      geom = new THREE.BoxGeometry(1, 1, 1);
      color = 0xe0a03c; z = 0.55; name = '箱 1m'; baseOffset = 0.5;
      break;
  }
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.15 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(0, 0, z);
  mesh.userData.baseOffset = baseOffset;
  return { mesh, name };
}

/** 現場スキャン風のデモ点群（床・壁2面・配管2本・柱） 約10万点 */
export function generateDemoCloud() {
  const P = [];
  const C = [];
  const r = Math.random;
  const push = (x, y, z, cr, cg, cb) => { P.push(x, y, z); C.push(cr, cg, cb); };

  // 床 10m × 8m（コンクリート）
  for (let x = -5; x <= 5; x += 0.04) {
    for (let y = -4; y <= 4; y += 0.04) {
      const g = 0.38 + r() * 0.1;
      push(x + (r() - 0.5) * 0.01, y + (r() - 0.5) * 0.01, (r() - 0.5) * 0.012, g, g, g * 1.04);
    }
  }
  // 壁 x=-5（高さ3m）
  for (let y = -4; y <= 4; y += 0.05) {
    for (let z = 0; z <= 3; z += 0.05) {
      const g = 0.55 + r() * 0.08;
      push(-5 + (r() - 0.5) * 0.015, y + (r() - 0.5) * 0.01, z + (r() - 0.5) * 0.01, g, g * 0.97, g * 0.9);
    }
  }
  // 壁 y=4
  for (let x = -5; x <= 5; x += 0.05) {
    for (let z = 0; z <= 3; z += 0.05) {
      const g = 0.55 + r() * 0.08;
      push(x + (r() - 0.5) * 0.01, 4 + (r() - 0.5) * 0.015, z + (r() - 0.5) * 0.01, g, g * 0.97, g * 0.9);
    }
  }
  // 天井付近の配管 2本（y=3.4 / 3.0, z=2.3, 半径0.12）
  for (const py of [3.4, 3.0]) {
    for (let x = -5; x <= 5; x += 0.02) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 10) {
        const nz = (r() - 0.5) * 0.008;
        push(x, py + Math.cos(a) * 0.12, 2.3 + Math.sin(a) * 0.12 + nz, 0.34 + r() * 0.06, 0.44 + r() * 0.06, 0.6 + r() * 0.06);
      }
    }
  }
  // 柱 0.4m角 at (2, -1)
  for (let z = 0; z <= 3; z += 0.03) {
    for (let t = 0; t <= 0.4; t += 0.03) {
      const g = 0.5 + r() * 0.07;
      push(1.8 + t, -1.2, z, g, g, g);
      push(1.8 + t, -0.8, z, g, g, g);
      push(1.8, -1.2 + t, z, g, g, g);
      push(2.2, -1.2 + t, z, g, g, g);
    }
  }

  return makePointCloudFromArrays(new Float32Array(P), new Float32Array(C), { recenter: false });
}
