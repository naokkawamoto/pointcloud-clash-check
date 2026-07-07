import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

/** 2点クリックの距離計測ツール */
export class MeasureTool {
  constructor(scene, listEl) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.listEl = listEl;
    this.pending = null; // 1点目
    this.measurements = [];
    this._markerGeom = new THREE.SphereGeometry(1, 12, 8);
    this._markerMat = new THREE.MeshBasicMaterial({ color: 0xffd54f, depthTest: false });
    this.renderList();
  }

  onClick(raycaster, pickables) {
    const hits = raycaster.intersectObjects(pickables, true);
    if (!hits.length) return;
    const p = hits[0].point.clone();
    const r = Math.max(0.008, raycaster.ray.origin.distanceTo(p) * 0.007);
    this.addPoint(p, r);
  }

  addPoint(p, r = 0.03) {
    const marker = new THREE.Mesh(this._markerGeom, this._markerMat);
    marker.scale.setScalar(r);
    marker.position.copy(p);
    marker.renderOrder = 999;
    this.group.add(marker);

    if (!this.pending) {
      this.pending = { p, marker };
      return;
    }

    const a = this.pending.p;
    const b = p;
    const dist = a.distanceTo(b);

    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([a, b]),
      new THREE.LineBasicMaterial({ color: 0xffd54f, depthTest: false }),
    );
    line.renderOrder = 999;
    this.group.add(line);

    const div = document.createElement('div');
    div.className = 'measure-label';
    div.textContent = `${dist.toFixed(3)} m`;
    const label = new CSS2DObject(div);
    label.position.copy(a).add(b).multiplyScalar(0.5);
    this.group.add(label);

    this.measurements.push({
      markerA: this.pending.marker,
      markerB: marker,
      line,
      label,
      dist,
      dz: Math.abs(b.z - a.z),
    });
    this.pending = null;
    this.renderList();
  }

  cancelPending() {
    if (!this.pending) return;
    this.group.remove(this.pending.marker);
    this.pending = null;
  }

  remove(m) {
    const i = this.measurements.indexOf(m);
    if (i === -1) return;
    this.group.remove(m.markerA, m.markerB, m.line, m.label);
    m.line.geometry.dispose();
    m.label.element.remove();
    this.measurements.splice(i, 1);
    this.renderList();
  }

  clearAll() {
    this.cancelPending();
    for (const m of [...this.measurements]) this.remove(m);
  }

  renderList() {
    this.listEl.innerHTML = '';
    if (!this.measurements.length) {
      this.listEl.innerHTML = '<p class="note">計測モードで2点をクリック</p>';
      return;
    }
    this.measurements.forEach((m, i) => {
      const row = document.createElement('div');
      row.className = 'row';
      const span = document.createElement('span');
      span.textContent = `#${i + 1}  ${m.dist.toFixed(3)} m（Δ高さ ${m.dz.toFixed(3)}）`;
      const del = document.createElement('button');
      del.className = 'mini';
      del.textContent = '✕';
      del.onclick = () => this.remove(m);
      row.append(span, del);
      this.listEl.appendChild(row);
    });
  }
}
