import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { ObjectManager, generateDemoCloud, createAsset, applyColorMode } from './objects.js';
import { loadFile } from './io.js';
import { MeasureTool } from './measure.js';
import { CollisionChecker } from './collision.js';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

// ---------- 基本セットアップ（Z-up・単位m） ----------
const viewport = document.getElementById('viewport');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15181e);

const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 5000);
camera.up.set(0, 0, 1);
camera.position.set(9, -9, 7);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.id = 'labels';
viewport.appendChild(labelRenderer.domElement);

function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
}
new ResizeObserver(resize).observe(viewport);
resize();

const grid = new THREE.GridHelper(20, 20, 0x3a4150, 0x262c36);
grid.rotation.x = Math.PI / 2;
scene.add(grid);
scene.add(new THREE.AxesHelper(1.5));

scene.add(new THREE.HemisphereLight(0xcfd8ea, 0x30363f, 1.0));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
dirLight.position.set(5, -8, 12);
scene.add(dirLight);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.12;

// ---------- 管理・ツール ----------
const manager = new ObjectManager(scene);
const measure = new MeasureTool(scene, document.getElementById('measure-list'));
const collision = new CollisionChecker(scene, manager, document.getElementById('collision-status'));

const tc = new TransformControls(camera, renderer.domElement);
scene.add(tc.getHelper ? tc.getHelper() : tc);
tc.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; });
tc.addEventListener('objectChange', () => {
  updateSelectionBox();
  collision.schedule();
});

// ---------- 選択 ----------
let mode = 'select';
let selected = null;
let currentPointSize = 0.03;
let colorMode = 'rgb';

const selBox = new THREE.Box3Helper(new THREE.Box3(), 0xffc107);
selBox.visible = false;
scene.add(selBox);

function updateSelectionBox() {
  if (selected) {
    selBox.box.setFromObject(selected.root);
    selBox.visible = true;
  } else {
    selBox.visible = false;
  }
}

function select(item) {
  selected = item;
  updateSelectionBox();
  if (item && (mode === 'translate' || mode === 'rotate' || mode === 'scale')) {
    tc.attach(item.root);
  } else {
    tc.detach();
  }
  renderObjectList();
}

// ---------- モード ----------
const HINTS = {
  select: 'クリックで選択 ／ ドラッグで視点操作（左:回転 右:平行移動 ホイール:ズーム）',
  translate: 'ギズモをドラッグして移動',
  rotate: 'ギズモをドラッグして回転',
  scale: 'ギズモをドラッグして拡大・縮小',
  measure: '2点をクリックすると距離を計測（点群にスナップ）',
};

function setMode(m) {
  mode = m;
  document.querySelectorAll('#toolbar button[data-mode]').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === m);
  });
  if (m === 'translate' || m === 'rotate' || m === 'scale') {
    tc.setMode(m);
    if (selected) tc.attach(selected.root);
    else tc.detach();
  } else {
    tc.detach();
  }
  if (m !== 'measure') measure.cancelPending();
  setHint(HINTS[m]);
}

const hintEl = document.getElementById('hint');
function setHint(text) {
  hintEl.textContent = text || HINTS[mode];
}

// ---------- クリック（配置・選択・計測） ----------
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
let pendingAsset = null; // クリック配置待ちのアセット種別
let downPos = null;

renderer.domElement.addEventListener('pointerdown', (e) => {
  downPos = [e.clientX, e.clientY];
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downPos) return;
  const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
  downPos = null;
  if (moved > 5 || e.button !== 0 || tc.dragging) return;

  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  raycaster.params.Points.threshold = Math.max(0.04, currentPointSize * 2);

  // アセットのクリック配置（点群面にヒットしなければ地面 z=0 に置く）
  if (pendingAsset) {
    const kind = pendingAsset;
    pendingAsset = null;
    const hits = raycaster.intersectObjects(manager.pickables, true);
    const p = hits.length
      ? hits[0].point.clone()
      : raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
    if (p) addAsset(kind, p);
    else setHint('');
    return;
  }

  if (mode === 'measure') {
    measure.onClick(raycaster, manager.pickables);
    return;
  }
  const hits = raycaster.intersectObjects(manager.pickables, true);
  select(hits.length ? manager.itemFromObject(hits[0].object) : null);
});

// ---------- オブジェクト一覧 ----------
const listEl = document.getElementById('object-list');
const statsEl = document.getElementById('scene-stats');

function renderObjectList() {
  listEl.innerHTML = '';
  for (const item of manager.items) {
    const row = document.createElement('div');
    row.className = 'obj-row'
      + (selected === item ? ' selected' : '')
      + (item.visible ? '' : ' hidden-item');

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `${item.type === 'points' ? '●' : '■'} ${item.name}`;
    name.title = item.name;

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = item.type === 'points'
      ? `${item.pointCount.toLocaleString()}点`
      : `${Math.round(item.triCount).toLocaleString()}面`;

    const eye = document.createElement('button');
    eye.textContent = item.visible ? '👁' : '－';
    eye.title = '表示/非表示';
    eye.onclick = (e) => { e.stopPropagation(); manager.setVisible(item, !item.visible); };

    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = '削除';
    del.onclick = (e) => {
      e.stopPropagation();
      if (selected === item) select(null);
      manager.remove(item);
    };

    row.append(name, meta, eye, del);
    row.onclick = () => select(item);
    listEl.appendChild(row);
  }
  statsEl.textContent = `${manager.items.length} オブジェクト ／ ${manager.totalPoints.toLocaleString()} 点`;
}

manager.onChange = () => {
  renderObjectList();
  collision.schedule();
};

