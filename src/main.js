import * as THREE from 'three';

// ================= 설정 =================
const FIELD_W = 7;          // 전장: x -7 ~ 7 (적이 내려오는 곳)
const LANE_GAP = 0.5;       // 전장과 옆 구역 사이 간격
const LANE_W = 4;           // 옆 독립 구역 폭
const LANE_X = FIELD_W + LANE_GAP + LANE_W / 2;   // 옆 구역 중심 (왼쪽 -, 오른쪽 +)
const WORLD_HALF = FIELD_W + LANE_GAP + LANE_W;   // 대포·병사가 갈 수 있는 x 한계
const SPAWN_Z = -16;        // 적 생성 위치
const BASE_Z = 8;           // 방어선
const CANNON_Z = 9;
const MAX_SOLDIERS = 10000;
const MAX_ENEMIES = 1500;
const SOLDIER_SPEED = 3;
const SOLDIER_R = 0.3;
const HOMING_R = 3.5;       // 유도 감지 반경
const ENEMY_HOMING_R = 3;   // 적 유도 감지 반경
const HOMING_SLOW = 0.6;    // 유도 중인 병사·적의 전진 속도 배율
const GATE_SLOTS = 4;
const MAX_CANNONS = 7;
const CANNON_SCALE = 0.8;   // 대포 모델 크기 (밀집 배치용)
const CANNON_SPACING = 1.15; // 인접 대포 사이 거리

// 대포 n대의 대형 오프셋 [dx, dz]: 정다각형으로 둥글게 밀집, 7대는 가운데 1 + 둘레 6
const CANNON_OFFSETS = [];
for (let n = 0; n <= MAX_CANNONS; n++) {
  const list = [];
  if (n === 1) list.push([0, 0]);
  else if (n >= 2) {
    const ring = n === MAX_CANNONS ? n - 1 : n;
    const r = n === 2 ? CANNON_SPACING / 2 : CANNON_SPACING / (2 * Math.sin(Math.PI / ring));
    const start = n === 2 ? 0 : ring % 2 === 0 ? -Math.PI / 2 + Math.PI / ring : -Math.PI / 2;
    if (n === MAX_CANNONS) list.push([0, 0]);
    for (let k = 0; k < ring; k++) {
      const a = start + (2 * Math.PI * k) / ring;
      list.push([r * Math.cos(a), r * Math.sin(a)]);
    }
  }
  CANNON_OFFSETS.push(list);
}
const WAVE_DUR = 14;        // 일반 웨이브 길이(초), 일반 3웨이브 + 보스 웨이브
const SPAWN_MULT = 1;      // 적 생성량 배율 (성능 확인할 때만 올린다)
const BASE_HP = 20;

// 공격속도 6단계 (발사 간격) / 다음 단계에 필요한 타격 수
const FIRE_INTERVALS = [1.00, 0.82, 0.67, 0.55, 0.45, 0.35];
const HIT_TARGETS = [20, 40, 70, 110, 160];
const LEVEL_COLORS = [0x6b7480, 0x4fa3ff, 0x4fe0a0, 0xd8e04f, 0xff9a2a, 0xffd23a];

// 적 종류
const E_NORMAL = 0, E_RUNNER = 1, E_TANK = 2, E_BOSS = 3;
const ETYPE = [
  { name: '일반병', hp: 1, speed: 1,   r: 0.45, scale: 1,   dmg: 1, score: 1,   color: 0xe84a4a },
  { name: '러너',   hp: 2, speed: 2,   r: 0.35, scale: 0.8, dmg: 1, score: 2,   color: 0xff9a2a },
  { name: '탱커',   hp: 8, speed: 0.6, r: 0.8,  scale: 1.9, dmg: 3, score: 5,   color: 0x7a3fb0 },
  { name: '보스',   hp: 0, speed: 0.3, r: 1.6,  scale: 4,   dmg: 10, score: 100, color: 0x8b1a1a },
];

// 게이트는 맵 좌우를 꽉 채운다: 한 줄에 1개(전체 폭) 또는 2개(각 절반 폭). [op, val, x, z, 폭]
const rowOf1 = ([op, val], z) => [[op, val, 0, z, FIELD_W * 2]];
const rowOf2 = ([op1, v1], [op2, v2], z) => [
  [op1, v1, -FIELD_W / 2, z, FIELD_W],
  [op2, v2, FIELD_W / 2, z, FIELD_W],
];

// 스테이지 5개
const STAGES = [
  {
    desc: '일반병이 밀려옵니다.\n파란 게이트로 병사를 늘리세요.\n노란 구역: 크리스털 타격 → 공격속도 · 초록 구역: + 상자 → 대포 추가',
    gates: [...rowOf2(['×', 2], ['+', 10], 3)],
    crystal: true, items: true, crystalSide: -1, itemSide: 1, // 테스트용: 1스테이지부터 강화 전부 등장
    runner: 0, tank: 0,
    boss: { name: '거대병', hp: 60, speed: 0.3, dmg: 10 },
  },
  {
    desc: '러너 등장!\n노란 크리스털을 타격하면 공격속도가 오릅니다.',
    gates: [...rowOf2(['×', 2], ['+', 10], 3), ...rowOf1(['×', 3], 0)],
    crystal: true, items: true, crystalSide: 1, itemSide: -1,
    runner: 0.25, tank: 0,
    boss: { name: '질주 대장', hp: 80, speed: 0.5, dmg: 10, escort: 8 },
  },
  {
    desc: '탱커 등장!\n내려오는 초록 + 상자에 대포를 닿게 하면 대포가 늘어납니다.',
    gates: [...rowOf2(['×', 2], ['+', 10], 3), ...rowOf1(['×', 3], 0)],
    crystal: true, items: true, crystalSide: -1, itemSide: 1,
    runner: 0.25, tank: 0.12,
    boss: { name: '철갑 거인', hp: 200, speed: 0.2, dmg: 10 },
  },
  {
    desc: '물량이 늘어납니다.\n게이트가 부서지지 않게 막으세요.',
    gates: [...rowOf2(['×', 2], ['+', 10], 3), ...rowOf1(['×', 3], 0), ...rowOf1(['+', 15], -3)],
    crystal: true, items: true, crystalSide: 1, itemSide: -1,
    runner: 0.3, tank: 0.15,
    boss: { name: '소환사', hp: 250, speed: 0.3, dmg: 10, summon: 4 },
  },
  {
    desc: '최종 스테이지!\n보스가 방어선에 닿으면 끝입니다.',
    gates: [...rowOf2(['×', 2], ['+', 10], 3), ...rowOf1(['×', 3], 0), ...rowOf1(['+', 15], -3)],
    crystal: true, items: true, crystalSide: -1, itemSide: 1,
    runner: 0.3, tank: 0.2,
    boss: { name: '최종 보스', hp: 500, speed: 0.25, dmg: 20, summon: 3.5 },
  },
];

