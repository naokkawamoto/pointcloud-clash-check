import * as THREE from 'three';

const _matA = new THREE.Matrix4();
const _boxA = new THREE.Box3();
const _boxB = new THREE.Box3();

/**
 * 衝突判定:
 *  - メッシュ×メッシュ: three-mesh-bvh の intersectsGeometry
 *  - 点群×メッシュ: 各点をメッシュ内外判定（レイの交差回数の偶奇）。侵入点を赤くハイライト
 *  - 点群×点群: 未対応
 */
export class CollisionChecker {
  constructor(scene, manager, statusEl) {
    this.scene = scene;
    this.manager = manager;
    this.statusEl = statusEl;
    this.enabled = false;
    this._last = 0;
    this._timer = 0;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    this.highlight = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: 0xff3333, size: 0.06, depthTest: false }),
    );
    this.highlight.renderOrder = 998;
    this.highlight.frustumCulled = false;
    this.highlight.visible = false;
    scene.add(this.highlight);
  }

  setEnabled(v) {
    this.enabled = v;
    if (v) this.run();
    else {
      this.resetVisuals();
      this.statusEl.textContent = '';
      this.statusEl.className = '';
    }
  }

  /** 変形操作中の間引き実行 */
  schedule() {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this._last > 120) {
      this.run();
    } else {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.run(), 130);
    }
  }

  resetVisuals() {
    for (const item of this.manager.items) {
      for (const m of item.meshes) {
        const mat = m.material;
        if (m.userData._origEmissive !== undefined && mat && mat.emissive) {
          mat.emissive.setHex(m.userData._origEmissive);
          delete m.userData._origEmissive;
        }
      }
    }
    this.highlight.visible = false;
  }

  _tint(item) {
    for (const m of item.meshes) {
      const mat = m.material;
      if (mat && mat.emissive) {
        if (m.userData._origEmissive === undefined) m.userData._origEmissive = mat.emissive.getHex();
        mat.emissive.setHex(0xbb2020);
      }
    }
  }

  run() {
    this._last = performance.now();
    this.resetVisuals();
    if (!this.enabled) return;

    this.scene.updateMatrixWorld(true);
    const items = this.manager.items.filter((it) => it.visible);
    const hitPositions = [];
    const pairs = [];

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const res = this._checkPair(items[i], items[j], hitPositions);
        if (res) {
          pairs.push({ a: items[i], b: items[j], points: res.points });
          this._tint(items[i]);
          this._tint(items[j]);
        }
      }
    }

    const arr = new Float32Array(hitPositions);
    this.highlight.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.highlight.geometry.computeBoundingSphere();
    this.highlight.visible = hitPositions.length > 0;

    if (!pairs.length) {
      this.statusEl.textContent = '✓ 衝突なし';
      this.statusEl.className = 'ok';
    } else {
      const desc = pairs
        .map((p) => `${p.a.name} × ${p.b.name}${p.points ? `（約${p.points.toLocaleString()}点が干渉）` : ''}`)
        .join(' ／ ');
      this.statusEl.textContent = `⚠ 衝突: ${desc}`;
      this.statusEl.className = 'ng';
    }
  }

  _checkPair(a, b, hitPositions) {
    _boxA.copy(a.baseBox).applyMatrix4(a.root.matrixWorld);
    _boxB.copy(b.baseBox).applyMatrix4(b.root.matrixWorld);
    if (!_boxA.intersectsBox(_boxB)) return null;

    let meshHit = false;
    outer: for (const ma of a.meshes) {
      for (const mb of b.meshes) {
        if (meshIntersectsMesh(ma, mb)) { meshHit = true; break outer; }
      }
    }

    let cnt = 0;
    for (const pts of a.points) for (const m of b.meshes) cnt += pointsInsideMesh(pts, m, hitPositions);
    for (const pts of b.points) for (const m of a.meshes) cnt += pointsInsideMesh(pts, m, hitPositions);

    if (meshHit || cnt > 0) return { points: cnt };
    return null;
  }
}

function meshIntersectsMesh(ma, mb) {
  const bvh = ma.geometry.boundsTree;
  if (!bvh) return false;
  _matA.copy(ma.matrixWorld).invert().multiply(mb.matrixWorld);
  return bvh.intersectsGeometry(mb.geometry, _matA);
}

const _toLocal = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _ray = new THREE.Ray();
// 軸平行な面(床など)との同一平面上レイを避けるため斜め方向に飛ばす
const _rayDir = new THREE.Vector3(0.5735, 0.5735, 0.585).normalize();

/**
 * 点群のうちメッシュ内部にある点を数える(間引きサンプリング)。
 * hitPositions にワールド座標を追記。戻り値は推定干渉点数。
 */
function pointsInsideMesh(ptsObj, mesh, hitPositions, maxChecks = 20000) {
  const bvh = mesh.geometry.boundsTree;
  const bbox = mesh.geometry.boundingBox;
  if (!bvh || !bbox) return 0;

  const posAttr = ptsObj.geometry.getAttribute('position');
  const n = posAttr.count;
  const step = Math.max(1, Math.floor(n / maxChecks));
  _toLocal.copy(mesh.matrixWorld).invert().multiply(ptsObj.matrixWorld);

  let hits = 0;
  for (let i = 0; i < n; i += step) {
    _p.fromBufferAttribute(posAttr, i).applyMatrix4(_toLocal);
    if (!bbox.containsPoint(_p)) continue;
    _ray.origin.copy(_p);
    _ray.direction.copy(_rayDir);
    const res = bvh.raycast(_ray, THREE.DoubleSide);
    if (res.length % 2 === 1) {
      hits++;
      if (hitPositions.length < 60000) {
        _p.fromBufferAttribute(posAttr, i).applyMatrix4(ptsObj.matrixWorld);
        hitPositions.push(_p.x, _p.y, _p.z);
      }
    }
  }
  return hits * step;
}