// ---------- カメラフィット ----------
function fitCameraTo(box) {
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const dist = Math.max(2, size * 0.8);
  camera.position.copy(center).add(new THREE.Vector3(0.8, -1, 0.65).normalize().multiplyScalar(dist));
  orbit.target.copy(center);
}

function fitCameraToAll() {
  const box = new THREE.Box3();
  for (const item of manager.items) box.expandByObject(item.root);
  fitCameraTo(box);
}

// ---------- 追加系 ----------
function registerPointsItem(item) {
  for (const p of item.points) p.material.size = currentPointSize;
  // 色情報なしの点群は 'rgb' 指定でも高さグラデーションにフォールバックされる
  applyColorMode(item, colorMode);
}

function addDemo() {
  const { object } = generateDemoCloud();
  const item = manager.add(object, { name: 'デモ点群（現場）', type: 'points' });
  registerPointsItem(item);
  return item;
}

function addAsset(kind, position = null) {
  const { mesh, name } = createAsset(kind);
  if (position) {
    // クリック地点に底面を合わせて配置
    mesh.position.copy(position);
    mesh.position.z += mesh.userData.baseOffset ?? 0;
  } else {
    mesh.position.x += (Math.random() - 0.5) * 1.5;
    mesh.position.y += (Math.random() - 0.5) * 1.5;
  }
  const item = manager.add(mesh, { name, type: 'mesh' });
  select(item);
  if (mode === 'select') setMode('translate');
  setHint('');
  return item;
}

async function handleFiles(files) {
  for (const f of files) {
    setHint(`読み込み中: ${f.name} …`);
    try {
      const res = await loadFile(f);
      const item = manager.add(res.root, { name: f.name, type: res.type, offset: res.offset });
      registerPointsItem(item);
      if (res.offset && res.offset.length && res.offset.length() > 1000) {
        console.info(`[${f.name}] 原点補正 offset =`, res.offset);
      }
      const box = new THREE.Box3().setFromObject(item.root);
      fitCameraTo(box);
    } catch (err) {
      console.error(err);
      alert(`${f.name} の読み込みに失敗しました:\n${err.message}`);
    }
  }
  setHint('');
}

// ---------- UI配線 ----------
document.querySelectorAll('#toolbar button[data-mode]').forEach((b) => {
  b.addEventListener('click', () => setMode(b.dataset.mode));
});
document.getElementById('collision-toggle').addEventListener('change', (e) => {
  collision.setEnabled(e.target.checked);
});

document.getElementById('btn-demo').addEventListener('click', addDemo);
document.querySelectorAll('[data-asset]').forEach((b) => {
  b.addEventListener('click', () => {
    pendingAsset = b.dataset.asset;
    setHint('配置したい場所（点群の上）をクリックしてください（Esc:取消）');
  });
});

const fileInput = document.getElementById('file-input');
document.getElementById('btn-open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) handleFiles([...fileInput.files]);
  fileInput.value = '';
});

const sizeInput = document.getElementById('point-size');
sizeInput.addEventListener('input', () => {
  currentPointSize = parseFloat(sizeInput.value);
  for (const item of manager.items) {
    for (const p of item.points) p.material.size = currentPointSize;
  }
  collision.highlight.material.size = currentPointSize * 2;
});

document.getElementById('color-mode').addEventListener('change', (e) => {
  colorMode = e.target.value;
  for (const item of manager.items) applyColorMode(item, colorMode);
});

document.getElementById('btn-clear-measure').addEventListener('click', () => measure.clearAll());

// ドラッグ&ドロップ
['dragenter', 'dragover'].forEach((ev) => {
  viewport.addEventListener(ev, (e) => {
    e.preventDefault();
    viewport.classList.add('dragging');
  });
});
viewport.addEventListener('dragleave', (e) => {
  if (e.target === viewport) viewport.classList.remove('dragging');
});
viewport.addEventListener('drop', (e) => {
  e.preventDefault();
  viewport.classList.remove('dragging');
  if (e.dataTransfer?.files?.length) handleFiles([...e.dataTransfer.files]);
});

// キーボード
window.addEventListener('keydown', (e) => {
  const t = e.target.tagName;
  if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
  switch (e.key.toLowerCase()) {
    case 'q': setMode('select'); break;
    case 'w': setMode('translate'); break;
    case 'e': setMode('rotate'); break;
    case 'r': setMode('scale'); break;
    case 'm': setMode('measure'); break;
    case 'escape':
      pendingAsset = null;
      measure.cancelPending();
      select(null);
      setHint('');
      break;
    case 'delete':
    case 'backspace':
      if (selected) {
        const it = selected;
        select(null);
        manager.remove(it);
      }
      break;
  }
});

// ---------- 初期シーン（サンプル点群を自動読込） ----------
setMode('select');
setHint('サンプル点群を読込中… (rohbau_site02_scan0.ply, 約 55MB)');
(async () => {
  try {
    const url = new URL('samples/rohbau_site02_scan0.ply', import.meta.env.BASE_URL || './').href;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    await handleFiles([new File([buf], 'rohbau_site02_scan0.ply')]);
  } catch (err) {
    console.error('サンプル自動読込失敗:', err);
    setHint('サンプル自動読込に失敗。デモ点群を代わりに表示します');
    addDemo();
    fitCameraToAll();
  }
})();

// ---------- 描画ループ ----------
renderer.setAnimationLoop(() => {
  orbit.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
});

// デバッグ・検証用
window.__pg = {
  THREE, scene, camera, orbit, renderer, manager, collision, measure, setMode, select, addDemo, addAsset,
  loadFileBuffer: async (name, buf) => handleFiles([new File([buf], name)]),
};