// ================= 렌더러 / 씬 =================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b2430);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
// 전장 + 옆 구역이 모두 보이도록 화면 비율에 맞춰 카메라 거리를 조정
function fitCamera() {
  camera.aspect = innerWidth / innerHeight;
  const dir = new THREE.Vector3(0, 20, 18);
  const len = dir.length();
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const needW = WORLD_HALF * 2 + 3;
  const w = 2 * halfH * len * camera.aspect;
  dir.setLength(w < needW ? (len * needW) / w : len);
  camera.position.set(0, 0, -1).add(dir);
  camera.lookAt(0, 0, -1);
  camera.updateProjectionMatrix();
}
fitCamera();

scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(5, 15, 8);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(FIELD_W * 2, 40),
  new THREE.MeshStandardMaterial({ color: 0x3b5b3b })
);
ground.rotation.x = -Math.PI / 2;
ground.position.z = -5;
scene.add(ground);

// 옆 독립 구역: 왼쪽 = 2번 타격 강화(크리스털), 오른쪽 = 3번 대포 추가 아이템
// 어느 쪽이 어떤 역할인지는 스테이지마다 다르다 (loadStage에서 색을 지정)
const lanes = {};
for (const sign of [-1, 1]) {
  const lane = new THREE.Mesh(
    new THREE.PlaneGeometry(LANE_W, 40),
    new THREE.MeshStandardMaterial({ color: 0x444444 })
  );
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(sign * LANE_X, 0, -5);
  scene.add(lane);
  lanes[sign] = lane;
}
const LANE_CRYSTAL_COLOR = 0x5b5a2e, LANE_ITEM_COLOR = 0x2e5a4a;

// 전장과 옆 구역 사이 벽. 대포가 지나다닐 수 있게 대포 쪽(z >= WALL_END_Z)은 비워 둔다.
const WALL_X = FIELD_W + LANE_GAP / 2;
const WALL_END_Z = 6;
{
  const len = WALL_END_Z - (SPAWN_Z - 4);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x8a8f99 });
  for (const sign of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.4, len), wallMat);
    wall.position.set(sign * WALL_X, 0.7, WALL_END_Z - len / 2);
    scene.add(wall);
  }
}

const baseLine = new THREE.Mesh(
  new THREE.BoxGeometry(FIELD_W * 2, 0.1, 0.3),
  new THREE.MeshBasicMaterial({ color: 0xff4444 })
);
baseLine.position.set(0, 0.06, BASE_Z);
scene.add(baseLine);

// ================= 대포 =================
const cannonMeshes = [];
const CANNON_GLOW_COLOR = 0x33ff66; // 대포 추가 발광 색(초록)
const CANNON_GLOW_NEW = 1.2;        // 새 대포 발광 세기
const CANNON_GLOW_OLD = 0.4;        // 기존 대포 발광 세기
// 대포 모델 (본체 대포, 얼음 속 대포, 날아가는 대포가 공유). 지오메트리는 한 번만 만든다
const cannonBarrelGeo = new THREE.CylinderGeometry(0.35, 0.5, 2, 12);
const cannonWheelGeo = new THREE.CylinderGeometry(0.7, 0.7, 1.4, 16);
function makeCannonModel(level) {
  const g = new THREE.Group();
  const barrelMat = new THREE.MeshStandardMaterial({ color: LEVEL_COLORS[level] });
  const barrel = new THREE.Mesh(cannonBarrelGeo, barrelMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -0.8;
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b });
  const wheel = new THREE.Mesh(cannonWheelGeo, wheelMat);
  wheel.rotation.z = Math.PI / 2;
  g.add(barrel, wheel);
  g.position.y = 0.7;
  return { group: g, barrel, barrelMat, wheelMat };
}
// 레벨에 맞는 색/포신 굵기 (본체 대포 render()와 같은 규칙)
function setCannonLevel(m, level) {
  m.barrelMat.color.setHex(LEVEL_COLORS[level]);
  m.barrel.scale.set(1 + level * 0.1, 1, 1 + level * 0.1);
}
for (let i = 0; i < MAX_CANNONS; i++) {
  const { group: g, barrel, barrelMat, wheelMat } = makeCannonModel(0);
  g.visible = false;
  scene.add(g);
  // 대포 추가 발광: emissive만 쓰므로 공격속도 레벨 색(color)과 충돌하지 않는다. 평소 intensity 0 = 발광 없음
  barrelMat.emissive.setHex(CANNON_GLOW_COLOR);
  wheelMat.emissive.setHex(CANNON_GLOW_COLOR);
  barrelMat.emissiveIntensity = 0;
  wheelMat.emissiveIntensity = 0;
  cannonMeshes.push({ group: g, barrel, barrelMat, wheelMat });
}

// 얼음에서 빠져나와 대포 대형으로 날아가는 대포 (풀 재사용, 연속 달성 대비 레벨 수만큼)
const FLY_DUR = 0.6;       // 비행 시간(초)
const FLY_ARC = 3;         // 포물선 높이
const ICE_CANNON_SCALE = 0.6;
const flyers = [];
for (let i = 0; i < HIT_TARGETS.length; i++) {
  const m = makeCannonModel(0);
  m.group.visible = false;
  scene.add(m.group);
  flyers.push({ m, active: false, t: 0, level: 0, x0: 0, z0: 0 });
}

// ================= 인스턴스 메시 =================
const dummy = new THREE.Object3D();
function makeInstanced(geo, color, count) {
  const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color }), count);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  m.count = 0;
  scene.add(m);
  return m;
}
const soldierMesh = makeInstanced(new THREE.CapsuleGeometry(0.2, 0.3, 3, 6), 0x3aa0ff, MAX_SOLDIERS);
const enemyMesh = makeInstanced(new THREE.CapsuleGeometry(0.28, 0.4, 3, 6), 0xffffff, MAX_ENEMIES);
const enemyColors = ETYPE.map((t) => new THREE.Color(t.color));
enemyMesh.setColorAt(0, enemyColors[0]); // instanceColor 버퍼 생성

// ================= 라벨 =================
function makeLabelCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// ---- 파편 이펙트 (순수 시각용, 고정 크기 풀 재사용) ----
const FX_MAX = 200;       // 동시 입자 상한 (가득 차면 새 입자는 무시)
const FX_LIFE = 0.6;      // 입자 수명(초)
const GATE_FADE = 0.2;    // 게이트가 사라지는 시간(초)
const fxX = new Float32Array(FX_MAX);
const fxY = new Float32Array(FX_MAX);
const fxZ = new Float32Array(FX_MAX);
const fxVx = new Float32Array(FX_MAX);
const fxVy = new Float32Array(FX_MAX);
const fxVz = new Float32Array(FX_MAX);
const fxT = new Float32Array(FX_MAX); // 남은 수명
const fxK = new Uint8Array(FX_MAX);   // 입자 색 종류 (FX_COLORS 인덱스)
const FX_COLORS = [new THREE.Color(0x9fd0ff), new THREE.Color(0x4cff7a), new THREE.Color(0xffd23c), new THREE.Color(0xc8f0ff)]; // 0 게이트 파랑, 1 초록, 2 금색, 3 얼음 하늘색
let fxCount = 0;
const fxMesh = new THREE.InstancedMesh(
  new THREE.BoxGeometry(0.22, 0.22, 0.22),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }), // 색은 인스턴스 색으로 입힌다
  FX_MAX
);
fxMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
fxMesh.setColorAt(0, FX_COLORS[0]); // instanceColor 버퍼 생성
fxMesh.frustumCulled = false;
fxMesh.count = 0;
scene.add(fxMesh);

// 대포 추가 팝 (순수 시각용): 남은 시간, 새 대포는 마지막 인덱스
const CANNON_POP_DUR = 0.35;
let cannonPopT = 0;

function fxClear() {
  fxCount = 0;
  fxMesh.count = 0;
  cannonPopT = 0;
  // 얼음 대포 연출 초기화: 날아가던 대포 제거, 표시 레벨을 실제 레벨에 맞춘다
  for (const f of flyers) { f.active = false; f.m.group.visible = false; }
  crystal.hitFxT = 0;
  shownLevel = fireLevel;
}
// (x, z) 중심 반경 r 안에서 위로 퍼지는 입자 n개. 풀이 차면 남은 만큼만 만든다
function fxBurst(x, z, r, n, kind) {
  n = Math.min(FX_MAX - fxCount, n);
  for (let k = 0; k < n; k++) {
    const i = fxCount++;
    fxX[i] = x + (Math.random() - 0.5) * 2 * r;
    fxY[i] = 0.2 + Math.random() * 0.6;
    fxZ[i] = z + (Math.random() - 0.5) * 2 * r;
    fxVx[i] = (Math.random() - 0.5) * 2.5;
    fxVy[i] = 2.5 + Math.random() * 3;
    fxVz[i] = (Math.random() - 0.5) * 2.5;
    fxT[i] = FX_LIFE * (0.6 + Math.random() * 0.4);
    fxK[i] = kind;
  }
}
// 게이트 폭 전체에서 파편을 흩뿌린다
function fxGateBreak(g) {
  const n = Math.min(FX_MAX - fxCount, 14 + Math.round(g.w * 3));
  for (let k = 0; k < n; k++) {
    const i = fxCount++;
    fxX[i] = g.x + (Math.random() - 0.5) * g.w;
    fxY[i] = 0.2 + Math.random() * 1.8;
    fxZ[i] = g.z + (Math.random() - 0.5) * 0.3;
    fxVx[i] = (Math.random() - 0.5) * 4;
    fxVy[i] = 1.5 + Math.random() * 3;
    fxVz[i] = (Math.random() - 0.5) * 3;
    fxT[i] = FX_LIFE * (0.6 + Math.random() * 0.4);
    fxK[i] = 0;
  }
}
// 게임 상태와 무관하게 매 프레임 호출 (clear/over에서도 입자가 스스로 소멸)
function fxUpdate(dt) {
  for (const g of gates) {
    if (g.fade > 0) {
      g.fade -= dt;
      if (g.fade <= 0) { g.fade = 0; g.mesh.visible = false; }
      else g.mesh.material.opacity = g.fade / GATE_FADE;
    }
  }
  for (let i = fxCount - 1; i >= 0; i--) {
    fxT[i] -= dt;
    if (fxT[i] <= 0) { // swap-remove
      const l = --fxCount;
      fxX[i] = fxX[l]; fxY[i] = fxY[l]; fxZ[i] = fxZ[l];
      fxVx[i] = fxVx[l]; fxVy[i] = fxVy[l]; fxVz[i] = fxVz[l];
      fxT[i] = fxT[l]; fxK[i] = fxK[l];
      continue;
    }
    fxVy[i] -= 9 * dt;
    fxX[i] += fxVx[i] * dt;
    fxY[i] = Math.max(0.05, fxY[i] + fxVy[i] * dt);
    fxZ[i] += fxVz[i] * dt;
  }
  for (let i = 0; i < fxCount; i++) {
    dummy.position.set(fxX[i], fxY[i], fxZ[i]);
    dummy.scale.setScalar(Math.min(1, fxT[i] / 0.25));
    dummy.updateMatrix();
    fxMesh.setMatrixAt(i, dummy.matrix);
    fxMesh.setColorAt(i, FX_COLORS[fxK[i]]);
  }
  dummy.scale.setScalar(1);
  fxMesh.count = fxCount;
  fxMesh.instanceMatrix.needsUpdate = true;
  fxMesh.instanceColor.needsUpdate = true;
  if (cannonPopT > 0) cannonPopT = Math.max(0, cannonPopT - dt);
  if (crystal.hitFxT > 0) crystal.hitFxT -= dt;

  // 얼음에서 빠져나온 대포: 포물선으로 현재 대포 대형 중심까지 날아가고, 도착하면 대포 모습이 바뀐다
  for (const f of flyers) {
    if (!f.active) continue;
    f.t += dt;
    const u = Math.min(1, f.t / FLY_DUR);
    const g = f.m.group;
    g.position.x = f.x0 + (cannonX - f.x0) * u;
    g.position.z = f.z0 + (CANNON_Z - f.z0) * u;
    g.position.y = 0.9 + (0.7 - 0.9) * u + FLY_ARC * 4 * u * (1 - u);
    g.scale.setScalar(ICE_CANNON_SCALE + (CANNON_SCALE - ICE_CANNON_SCALE) * u);
    g.rotation.y = (1 - u) * Math.PI * 2;
    if (u >= 1) {
      f.active = false;
      g.visible = false;
      shownLevel = Math.max(shownLevel, f.level); // 순서가 뒤바뀌어도 높은 레벨로 수렴
      fxBurst(cannonX, CANNON_Z, halfSpan() + 0.5, 16, 2);
    }
  }
}

// ---- 게이트 (파란 반투명 판, 고정) ----
let gates = [];
function buildGates(list) {
  for (const g of gates) {
    scene.remove(g.mesh);
    g.mesh.material.map.dispose();
    g.mesh.material.dispose();
    g.mesh.geometry.dispose();
  }
  gates = list.map(([op, val, x, z, w]) => {
    const cw = Math.round(w * 64);
    const c = makeLabelCanvas(cw, 128);
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(40,120,255,0.8)'; ctx.fillRect(0, 0, cw, 128);
    ctx.strokeStyle = '#bfe0ff'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, cw - 8, 120);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 80px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(op + val, cw / 2, 70);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, side: THREE.DoubleSide })
    );
    mesh.position.set(x, 1, z);
    scene.add(mesh);
    return { op, val, x, z, w, mesh, alive: true, fade: 0 };
  });
}

// ---- 타격 강화 크리스털 (노란 기둥, 고정) ----
// 형태: 다음 단계 대포가 얼음에 갇힌 모습. mesh는 (얼음 + 균열 + 갇힌 대포) 그룹이라 회전/위치/표시를 한 번에 다룬다
const ICE_CRACKS = 5;
const crystal = {
  mesh: null, label: null, ctx: null, tex: null, x: -LANE_X, z: -5.5, hits: 0,
  ice: null, iceMat: null, cracks: [], cannon: null, hitFxT: 0,
}; // 왼쪽 옆 구역
{
  const mesh = new THREE.Group();
  mesh.position.set(crystal.x, 0, crystal.z);
  mesh.visible = false;
  scene.add(mesh);
  const iceMat = new THREE.MeshStandardMaterial({
    color: 0x9fe3ff, emissive: 0x2a6a8a, transparent: true, opacity: 0.75, depthWrite: false, flatShading: true,
  });
  const ice = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.2), iceMat);
  ice.position.y = 1.1; // 바닥에 닿는 정육면체
  const cannon = makeCannonModel(1);
  cannon.group.position.y = 0.9;
  cannon.group.scale.setScalar(ICE_CANNON_SCALE);
  const crackMat = new THREE.MeshBasicMaterial({ color: 0xf0ffff });
  const crackGeo = new THREE.BoxGeometry(0.07, 0.9, 0.07);
  for (let k = 0; k < ICE_CRACKS; k++) {
    const a = k * 2.5; // 둘레에 흩어 놓는다
    const cr = new THREE.Mesh(crackGeo, crackMat);
    cr.position.set(Math.sin(a) * 1.0, 0.7 + (k % 3) * 0.45, Math.cos(a) * 1.0);
    cr.rotation.set(0, a, (k % 2 ? 1 : -1) * (0.4 + 0.15 * k));
    cr.visible = false;
    mesh.add(cr);
    crystal.cracks.push(cr);
  }
  mesh.add(cannon.group, ice);
  crystal.ice = ice; crystal.iceMat = iceMat; crystal.cannon = cannon;
  const c = makeLabelCanvas(256, 96);
  crystal.ctx = c.getContext('2d');
  crystal.tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: crystal.tex, depthTest: false }));
  sp.scale.set(2.6, 0.98, 1);
  sp.position.set(crystal.x, 3.2, crystal.z);
  sp.visible = false;
  scene.add(sp);
  crystal.mesh = mesh;
  crystal.label = sp;
}
function drawCrystalLabel() {
  const ctx = crystal.ctx;
  ctx.clearRect(0, 0, 256, 96);
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, 256, 96);
  ctx.fillStyle = '#ffd23a'; ctx.font = 'bold 54px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(fireLevel >= HIT_TARGETS.length ? 'MAX' : `${crystal.hits}/${HIT_TARGETS[fireLevel]}`, 128, 50);
  crystal.tex.needsUpdate = true;
  refreshCrystalIce();
}
// 얼음 속 대포(다음 단계 모양)와 균열을 현재 진행도에 맞춘다. MAX면 얼음/대포를 숨긴다
function refreshCrystalIce() {
  const maxed = fireLevel >= HIT_TARGETS.length;
  crystal.ice.visible = crystal.cannon.group.visible = !maxed;
  if (maxed) {
    for (const cr of crystal.cracks) cr.visible = false;
    return;
  }
  setCannonLevel(crystal.cannon, fireLevel + 1);
  const p = Math.min(1, crystal.hits / HIT_TARGETS[fireLevel]);
  crystal.iceMat.opacity = 0.75 - 0.4 * p; // 갈수록 흐려져 안의 대포가 잘 보인다
  const shown = Math.floor(p * ICE_CRACKS);
  for (let k = 0; k < ICE_CRACKS; k++) crystal.cracks[k].visible = k < shown;
}
// 병사가 얼음을 칠 때 작은 조각 1개 (크리스털당 0.1초에 1회, 풀 여유 60 미만이면 생략)
function crystalHitFx() {
  if (crystal.hitFxT > 0 || FX_MAX - fxCount < 60) return;
  crystal.hitFxT = 0.1;
  fxBurst(crystal.x, crystal.z, 0.6, 1, 3);
}
// 얼음이 깨지는 순간: 파편을 크게 흩뿌리고, 갇혀 있던 대포(level 단계)를 대포 대형으로 날려 보낸다
function crystalBreak(level) {
  fxBurst(crystal.x, crystal.z, 0.9, 40, 3);
  const f = flyers.find((v) => !v.active);
  if (!f) { shownLevel = fireLevel; return; } // 풀 부족(발생 불가에 가까움): 즉시 반영
  f.active = true; f.t = 0; f.level = level;
  f.x0 = crystal.x; f.z0 = crystal.z;
  setCannonLevel(f.m, level);
  f.m.group.position.set(f.x0, 0.9, f.z0);
  f.m.group.scale.setScalar(ICE_CANNON_SCALE);
  f.m.group.rotation.y = 0;
  f.m.group.visible = true;
}

// ---- 대포 추가 아이템 (초록 + 상자, 내려옴) ----
let items = [];
// 게이트(+/× 벽)와 같은 판 형태, 색만 초록. 옆 구역 폭을 꽉 채우고 내려온다.
const ITEM_W = LANE_W;
const itemGeo = new THREE.PlaneGeometry(ITEM_W, 2);
const itemMat = (() => {
  const cw = Math.round(ITEM_W * 64);
  const c = makeLabelCanvas(cw, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(40,190,80,0.85)'; ctx.fillRect(0, 0, cw, 128);
  ctx.strokeStyle = '#c4f5d2'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, cw - 8, 120);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 64px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('대포 +1', cw / 2, 70);
  return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, side: THREE.DoubleSide });
})();
function spawnItem() {
  const mesh = new THREE.Mesh(itemGeo, itemMat);
  const x = STAGES[stageIdx].itemSide * LANE_X;
  mesh.position.set(x, 1, -13);
  scene.add(mesh);
  items.push({ group: mesh, x, z: -13 });
}
function clearItems() {
  for (const it of items) scene.remove(it.group);
  items = [];
}

// ================= 상태 =================
// 병사 (SoA)
const sx = new Float32Array(MAX_SOLDIERS);
const sz = new Float32Array(MAX_SOLDIERS);
const svx = new Float32Array(MAX_SOLDIERS);
const sGate = new Int8Array(MAX_SOLDIERS * GATE_SLOTS);
let sCount = 0;
// 적 (SoA)
const ex = new Float32Array(MAX_ENEMIES);
const ez = new Float32Array(MAX_ENEMIES);
const ehp = new Int16Array(MAX_ENEMIES);
const etype = new Uint8Array(MAX_ENEMIES);
let eCount = 0;
const ENEMY_RESERVE = 16; // 보스 + 호위병(최대 8)용 여유 슬롯
let soldierCapT = 0;      // 병사 상한으로 생성이 버려진 뒤 HUD에 MAX를 남겨 두는 시간(초)

// 프레임마다 재사용하는 버퍼 (GC 방지)
const deadBuf = new Int16Array(MAX_SOLDIERS);
let deadCount = 0;
const spawnX = new Float32Array(MAX_SOLDIERS);
const spawnZ = new Float32Array(MAX_SOLDIERS);
const spawnVx = new Float32Array(MAX_SOLDIERS);
const spawnSrc = new Int16Array(MAX_SOLDIERS);
const spawnFlags = new Int8Array(MAX_SOLDIERS * GATE_SLOTS);
let spawnCount = 0;

let state = 'ready';     // ready | play | clear | over | win
let stateAt = 0;
let stageIdx = 0;
let hp, score, stageTime, fireTimer, spawnTimer, itemTimer, summonTimer;
let cannonCount, cannonX, fireLevel;
let shownLevel = 0; // 대포 모습(색/포신 굵기)에 쓰는 표시용 레벨. 얼음 속 대포가 도착하면 fireLevel을 따라간다
let bossSpawned, bossMaxHp, bossAtk;

function loadStage(idx) {
  stageIdx = idx;
  const st = STAGES[idx];
  sCount = 0; eCount = 0; soldierCapT = 0;
  hp = BASE_HP; stageTime = 0;
  score = 0; dragging = false; // 점수는 스테이지 시도마다 초기화
  fireTimer = 0; spawnTimer = 0; itemTimer = 3; summonTimer = 0;
  cannonCount = 1; cannonX = 0; fireLevel = 0;
  bossSpawned = false; bossMaxHp = 0; bossAtk = 0;
  crystal.hits = 0;
  crystal.x = st.crystalSide * LANE_X;
  crystal.mesh.position.x = crystal.label.position.x = crystal.x;
  lanes[st.crystalSide].material.color.setHex(LANE_CRYSTAL_COLOR);
  lanes[st.itemSide].material.color.setHex(LANE_ITEM_COLOR);
  crystal.mesh.visible = crystal.label.visible = st.crystal;
  drawCrystalLabel();
  buildGates(st.gates);
  fxClear();
  clearItems();
  showOverlay(`STAGE ${idx + 1}`, st.desc, '클릭 또는 Enter로 시작 · 아래 번호로 스테이지 선택 · 대포를 잡고 드래그');
  state = 'ready'; stateAt = performance.now();
}

function showOverlay(title, sub, hint) {
  document.getElementById('ovTitle').textContent = title;
  document.getElementById('ovSub').textContent = sub;
  document.getElementById('ovHint').textContent = hint;
  document.getElementById('over').style.display = 'flex';
  pickBtns.forEach((b, k) => b.classList.toggle('cur', k === stageIdx));
}
function hideOverlay() {
  document.getElementById('over').style.display = 'none';
}
function setState(s) {
  state = s;
  stateAt = performance.now();
}

// ---- 개체 추가/제거 ----
// flags: 통과 플래그 배열(flagOff부터 GATE_SLOTS개) 또는 null
function addSoldier(x, z, vx, flags, flagOff = 0) {
  if (sCount >= MAX_SOLDIERS) { soldierCapT = 1; return; } // 상한: 버려지며 HUD에 MAX 표시
  const i = sCount++;
  sx[i] = x; sz[i] = z; svx[i] = vx;
  for (let g = 0; g < GATE_SLOTS; g++) sGate[i * GATE_SLOTS + g] = flags ? flags[flagOff + g] : 0;
}
function removeSoldier(i) {
  const l = --sCount;
  sx[i] = sx[l]; sz[i] = sz[l]; svx[i] = svx[l];
  for (let g = 0; g < GATE_SLOTS; g++) sGate[i * GATE_SLOTS + g] = sGate[l * GATE_SLOTS + g];
}
function enemyHp(type) {
  if (type === E_BOSS) return STAGES[stageIdx].boss.hp;
  return Math.max(1, Math.round(ETYPE[type].hp * (1 + stageIdx * 0.15)));
}
// 일반 적은 보스 전용 여유 슬롯(ENEMY_RESERVE)을 남기고 막는다. 보스·호위병은 reserved=true로 전체 슬롯을 쓴다.
function addEnemy(x, type, z = SPAWN_Z, reserved = false) {
  if (eCount >= (reserved ? MAX_ENEMIES : MAX_ENEMIES - ENEMY_RESERVE)) return false;
  const i = eCount++;
  ex[i] = x; ez[i] = z; etype[i] = type; ehp[i] = enemyHp(type);
  return true;
}
function removeEnemy(i) {
  const l = --eCount;
  ex[i] = ex[l]; ez[i] = ez[l]; ehp[i] = ehp[l]; etype[i] = etype[l];
}

// ================= 입력: 대포 드래그 =================
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPoint = new THREE.Vector3();
const ndc = new THREE.Vector2();
function pointerWorld(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(groundPlane, hitPoint) ? hitPoint : null;
}
function halfSpan() {
  let m = 0;
  for (const [dx] of CANNON_OFFSETS[cannonCount]) m = Math.max(m, Math.abs(dx));
  return m + 0.7 * CANNON_SCALE + 0.1;
}

// 스테이지 선택 버튼 (1~5)
const pickBtns = [];
{
  const box = document.getElementById('stagePick');
  STAGES.forEach((_, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = String(i + 1);
    b.setAttribute('aria-label', `스테이지 ${i + 1}`);
    b.addEventListener('click', () => {
      loadStage(i);
      b.blur(); // 포커스가 남으면 이후 Enter/Space가 버튼 click으로 처리되어 시작이 안 된다
    });
    box.appendChild(b);
    pickBtns.push(b);
  });
}

let dragging = false;
let grabOffset = 0;
addEventListener('pointerdown', (e) => {
  // 스테이지 선택 버튼 클릭은 시작으로 처리하지 않는다
  if (e.target.closest && e.target.closest('#stagePick')) return;
  if (state !== 'play') {
    if (performance.now() - stateAt > 400) advance();
    return;
  }
  const p = pointerWorld(e);
  if (!p) return;
  // 대포 영역(여유 포함)을 눌렀을 때만 잡는다
  if (Math.abs(p.x - cannonX) < halfSpan() + 0.5 && p.z > CANNON_Z - 4 && p.z < CANNON_Z + 3) {
    dragging = true;
    grabOffset = cannonX - p.x;
  }
});
addEventListener('pointermove', (e) => {
  if (dragging && e.buttons === 0) { dragging = false; return; } // 버튼을 놓친 경우 해제
  if (!dragging) return;
  const p = pointerWorld(e);
  if (!p) return;
  const lim = WORLD_HALF - halfSpan();
  cannonX = THREE.MathUtils.clamp(p.x + grabOffset, -lim, lim);
});
const release = () => { dragging = false; };
addEventListener('pointerup', release);
addEventListener('pointercancel', release);
addEventListener('blur', release);
addEventListener('keydown', (e) => {
  if (state === 'play') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return; // 브라우저 단축키(Ctrl+1 탭 전환 등)는 무시
  if (e.repeat) return; // 키를 길게 눌러 advance()가 연속 실행되는 것 방지
  if (e.key >= '1' && e.key <= String(STAGES.length)) {
    loadStage(Number(e.key) - 1);
  } else if ((e.key === 'Enter' || e.key === ' ') && e.target.tagName !== 'BUTTON') {
    // 버튼에 포커스가 있으면 브라우저가 click을 일으키므로 이중 처리하지 않는다
    e.preventDefault();
    if (performance.now() - stateAt > 400) advance();
  }
});
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  fitCamera();
});

function advance() {
  if (state === 'ready') {
    hideOverlay();
    setState('play');
  } else if (state === 'clear') {
    loadStage(stageIdx + 1);
  } else if (state === 'win' || state === 'over') {
    loadStage(state === 'win' ? 0 : stageIdx);
  }
}

// ================= 공간 분할 (적) =================
const CELL = 2;
const GRID_W = Math.ceil((FIELD_W * 2) / CELL) + 3;
const GRID_D = 20;
const grid = Array.from({ length: GRID_W * GRID_D }, () => []);
const sGrid = Array.from({ length: GRID_W * GRID_D }, () => []); // 병사용 (적 유도에 사용)
const cellX = (x) => Math.floor((x + FIELD_W) / CELL) + 1;
const cellZ = (z) => Math.floor((z - SPAWN_Z) / CELL) + 2;

// ================= 웨이브 / 스폰 =================
function spawnGroup(waveIdx, isBossWave) {
  const st = STAGES[stageIdx];
  const n = (isBossWave ? 2 + stageIdx : 3 + waveIdx * 2 + stageIdx) * SPAWN_MULT;
  const cx = (Math.random() * 2 - 1) * (FIELD_W - 2);
  for (let k = 0; k < n; k++) {
    const r = Math.random();
    let type = E_NORMAL;
    if (r < st.tank) type = E_TANK;
    else if (r < st.tank + st.runner) type = E_RUNNER;
    addEnemy(cx + (Math.random() - 0.5) * 3.5, type, SPAWN_Z - Math.random() * 1.5);
  }
}
function spawnBoss() {
  const b = STAGES[stageIdx].boss;
  // 보스는 여유 슬롯을 쓰므로 일반적으로 실패하지 않지만, 실패하면 다음 프레임에 다시 시도한다
  if (!addEnemy(0, E_BOSS, SPAWN_Z - 1, true)) return;
  bossMaxHp = b.hp;
  if (b.escort) {
    for (let k = 0; k < b.escort; k++) addEnemy((Math.random() * 2 - 1) * (FIELD_W - 1), E_RUNNER, SPAWN_Z - Math.random() * 3, true);
  }
  bossSpawned = true;
}

// ================= 업데이트 =================
function update(dt) {
  stageTime += dt;
  const st = STAGES[stageIdx];
  const waveIdx = Math.min(3, Math.floor(stageTime / WAVE_DUR));
  const bossWave = waveIdx === 3;
  const baseSpeed = 1.0 + stageIdx * 0.06;

  // --- 대포 발사 ---
  fireTimer += dt;
  const interval = FIRE_INTERVALS[fireLevel];
  while (fireTimer >= interval) {
    fireTimer -= interval;
    for (let c = 0; c < cannonCount; c++) {
      const [dx, dz] = CANNON_OFFSETS[cannonCount][c];
      addSoldier(cannonX + dx + (Math.random() - 0.5) * 0.3, CANNON_Z + dz - 2 * CANNON_SCALE, (Math.random() - 0.5) * 0.8, null);
    }
  }

  // --- 적 스폰 ---
  if (bossWave && !bossSpawned) spawnBoss();
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnTimer = 1.0;
    spawnGroup(waveIdx, bossWave);
  }
  // 소환사 보스
  if (bossSpawned && st.boss.summon) {
    summonTimer -= dt;
    if (summonTimer <= 0) {
      summonTimer = st.boss.summon;
      for (let i = 0; i < eCount; i++) {
        if (etype[i] === E_BOSS) {
          for (let k = 0; k < 4; k++) addEnemy(ex[i] + (Math.random() - 0.5) * 3, E_NORMAL, ez[i] + 1);
          break;
        }
      }
    }
  }

  // --- 대포 추가 아이템 ---
  if (st.items) {
    itemTimer -= dt;
    if (itemTimer <= 0) { itemTimer = 8; spawnItem(); } // 테스트용: 자주 등장
  }
  for (let k = items.length - 1; k >= 0; k--) {
    const it = items[k];
    it.z += 2.5 * dt;
    it.group.position.z = it.z;
    // 대포의 일부(바퀴·포신 영역)가 벽에 닿으면 획득
    let touched = false;
    for (let c = 0; c < cannonCount && !touched; c++) {
      const [dx, dz] = CANNON_OFFSETS[cannonCount][c];
      const cz = CANNON_Z + dz;
      if (Math.abs(it.x - (cannonX + dx)) < ITEM_W / 2 + 0.7 * CANNON_SCALE &&
          it.z > cz - 1.8 * CANNON_SCALE - 0.3 && it.z < cz + 0.5 * CANNON_SCALE + 0.3) touched = true;
    }
    if (touched) {
      if (cannonCount < MAX_CANNONS) {
        cannonCount++;
        const lim = WORLD_HALF - halfSpan();
        cannonX = THREE.MathUtils.clamp(cannonX, -lim, lim);
        cannonPopT = CANNON_POP_DUR;
        fxBurst(it.x, it.z, ITEM_W / 2, 14, 1);
        fxBurst(cannonX, CANNON_Z, halfSpan() + 0.5, 12, 1);
      } else {
        score += 50;
        fxBurst(it.x, it.z, 1, 5, 2);
      }
    }
    if (touched || it.z > CANNON_Z + 3) {
      scene.remove(it.group);
      items.splice(k, 1);
    }
  }

  // --- 적 이동 / 방어선 / 게이트 파괴 ---
  bossAtk -= dt;
  for (const c of sGrid) c.length = 0;
  for (let i = 0; i < sCount; i++) {
    const cx = cellX(sx[i]), cz = cellZ(sz[i]);
    if (cx >= 0 && cx < GRID_W && cz >= 0 && cz < GRID_D) sGrid[cz * GRID_W + cx].push(i);
  }
  for (let i = eCount - 1; i >= 0; i--) {
    const t = etype[i];
    let speedMul = t === E_BOSS ? st.boss.speed : ETYPE[t].speed;

    // 적 유도: 앞쪽(대포 쪽) 일정 범위 안의 가장 가까운 병사를 향해 좌우로 조향. 유도 중에는 느려진다. (보스 제외)
    if (t !== E_BOSS && sCount > 0) { // 병사가 없으면 탐색 생략
      const gx = cellX(ex[i]), gz = cellZ(ez[i]);
      let best = -1, bd = ENEMY_HOMING_R * ENEMY_HOMING_R;
      for (let oz = -2; oz <= 2; oz++) {
        if (gz + oz < 0 || gz + oz >= GRID_D) continue;
        for (let ox = -2; ox <= 2; ox++) {
          const x = gx + ox, z = gz + oz;
          if (x < 0 || x >= GRID_W || z < 0 || z >= GRID_D) continue;
          const cell = sGrid[z * GRID_W + x];
          for (let k = 0; k < cell.length; k++) {
            const s = cell[k];
            if (sz[s] < ez[i] - 0.3) continue; // 이미 지나친 병사는 제외
            if (Math.abs(sx[s]) > WALL_X) continue; // 옆 구역 병사는 벽 너머라 제외
            const ddx = sx[s] - ex[i], ddz = sz[s] - ez[i];
            const d = ddx * ddx + ddz * ddz;
            if (d < bd) { bd = d; best = s; }
          }
        }
      }
      if (best >= 0) {
        speedMul *= HOMING_SLOW;
        const maxVx = baseSpeed * speedMul; // 좌우 속도 = 유도 중 전진 속도
        ex[i] += THREE.MathUtils.clamp((sx[best] - ex[i]) * 4, -maxVx, maxVx) * dt;
      }
    }
    ez[i] += baseSpeed * speedMul * dt;
    // 벽 안쪽(전장)에만 머문다: 옆 구역으로 넘어가지 못함
    const lim = WALL_X - 0.2 - ETYPE[t].r * 0.5;
    ex[i] = THREE.MathUtils.clamp(ex[i], -lim, lim);

    if (t === E_BOSS) {
      // 보스는 방어선 앞에 멈춰서 주기적으로 기지를 공격한다 (병사로 처치해야 클리어)
      if (ez[i] >= BASE_Z - 1.2) {
        ez[i] = BASE_Z - 1.2;
        if (bossAtk <= 0) { hp -= st.boss.dmg; bossAtk = 1.5; }
      }
    } else if (ez[i] >= BASE_Z) {
      hp -= ETYPE[t].dmg;
      removeEnemy(i);
      continue;
    }
    // 게이트에 닿으면 게이트 파괴
    const r = ETYPE[t].r;
    for (const g of gates) {
      if (!g.alive) continue;
      if (Math.abs(ex[i] - g.x) < g.w / 2 + r * 0.5 && Math.abs(ez[i] - g.z) < 0.5 + r * 0.6) {
        g.alive = false;
        g.fade = GATE_FADE; // 시각 연출: fxUpdate에서 서서히 숨김
        fxGateBreak(g);
      }
    }
  }
  if (hp <= 0) {
    hp = 0;
    showOverlay('GAME OVER', `STAGE ${stageIdx + 1}\n점수 ${score}`, '클릭하여 다시 도전 · 번호로 스테이지 선택');
    setState('over');
    dragging = false;
    return;
  }

  // --- 격자 구성 (적) ---
  for (const c of grid) c.length = 0;
  for (let i = 0; i < eCount; i++) {
    const cx = cellX(ex[i]), cz = cellZ(ez[i]);
    if (cx >= 0 && cx < GRID_W && cz >= 0 && cz < GRID_D) grid[cz * GRID_W + cx].push(i);
  }

  // --- 병사 이동 / 게이트 / 크리스털 / 충돌 ---
  deadCount = 0;
  spawnCount = 0;
  const spawnLim = WALL_X - 0.45; // 벽 안쪽 면(WALL_X - 0.2)보다 0.25 안쪽 (벽 두께에 걸리지 않게)
  let crystalChanged = false;
  for (let i = 0; i < sCount; i++) {
    const pz = sz[i];
    let speedMul = 1; // 유도 중에는 느려진다

    // 유도: 앞쪽 일정 범위 안에서 가장 가까운 적을 향해 좌우로 조향
    {
      const gx = cellX(sx[i]), gz = cellZ(sz[i]);
      let best = -1, bd = HOMING_R * HOMING_R;
      // 전장 소속 병사만 적을 찾는다 (옆 구역 병사는 벽 너머라 제외)
      const inField = Math.abs(sx[i]) < WALL_X && eCount > 0; // 적이 없으면 탐색 생략
      for (let oz = -2; oz <= 2 && inField; oz++) {
        if (gz + oz < 0 || gz + oz >= GRID_D) continue;
        for (let ox = -2; ox <= 2; ox++) {
          const x = gx + ox, z = gz + oz;
          if (x < 0 || x >= GRID_W || z < 0 || z >= GRID_D) continue;
          const cell = grid[z * GRID_W + x];
          for (let k = 0; k < cell.length; k++) {
            const e = cell[k];
            if (ehp[e] <= 0 || ez[e] - sz[i] > 0.2) continue; // 이미 지나친 적은 제외
            const ddx = ex[e] - sx[i], ddz = ez[e] - sz[i];
            const d = ddx * ddx + ddz * ddz;
            if (d < bd) { bd = d; best = e; }
          }
        }
      }
      if (best >= 0) {
        const maxVx = SOLDIER_SPEED * HOMING_SLOW; // 좌우 속도 = 유도 중 전진 속도
        const want = THREE.MathUtils.clamp((ex[best] - sx[i]) * 6, -maxVx, maxVx);
        svx[i] += (want - svx[i]) * Math.min(1, dt * 10);
        speedMul = HOMING_SLOW;
      } else {
        svx[i] *= 1 - Math.min(1, dt * 3);
      }
    }

    sz[i] -= SOLDIER_SPEED * speedMul * dt;
    const ox = sx[i];
    sx[i] += svx[i] * dt;
    // 전장과 옆 구역 사이 벽: 벽 구간(z < WALL_END_Z)에서는 병사도 넘지 못한다
    if (sz[i] < WALL_END_Z) {
      const a = Math.abs(ox), b = Math.abs(sx[i]);
      if ((a < WALL_X && b >= WALL_X) || (a > WALL_X && b <= WALL_X)) {
        sx[i] = ox;
        svx[i] = -svx[i];
      }
    }
    if (sx[i] < -WORLD_HALF) { sx[i] = -WORLD_HALF; svx[i] = Math.abs(svx[i]); }
    if (sx[i] > WORLD_HALF) { sx[i] = WORLD_HALF; svx[i] = -Math.abs(svx[i]); }

    if (sz[i] < SPAWN_Z - 3) { deadBuf[deadCount++] = i; continue; }

    // 게이트 통과 (파괴된 게이트는 무시)
    for (let gi = 0; gi < gates.length; gi++) {
      const g = gates[gi];
      if (!g.alive || sGate[i * GATE_SLOTS + gi]) continue;
      if (pz > g.z && sz[i] <= g.z && Math.abs(sx[i] - g.x) < g.w / 2) {
        sGate[i * GATE_SLOTS + gi] = 1;
        const extra = g.op === '+' ? g.val : g.val - 1;
        // 버퍼는 MAX_SOLDIERS개까지만 담는다: 제거 후 추가 가능한 수가 어차피 그 이하라 결과는 같다
        for (let k = 0; k < extra; k++) {
          if (spawnCount >= MAX_SOLDIERS) { soldierCapT = 1; break; }
          // 벽/월드 바깥에 생성되지 않도록 x를 벽 안쪽으로 제한
          const n = spawnCount++;
          spawnX[n] = THREE.MathUtils.clamp(sx[i] + (Math.random() - 0.5) * 1.2, -spawnLim, spawnLim);
          spawnZ[n] = sz[i] - Math.random() * 0.8;
          spawnVx[n] = (Math.random() - 0.5) * 2;
          spawnSrc[n] = i;
        }
      }
    }

    // 크리스털 타격 (병사는 소모됨)
    // 같은 프레임에 최종 단계가 되면 남은 병사는 건너뛰도록 매번 평가
    if (st.crystal && fireLevel < HIT_TARGETS.length) {
      const dx = sx[i] - crystal.x, dz = sz[i] - crystal.z;
      if (dx * dx + dz * dz < 1.7) {
        deadBuf[deadCount++] = i;
        crystal.hits++;
        crystalChanged = true;
        if (crystal.hits >= HIT_TARGETS[fireLevel]) {
          fireLevel++;
          crystal.hits = 0;
          crystalBreak(fireLevel); // 시각 연출만 (게임 로직은 위에서 즉시 반영됨)
        } else {
          crystalHitFx();
        }
        continue;
      }
    }

    // 적과 충돌 (병사 1 : 적 체력 1)
    const cx = cellX(sx[i]), cz = cellZ(sz[i]);
    let hit = false;
    // 벽 구간에서 옆 구역 병사는 벽 너머 적과 충돌하지 않는다
    const behindWall = sz[i] < WALL_END_Z && Math.abs(sx[i]) > WALL_X;
    for (let dz = -1; dz <= 1 && !hit && !behindWall; dz++) {
      for (let dx = -1; dx <= 1 && !hit; dx++) {
        const x = cx + dx, z = cz + dz;
        if (x < 0 || x >= GRID_W || z < 0 || z >= GRID_D) continue;
        const cell = grid[z * GRID_W + x];
        for (let k = 0; k < cell.length; k++) {
          const e = cell[k];
          if (ehp[e] <= 0) continue;
          const rr = ETYPE[etype[e]].r + SOLDIER_R;
          const ddx = ex[e] - sx[i], ddz = ez[e] - sz[i];
          if (ddx * ddx + ddz * ddz < rr * rr) {
            ehp[e]--;
            if (ehp[e] <= 0) score += ETYPE[etype[e]].score;
            hit = true;
            break;
          }
        }
      }
    }
    if (hit) deadBuf[deadCount++] = i;
  }
  if (crystalChanged) drawCrystalLabel();

  // 게이트로 생긴 병사는 통과 상태를 물려받는다 (제거 전 원본 인덱스 기준)
  for (let k = 0; k < spawnCount; k++) {
    const src = spawnSrc[k];
    for (let g = 0; g < GATE_SLOTS; g++) spawnFlags[k * GATE_SLOTS + g] = sGate[src * GATE_SLOTS + g];
  }

  // 보스 처치 여부는 제거 전에 확인
  let bossAlive = false;
  for (let i = 0; i < eCount; i++) if (etype[i] === E_BOSS && ehp[i] > 0) { bossAlive = true; break; }

  for (let k = deadCount - 1; k >= 0; k--) removeSoldier(deadBuf[k]);
  for (let i = eCount - 1; i >= 0; i--) if (ehp[i] <= 0) removeEnemy(i);
  for (let k = 0; k < spawnCount; k++) addSoldier(spawnX[k], spawnZ[k], spawnVx[k], spawnFlags, k * GATE_SLOTS);
  soldierCapT = Math.max(0, soldierCapT - dt);

  // --- 스테이지 클리어 ---
  if (bossSpawned && !bossAlive) {
    const last = stageIdx === STAGES.length - 1;
    if (last) showOverlay('ALL CLEAR!', `모든 스테이지를 클리어했습니다\n점수 ${score}`, '클릭하여 처음부터 · 번호로 스테이지 선택');
    else showOverlay(`STAGE ${stageIdx + 1} CLEAR`, `점수 ${score}`, '클릭하여 다음 스테이지 · 번호로 스테이지 선택');
    setState(last ? 'win' : 'clear');
    dragging = false;
  }
}

// ================= 렌더 =================
const hud = document.getElementById('hud');
const bossbar = document.getElementById('bossbar');
const bossfill = document.getElementById('bossfill');
const bosstext = document.getElementById('bosstext');
const tmpColor = new THREE.Color();

function render() {
  // 병사
  for (let i = 0; i < sCount; i++) {
    dummy.position.set(sx[i], 0.35, sz[i]);
    dummy.updateMatrix();
    soldierMesh.setMatrixAt(i, dummy.matrix);
  }
  soldierMesh.count = sCount;
  soldierMesh.instanceMatrix.needsUpdate = true;

  // 적 + 보스 체력바
  let bossHp = -1;
  for (let i = 0; i < eCount; i++) {
    const t = etype[i];
    const s = ETYPE[t].scale;
    dummy.position.set(ex[i], 0.48 * s, ez[i]);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    enemyMesh.setMatrixAt(i, dummy.matrix);
    enemyMesh.setColorAt(i, enemyColors[t]);
    if (t === E_BOSS) bossHp = ehp[i];
  }
  dummy.scale.setScalar(1);
  enemyMesh.count = eCount;
  enemyMesh.instanceMatrix.needsUpdate = true;
  if (enemyMesh.instanceColor) enemyMesh.instanceColor.needsUpdate = true;

  const showBoss = state === 'play' && bossHp > 0;
  bossbar.style.display = bosstext.style.display = showBoss ? 'block' : 'none';
  if (showBoss) {
    bossfill.style.width = `${Math.max(0, (bossHp / bossMaxHp) * 100)}%`;
    bosstext.textContent = `${STAGES[stageIdx].boss.name}  ${bossHp}/${bossMaxHp}`;
  }

  // 대포
  for (let c = 0; c < MAX_CANNONS; c++) {
    const m = cannonMeshes[c];
    m.group.visible = c < cannonCount;
    if (c < cannonCount) {
      const [dx, dz] = CANNON_OFFSETS[cannonCount][c];
      m.group.position.x = cannonX + dx;
      m.group.position.z = CANNON_Z + dz;
      let pop = 1; // 대포 추가 팝 (scale만 곱함)
      if (cannonPopT > 0) {
        const s = Math.sin(Math.PI * (1 - cannonPopT / CANNON_POP_DUR));
        pop = 1 + (c === cannonCount - 1 && cannonCount > 1 ? 0.45 : 0.12) * s;
      }
      m.group.scale.setScalar(CANNON_SCALE * pop);
      tmpColor.setHex(LEVEL_COLORS[shownLevel]);
      m.barrelMat.color.copy(tmpColor);
      m.barrel.scale.set(1 + shownLevel * 0.1, 1, 1 + shownLevel * 0.1);
      // 대포 추가 발광: 팝과 같은 타이머로 번쩍였다가 사라진다 (끝나면 정확히 0으로 복원)
      let glow = 0;
      if (cannonPopT > 0 && cannonCount > 1) {
        glow = (c === cannonCount - 1 ? CANNON_GLOW_NEW : CANNON_GLOW_OLD) * (cannonPopT / CANNON_POP_DUR);
      }
      m.barrelMat.emissiveIntensity = glow;
      m.wheelMat.emissiveIntensity = glow;
    }
  }

  const wave = Math.min(3, Math.floor(stageTime / WAVE_DUR));
  hud.textContent =
    `STAGE ${stageIdx + 1}/${STAGES.length}  ${wave >= 3 ? 'BOSS' : `웨이브 ${wave + 1}/3`}   HP ${hp}   점수 ${score}\n` +
    `병사 ${sCount}${sCount >= MAX_SOLDIERS || soldierCapT > 0 ? ' MAX' : ''}   대포 ${cannonCount}   공격속도 Lv${fireLevel}`;
  hud.style.whiteSpace = 'pre-line';
  renderer.render(scene, camera);
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state === 'play') update(dt);
  fxUpdate(dt);
  render();
  requestAnimationFrame(loop);
}

loadStage(0);
requestAnimationFrame(loop);
