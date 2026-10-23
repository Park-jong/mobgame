import * as THREE from 'three';
import gameData from './data/game.json';
import {
  FIELD_W, LANE_GAP, LANE_W, LANE_X, WORLD_HALF, SPAWN_Z, ENEMY_SPAWN_Z, BASE_Z, CANNON_Z, GATE_SLOTS, WALL_X, WALL_END_Z,
} from './shared/world.js';
import {
  MAX_WAVES, WAVE_LIMITS, HOMING_DEFAULTS, HOMING_LIMITS, deriveWave, deriveWaves, deriveBossWave,
} from './shared/gamedefaults.js';

// ================= 설정 =================
// 월드 치수 상수(FIELD_W, LANE_*, WORLD_HALF, SPAWN_Z, BASE_Z, CANNON_Z, GATE_SLOTS, WALL_*)는 에디터와 공유한다
const MAX_SOLDIERS = 10000;
const MAX_ENEMIES = 1500;
const SOLDIER_R = 0.3;
// 유도 반경(HOMING_R, ENEMY_HOMING_R)과 감속(HOMING_SLOW)은 config에서 읽는다 (아래 DATA 뒤에서 정의)
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
// ================= 데이터 (src/data/game.json) =================
// 스테이지·적 종류·조정 수치는 JSON에서 읽는다. 잘못된 값은 sanitizeData가 기본값으로 대체하고 경고한다.
const warn = (msg) => console.warn(`[game.json] ${msg}`);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function num(v, def, min, max, path) {
  if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) return v;
  warn(`${path}: 값이 없거나 범위(${min}~${max})를 벗어나 기본값 ${def} 사용`);
  return def;
}
function str(v, def, path) {
  if (typeof v === 'string') return v;
  warn(`${path}: 문자열이 아니라 기본값 사용`);
  return def;
}
function numList(v, def, path, min, max) {
  if (!Array.isArray(v) || v.length !== def.length) {
    warn(`${path}: 길이 ${def.length}의 배열이 아니라 기본값 사용`);
    return def.slice();
  }
  return v.map((x, i) => num(x, def[i], min, max, `${path}[${i}]`));
}
function color(v, def, path) {
  if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) return parseInt(v.slice(1), 16);
  warn(`${path}: '#rrggbb' 형식이 아니라 기본값 사용`);
  return def;
}

const DEFAULT_CONFIG = {
  soldierSpeed: 3, fireIntervals: [1.00, 0.82, 0.67, 0.55, 0.45, 0.35], hitTargets: [20, 40, 70, 110, 160],
  baseHp: 20, waveDur: 14, itemInterval: 8, itemFirstDelay: 3, crystalZ: -5.5,
};
const DEFAULT_ETYPES = [
  { name: '일반병', hp: 1, speed: 1,   r: 0.45, scale: 1,   dmg: 1,  score: 1,   color: 0xe84a4a },
  { name: '러너',   hp: 2, speed: 2,   r: 0.35, scale: 0.8, dmg: 1,  score: 2,   color: 0xff9a2a },
  { name: '탱커',   hp: 8, speed: 0.6, r: 0.8,  scale: 1.9, dmg: 3,  score: 5,   color: 0x7a3fb0 },
  { name: '보스',   hp: 0, speed: 0.3, r: 1.6,  scale: 4,   dmg: 10, score: 100, color: 0x8b1a1a },
];
const DEFAULT_STAGE = {
  desc: '', gates: [{ op: '×', val: 2, x: 0, z: 3, w: FIELD_W * 2 }],
  crystal: true, items: true, crystalSide: -1, itemSide: 1, runner: 0, tank: 0,
  boss: { name: '보스', hp: 60, speed: 0.3, dmg: 10 },
};
const MAX_ESCORT = 8; // 호위병 상한 (ENEMY_RESERVE 슬롯 안에 들어가도록)

// ---- 웨이브 검증 (범위는 shared/gamedefaults.js의 WAVE_LIMITS, 에디터 schema.js와 같다) ----
function waveInt(v, def, [min, max], path) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max) return v;
  warn(`${path}: ${min}~${max}의 정수가 아니라 기본값 ${def} 사용`);
  return def;
}
// runner/tank 비율은 선택값: 없으면 스테이지 값을 쓰고, 범위 밖이면 경고 후 생략(= 스테이지 값)
function waveRatio(v, path) {
  const [min, max] = WAVE_LIMITS.ratio;
  if (v === undefined) return undefined;
  if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) return v;
  warn(`${path}: 범위(${min}~${max})를 벗어나 스테이지 값 사용`);
  return undefined;
}
function sanitizeWaveRatios(w, out, path) {
  const runner = waveRatio(w.runner, `${path}.runner`);
  const tank = waveRatio(w.tank, `${path}.tank`);
  if (runner !== undefined) out.runner = runner;
  if (tank !== undefined) out.tank = tank;
  return out;
}
function sanitizeWaves(raw, p, stageIdx, waveDur) {
  if (raw === undefined) return deriveWaves(stageIdx, waveDur);
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_WAVES) {
    warn(`${p}.waves: 길이 1~${MAX_WAVES}의 배열이 아니라 기본 웨이브 사용`);
    return deriveWaves(stageIdx, waveDur);
  }
  return raw.map((w0, k) => {
    const wp = `${p}.waves[${k}]`;
    const def = deriveWave(k, stageIdx, waveDur);
    if (!isObj(w0)) warn(`${wp}: 객체가 아니라 기본값 사용`);
    const w = isObj(w0) ? w0 : {};
    return sanitizeWaveRatios(w, {
      duration: num(w.duration, def.duration, ...WAVE_LIMITS.duration, `${wp}.duration`),
      interval: num(w.interval, def.interval, ...WAVE_LIMITS.interval, `${wp}.interval`),
      count: waveInt(w.count, def.count, WAVE_LIMITS.count, `${wp}.count`),
    }, wp);
  });
}
function sanitizeBossWave(raw, p, stageIdx) {
  const def = deriveBossWave(stageIdx);
  if (raw === undefined) return def;
  const wp = `${p}.bossWave`;
  if (!isObj(raw)) { warn(`${wp}: 객체가 아니라 기본값 사용`); return def; }
  return sanitizeWaveRatios(raw, {
    interval: num(raw.interval, def.interval, ...WAVE_LIMITS.interval, `${wp}.interval`),
    count: waveInt(raw.count, def.count, WAVE_LIMITS.count, `${wp}.count`),
  }, wp);
}

function sanitizeData(raw) {
  const d = isObj(raw) ? raw : {};
  if (!isObj(raw)) warn('최상위가 객체가 아니라 전부 기본값 사용');

  const c = isObj(d.config) ? d.config : {};
  if (!isObj(d.config)) warn('config: 객체가 아니라 기본값 사용');
  const D = DEFAULT_CONFIG;
  const config = {
    soldierSpeed: num(c.soldierSpeed, D.soldierSpeed, 0.1, 50, 'config.soldierSpeed'),
    fireIntervals: numList(c.fireIntervals, D.fireIntervals, 'config.fireIntervals', 0.02, 60),
    hitTargets: numList(c.hitTargets, D.hitTargets, 'config.hitTargets', 1, 100000),
    baseHp: num(c.baseHp, D.baseHp, 1, 100000, 'config.baseHp'),
    waveDur: num(c.waveDur, D.waveDur, 1, 600, 'config.waveDur'),
    itemInterval: num(c.itemInterval, D.itemInterval, 0.5, 600, 'config.itemInterval'),
    itemFirstDelay: num(c.itemFirstDelay, D.itemFirstDelay, 0, 600, 'config.itemFirstDelay'),
    crystalZ: num(c.crystalZ, D.crystalZ, SPAWN_Z, BASE_Z, 'config.crystalZ'),
  };
  // 선택 수치: game.json에 없으면 조용히 기본값(예전 코드 값), 있는데 범위 밖이면 경고 후 기본값.
  // 반경 상한 4는 격자 5x5 셀 탐색이 놓치지 않는 한계다 (근거: shared/gamedefaults.js)
  for (const key of ['homingR', 'enemyHomingR', 'homingSlow']) {
    config[key] = c[key] === undefined
      ? HOMING_DEFAULTS[key]
      : num(c[key], HOMING_DEFAULTS[key], HOMING_LIMITS[key][0], HOMING_LIMITS[key][1], `config.${key}`);
  }

  const enemyTypes = DEFAULT_ETYPES.map((def, i) => {
    const p = `enemyTypes[${i}]`;
    const t = Array.isArray(d.enemyTypes) && isObj(d.enemyTypes[i]) ? d.enemyTypes[i] : null;
    if (!t) warn(`${p}: 없어서 기본값 사용`);
    const e = t || {};
    return {
      name: str(e.name, def.name, `${p}.name`),
      hp: num(e.hp, def.hp, 0, 100000, `${p}.hp`),
      speed: num(e.speed, def.speed, 0, 50, `${p}.speed`),
      r: num(e.r, def.r, 0.05, 10, `${p}.r`),
      scale: num(e.scale, def.scale, 0.1, 20, `${p}.scale`),
      dmg: num(e.dmg, def.dmg, 0, 100000, `${p}.dmg`),
      score: num(e.score, def.score, 0, 1000000, `${p}.score`),
      color: color(e.color, def.color, `${p}.color`),
    };
  });

  let rawStages = d.stages;
  if (!Array.isArray(rawStages) || rawStages.length === 0) {
    warn('stages: 비어 있거나 배열이 아니라 기본 스테이지 1개 사용');
    rawStages = [DEFAULT_STAGE];
  }
  const side = (v, def, p) => {
    if (v === -1 || v === 1) return v;
    warn(`${p}: -1 또는 1이어야 해서 기본값 ${def} 사용`);
    return def;
  };
  const bool = (v, def, p) => {
    if (typeof v === 'boolean') return v;
    warn(`${p}: bool이 아니라 기본값 ${def} 사용`);
    return def;
  };
  const stages = rawStages.map((s0, i) => {
    const p = `stages[${i}]`;
    if (!isObj(s0)) warn(`${p}: 객체가 아니라 기본값 사용`);
    const s = isObj(s0) ? s0 : {};
    let rg = s.gates;
    if (!Array.isArray(rg)) { warn(`${p}.gates: 배열이 아니라 기본 게이트 사용`); rg = DEFAULT_STAGE.gates; }
    if (rg.length > GATE_SLOTS) { warn(`${p}.gates: ${rg.length}개는 GATE_SLOTS(${GATE_SLOTS})를 넘어 잘라냄`); rg = rg.slice(0, GATE_SLOTS); }
    const gates = rg.map((g0, k) => {
      const gp = `${p}.gates[${k}]`;
      const g = isObj(g0) ? g0 : {};
      let op = g.op;
      if (op !== '×' && op !== '+') { warn(`${gp}.op: '×' 또는 '+'여야 해서 '+' 사용`); op = '+'; }
      return {
        op,
        val: num(g.val, 1, 1, 100000, `${gp}.val`),
        x: num(g.x, 0, -WORLD_HALF, WORLD_HALF, `${gp}.x`),
        z: num(g.z, 0, SPAWN_Z, BASE_Z, `${gp}.z`),
        w: num(g.w, FIELD_W, 0.5, FIELD_W * 2, `${gp}.w`),
      };
    });
    if (!isObj(s.boss)) warn(`${p}.boss: 객체가 아니라 기본값 사용`);
    const b = isObj(s.boss) ? s.boss : {};
    const DB = DEFAULT_STAGE.boss;
    const boss = {
      name: str(b.name, DB.name, `${p}.boss.name`),
      hp: num(b.hp, DB.hp, 1, 1000000, `${p}.boss.hp`),
      speed: num(b.speed, DB.speed, 0, 50, `${p}.boss.speed`),
      dmg: num(b.dmg, DB.dmg, 0, 100000, `${p}.boss.dmg`),
    };
    // 선택 필드: 있을 때만 검증해서 넣는다 (escort = 호위병 수, summon = 소환 간격 초)
    if (b.escort !== undefined) boss.escort = Math.floor(num(b.escort, 0, 0, MAX_ESCORT, `${p}.boss.escort`));
    if (b.summon !== undefined) boss.summon = num(b.summon, 4, 0.5, 600, `${p}.boss.summon`);
    const runner = num(s.runner, 0, 0, 1, `${p}.runner`);
    const tank = num(s.tank, 0, 0, 1, `${p}.tank`);
    return {
      desc: str(s.desc, '', `${p}.desc`),
      gates,
      crystal: bool(s.crystal, true, `${p}.crystal`),
      items: bool(s.items, true, `${p}.items`),
      crystalSide: side(s.crystalSide, -1, `${p}.crystalSide`),
      itemSide: side(s.itemSide, 1, `${p}.itemSide`),
      runner,
      tank,
      boss,
      // waves / bossWave가 없으면 예전 고정 공식과 같은 값으로 채운다 (웨이브 k: 개수 3+2k+stageIdx, 간격 1초, 길이 waveDur)
      waves: sanitizeWaves(s.waves, p, i, config.waveDur),
      bossWave: sanitizeBossWave(s.bossWave, p, i),
    };
  });
  return { config, enemyTypes, stages };
}

// ?draft=1 이면 에디터가 저장한 임시본(localStorage)을 쓰고, 아니면 항상 번들된 game.json을 쓴다.
const DRAFT_KEY = 'cannonDefense.draftData';
let usingDraft = false;
function loadSourceData() {
  if (new URLSearchParams(location.search).get('draft') !== '1') return gameData;
  try {
    const text = localStorage.getItem(DRAFT_KEY);
    if (text) {
      const parsed = JSON.parse(text);
      usingDraft = true;
      return parsed;
    }
    console.warn(`[draft] localStorage['${DRAFT_KEY}']가 없어 번들 데이터 사용`);
  } catch (e) {
    console.warn(`[draft] 임시본을 읽지 못해 번들 데이터 사용: ${e.message}`);
  }
  return gameData;
}
const DATA = sanitizeData(loadSourceData());
if (usingDraft) {
  const badge = document.createElement('button');
  badge.textContent = '임시본 사용 중 · 해제';
  badge.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:50;padding:4px 10px;font-size:12px;'
    + 'color:#fff;background:rgba(200,110,20,0.9);border:1px solid #ffd08a;border-radius:12px;cursor:pointer;';
  badge.onclick = () => {
    const u = new URL(location.href);
    u.searchParams.delete('draft');
    location.href = u.toString();
  };
  document.body.appendChild(badge);
}
const SOLDIER_SPEED = DATA.config.soldierSpeed;
// 웨이브 길이·간격·개수는 스테이지의 waves / bossWave에서 읽는다 (없으면 sanitizeData가 예전 공식으로 채움, config.waveDur는 그 기본 길이)
const HOMING_R = DATA.config.homingR;           // 병사 유도 감지 반경
const ENEMY_HOMING_R = DATA.config.enemyHomingR; // 적 유도 감지 반경
const HOMING_SLOW = DATA.config.homingSlow;     // 유도 중인 병사·적의 전진 속도 배율
const SPAWN_MULT = 1;      // 적 생성량 배율 (성능 확인할 때만 올린다)
const BASE_HP = DATA.config.baseHp;
const ITEM_INTERVAL = DATA.config.itemInterval;      // 대포 추가 벽 생성 간격(초)
const ITEM_FIRST_DELAY = DATA.config.itemFirstDelay; // 스테이지 시작 후 첫 벽까지(초)
const CRYSTAL_Z = DATA.config.crystalZ;              // 2번 강화(얼음) z 위치

// 공격속도 6단계 (발사 간격) / 다음 단계에 필요한 타격 수
const FIRE_INTERVALS = DATA.config.fireIntervals;
const HIT_TARGETS = DATA.config.hitTargets;
const LEVEL_COLORS = [0x6b7480, 0x4fa3ff, 0x4fe0a0, 0xd8e04f, 0xff9a2a, 0xffd23a];

// 적 종류 (인덱스 상수는 코드에 고정, 수치는 JSON)
const E_NORMAL = 0, E_RUNNER = 1, E_TANK = 2, E_BOSS = 3;
const ETYPE = DATA.enemyTypes;

// 스테이지 목록. 게이트는 {op, val, x, z, w} 명시 배열 (전장 폭 FIELD_W*2 = 14 기준)
const STAGES = DATA.stages;

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
  return { group: g, barrel, wheel, barrelMat, wheelMat };
}
// 레벨에 맞는 색/포신 굵기 (본체 대포 render()와 같은 규칙)
function setCannonLevel(m, level) {
  m.barrelMat.color.setHex(LEVEL_COLORS[level]);
  m.barrel.scale.set(1 + level * 0.1, 1, 1 + level * 0.1);
}
for (let i = 0; i < MAX_CANNONS; i++) {
  const { group: g, barrel, wheel, barrelMat, wheelMat } = makeCannonModel(0);
  g.visible = false;
  scene.add(g);
  // 대포 추가 발광: emissive만 쓰므로 공격속도 레벨 색(color)과 충돌하지 않는다. 평소 intensity 0 = 발광 없음
  barrelMat.emissive.setHex(CANNON_GLOW_COLOR);
  wheelMat.emissive.setHex(CANNON_GLOW_COLOR);
  barrelMat.emissiveIntensity = 0;
  wheelMat.emissiveIntensity = 0;
  cannonMeshes.push({ group: g, barrel, wheel, barrelMat, wheelMat });
}

// 얼음에서 빠져나와 대포 대형으로 날아가는 대포 (풀 재사용, 연속 달성 대비 레벨 수만큼)
const FLY_DUR = 0.6;       // 비행 시간(초)
const FLY_ARC = 3;         // 포물선 높이
const ICE_CANNON_SCALE = 1.0; // 커진 얼음 안에서 작아 보이지 않게
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

// 발사 연출 (순수 시각용): 발사 직전 FIRE_CHARGE_MAX 이내 구간에서 포신이 굵게 부풀고, 발사 순간 움츠렸다가(반동) 원래 굵기로 돌아온다. 몸통·전체 크기는 그대로
const FIRE_CHARGE_MAX = 0.3;   // 부푸는 구간 길이(초) 상한. 연사 간격이 짧으면 간격의 60%
const FIRE_CHARGE_SWELL = 0.22; // 발사 직전 최대 팽창 비율
const FIRE_KICK_DUR = 0.14;    // 발사 직후 반동 구간(초)
const FIRE_KICK_SQUASH = 0.12; // 반동 시 최대 수축 비율
let fireKickT = 0;

function fxClear() {
  fxCount = 0;
  fxMesh.count = 0;
  cannonPopT = 0;
  fireKickT = 0;
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
  if (fireKickT > 0) fireKickT = Math.max(0, fireKickT - dt);
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
  gates = list.map(({ op, val, x, z, w }) => {
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
const ICE_W = LANE_W;  // 얼음 가로 폭: 옆 구역을 꽉 채움 (대포 추가 벽 ITEM_W와 같음)
const ICE_D = 2.6;     // 얼음 깊이(z)
const ICE_H = 2.4;     // 얼음 높이
const crystal = {
  mesh: null, label: null, ctx: null, tex: null, x: -LANE_X, z: CRYSTAL_Z, hits: 0,
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
  const ice = new THREE.Mesh(new THREE.BoxGeometry(ICE_W, ICE_H, ICE_D), iceMat);
  ice.position.y = ICE_H / 2; // 바닥에 닿는 얼음 덩어리
  const cannon = makeCannonModel(1);
  cannon.group.position.y = 0.9;
  cannon.group.scale.setScalar(ICE_CANNON_SCALE);
  const crackMat = new THREE.MeshBasicMaterial({ color: 0xf0ffff });
  const crackGeo = new THREE.BoxGeometry(0.07, 0.9, 0.07);
  for (let k = 0; k < ICE_CRACKS; k++) {
    const a = k * 2.5; // 얼음 폭 전체에 흩어 놓는다 (x는 폭을 5등분해 좌우로 고르게)
    const cr = new THREE.Mesh(crackGeo, crackMat);
    cr.position.set(((k + 0.5) / ICE_CRACKS - 0.5) * (ICE_W - 0.6), 0.7 + (k % 3) * 0.55,
      (k % 2 ? 1 : -1) * (ICE_D / 2 - 0.1) * (k % 3 === 2 ? 0.4 : 1));
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
  sp.position.set(crystal.x, ICE_H + 1.0, crystal.z);
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
  fxBurst(crystal.x, crystal.z, 1.0, 1, 3);
}
// 얼음이 깨지는 순간: 파편을 크게 흩뿌리고, 갇혀 있던 대포(level 단계)를 대포 대형으로 날려 보낸다
function crystalBreak(level) {
  fxBurst(crystal.x, crystal.z, 1.6, 40, 3);
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

// 밸런스 확인용 누적 통계 (스테이지 시작마다 초기화). ?stats=1 이면 HUD에 표시하고 클리어/게임오버 시 콘솔에 표로 출력 (카운트와 window.__stats 조회는 항상 동작)
const STATS_ON = new URLSearchParams(location.search).get('stats') === '1';
const stats = {
  fired: 0,   // 아군 생성: 대포 발사
  gate: 0,    // 아군 생성: 게이트(+N, ×N) 증식분
  enemy: 0,   // 적 생성 합계 (보스·호위병·소환 포함)
  exit: 0,    // 아군 소멸: 적진 끝까지 도달
  fight: 0,   // 아군 소멸: 적과 충돌
  crystal: 0, // 아군 소멸: 얼음 대포 타격에 소모
  kill: 0,    // 적 처치
  leak: 0,    // 적이 방어선 도달 (일반 적)
};
// ?fill=1 이면 스테이지 시작 시 적을 상한까지 위쪽에 가득 채운다 (부하·극한 확인용, 스테이지의 러너·탱커 비율 사용)
const FILL_ON = new URLSearchParams(location.search).get('fill') === '1';
function resetStats() { for (const k in stats) stats[k] = 0; }
function logStats(title) {
  if (!STATS_ON) return;
  console.log(`[stats] ${title}`);
  console.table({ ...stats, total: stats.fired + stats.gate });
}
window.__stats = stats;

function loadStage(idx) {
  stageIdx = idx;
  const st = STAGES[idx];
  sCount = 0; eCount = 0; soldierCapT = 0;
  resetStats();
  hp = BASE_HP; stageTime = 0;
  score = 0; dragging = false; // 점수는 스테이지 시도마다 초기화
  fireTimer = 0; spawnTimer = 0; itemTimer = ITEM_FIRST_DELAY; summonTimer = 0;
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
  if (FILL_ON) fillEnemies(st);
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
  if (sCount >= MAX_SOLDIERS) { soldierCapT = 1; return false; } // 상한: 버려지며 HUD에 MAX 표시
  const i = sCount++;
  sx[i] = x; sz[i] = z; svx[i] = vx;
  for (let g = 0; g < GATE_SLOTS; g++) sGate[i * GATE_SLOTS + g] = flags ? flags[flagOff + g] : 0;
  return true;
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
function addEnemy(x, type, z = ENEMY_SPAWN_Z, reserved = false) {
  if (eCount >= (reserved ? MAX_ENEMIES : MAX_ENEMIES - ENEMY_RESERVE)) return false;
  const i = eCount++;
  ex[i] = x; ez[i] = z; etype[i] = type; ehp[i] = enemyHp(type);
  stats.enemy++;
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

// ================= 병사 밀어내기 (병사-병사, 병사-벽) =================
// 병사 전용 균일 격자(head/next 연결 리스트, 고정 크기 타입 배열)로 이웃만 검사한다. 매 프레임 할당 없음.
const SEP_CELL = 0.8;                       // 격자 셀 크기 (>= 2*SOLDIER_R)
const SEP_Z0 = SPAWN_Z - 4;                 // 격자 z 시작 (이보다 아래로 간 병사는 곧 제거됨)
const SEP_W = Math.ceil((WORLD_HALF * 2) / SEP_CELL) + 1;
const SEP_D = Math.ceil((CANNON_Z + 3 - SEP_Z0) / SEP_CELL) + 1;
const sepHead = new Int32Array(SEP_W * SEP_D);
const sepNext = new Int32Array(MAX_SOLDIERS);
const sepDx = new Float32Array(MAX_SOLDIERS);   // 병사별 누적 밀어내기량
const sepDz = new Float32Array(MAX_SOLDIERS);
const SEP_DIAM = SOLDIER_R * 2;
const SEP_STRENGTH = 0.4;      // 겹침 중 각자 받는 비율 (최대 0.5 = 반씩). 1 미만으로 두어 여러 이웃이 겹칠 때 과보정 방지
const SEP_MAX_STEP = 0.1;      // 병사당 프레임 최대 이동량 (과밀 시 떨림/발산 방지)
const SEP_MAX_CHECK = 48;      // 병사당 프레임 최대 이웃 검사 수
const WALL_HALF_T = 0.2;       // 벽 반두께
const WALL_SOLDIER_LIM = WALL_X - WALL_HALF_T - SOLDIER_R;   // 전장 쪽 병사 중심 한계 |x| (6.75)
const WALL_LANE_MIN = WALL_X + WALL_HALF_T + SOLDIER_R;      // 옆 구역 쪽 병사 중심 한계 |x| (7.75)

// 이동·게이트 판정 이전에 호출해 위치를 확정한다.
// 게이트(미통과, 살아 있음)의 z를 아래로 넘어가게 밀리면 게이트 바로 위에서 멈춰 통과 판정이 누락되지 않게 한다.
function separateSoldiers() {
  const n = sCount;
  if (n === 0) return;
  sepHead.fill(-1);
  for (let i = 0; i < n; i++) {
    let cx = Math.floor((sx[i] + WORLD_HALF) / SEP_CELL);
    let cz = Math.floor((sz[i] - SEP_Z0) / SEP_CELL);
    cx = cx < 0 ? 0 : cx >= SEP_W ? SEP_W - 1 : cx;
    cz = cz < 0 ? 0 : cz >= SEP_D ? SEP_D - 1 : cz;
    const c = cz * SEP_W + cx;
    sepNext[i] = sepHead[c];
    sepHead[c] = i;
    sepDx[i] = 0;
    sepDz[i] = 0;
  }
  // 병사-병사: 쌍(i<j)마다 겹침만큼 서로 반대로 민다 (누적 후 일괄 적용 = 순서 무관)
  for (let i = 0; i < n; i++) {
    const xi = sx[i], zi = sz[i];
    let cx = Math.floor((xi + WORLD_HALF) / SEP_CELL);
    let cz = Math.floor((zi - SEP_Z0) / SEP_CELL);
    cx = cx < 0 ? 0 : cx >= SEP_W ? SEP_W - 1 : cx;
    cz = cz < 0 ? 0 : cz >= SEP_D ? SEP_D - 1 : cz;
    let checks = 0;
    for (let oz = -1; oz <= 1 && checks < SEP_MAX_CHECK; oz++) {
      const z = cz + oz;
      if (z < 0 || z >= SEP_D) continue;
      for (let ox = -1; ox <= 1 && checks < SEP_MAX_CHECK; ox++) {
        const x = cx + ox;
        if (x < 0 || x >= SEP_W) continue;
        for (let j = sepHead[z * SEP_W + x]; j >= 0; j = sepNext[j]) {
          if (j <= i) continue;
          if (++checks > SEP_MAX_CHECK) break;
          let dx = sx[j] - xi, dz = sz[j] - zi;
          const d2 = dx * dx + dz * dz;
          if (d2 >= SEP_DIAM * SEP_DIAM) continue;
          let d = Math.sqrt(d2);
          if (d < 1e-4) { // 완전히 같은 위치: 인덱스로 정한 고정 방향
            const a = (i * 12.9898 + j * 78.233) % 6.2831853;
            dx = Math.cos(a); dz = Math.sin(a); d = 0;
          } else { dx /= d; dz /= d; }
          const push = (SEP_DIAM - d) * SEP_STRENGTH;
          sepDx[i] -= dx * push; sepDz[i] -= dz * push;
          sepDx[j] += dx * push; sepDz[j] += dz * push;
        }
      }
    }
  }
  // 적용: 이동량 캡 → 벽 → 월드 경계 → 게이트 z 보호
  const capSq = SEP_MAX_STEP * SEP_MAX_STEP;
  for (let i = 0; i < n; i++) {
    let mx = sepDx[i], mz = sepDz[i];
    const m2 = mx * mx + mz * mz;
    if (m2 > capSq) { const s = SEP_MAX_STEP / Math.sqrt(m2); mx *= s; mz *= s; }
    const oz = sz[i];
    let x = sx[i] + mx, z = oz + mz;
    // 벽 구간에서는 자기 쪽 구역(기존 규칙: |x| < WALL_X 전장, 그 외 옆 구역)에서 벽 두께+몸 반지름만큼 떨어진다
    if (z < WALL_END_Z) {
      const ax = Math.abs(x);
      if (ax < WALL_X) { if (ax > WALL_SOLDIER_LIM) x = x < 0 ? -WALL_SOLDIER_LIM : WALL_SOLDIER_LIM; }
      else if (ax < WALL_LANE_MIN) x = x < 0 ? -WALL_LANE_MIN : WALL_LANE_MIN;
    }
    if (x < -WORLD_HALF) x = -WORLD_HALF;
    else if (x > WORLD_HALF) x = WORLD_HALF;
    if (z > oz && z > CANNON_Z + 1) z = Math.max(oz, CANNON_Z + 1); // 대포 뒤로 밀려나지 않게
    if (z < oz) {
      for (let gi = 0; gi < gates.length; gi++) {
        const g = gates[gi];
        if (g.alive && oz > g.z && z <= g.z && !sGate[i * GATE_SLOTS + gi]) z = g.z + 0.001;
      }
    }
    sx[i] = x;
    sz[i] = z;
  }
}

// ================= 웨이브 / 스폰 =================
// 현재 시간의 웨이브 번호: 누적 duration으로 결정. waves.length이면 보스 웨이브(보스 처치까지 계속)
function waveIndexAt(st, t) {
  let end = 0;
  for (let k = 0; k < st.waves.length; k++) {
    end += st.waves[k].duration;
    if (t < end) return k;
  }
  return st.waves.length;
}
// 전장 폭 전체를 채우는 줄(행)을 ENEMY_SPAWN_Z부터 화면 위쪽으로 쌓아 상한까지 채운다 → 위에서부터 빽빽하게 내려온다
// 적 줄 배치 간격 (fillEnemies와 넓은 웨이브 생성이 같이 쓴다)
const FILL_STEP = 0.8;
// 한 번에 이 수 이상 나오는 웨이브는 한 덩어리가 아니라 전장 폭 전체에 줄지어 나온다
const WIDE_GROUP_MIN = 12;
function fillEnemies(st) {
  const step = FILL_STEP, half = WALL_X - 0.8;
  for (let row = 0; ; row++) {
    const z = ENEMY_SPAWN_Z - row * step;
    for (let x = -half + (row % 2) * step / 2; x <= half; x += step) {
      if (!addEnemy(x + (Math.random() - 0.5) * 0.2, pickEnemyType(st.runner, st.tank), z + (Math.random() - 0.5) * 0.2)) return;
    }
  }
}
function pickEnemyType(runnerR, tankR) {
  const r = Math.random();
  if (r < tankR) return E_TANK;
  if (r < tankR + runnerR) return E_RUNNER;
  return E_NORMAL;
}
function spawnGroup(waveIdx, isBossWave) {
  const st = STAGES[stageIdx];
  const wave = isBossWave ? st.bossWave : st.waves[waveIdx];
  const n = wave.count * SPAWN_MULT;
  const runnerR = wave.runner ?? st.runner; // 웨이브 값이 없으면 스테이지 값
  const tankR = wave.tank ?? st.tank;
  if (n >= WIDE_GROUP_MIN) {
    // 많이 나오는 웨이브: 전장 폭 전체를 줄(행)로 채운다 (fillEnemies와 같은 배치).
    // 한 번에 나오는 행들은 다음 생성 전까지 적이 이동하는 거리(간격 × 기본 속도) 안에 고르게 펼쳐서 다음 그룹과 이어 붙게 한다
    const perRow = Math.floor((WALL_X - 0.8) * 2 / FILL_STEP) + 1;
    const rows = Math.ceil(n / perRow);
    const depth = wave.interval * (1.0 + stageIdx * 0.06);
    let left = n;
    for (let r = 0; r < rows; r++) {
      let m = Math.min(perRow, left);
      left -= m;
      const z = ENEMY_SPAWN_Z - (r / rows) * depth;
      for (let j = 0; j < perRow && m > 0; j++) {
        if (Math.random() * (perRow - j) >= m) continue; // 행 안에서 m개 자리를 무작위로 고름
        m--;
        const x = -(WALL_X - 0.8) + j * FILL_STEP;
        addEnemy(x + (Math.random() - 0.5) * 0.2, pickEnemyType(runnerR, tankR), z - Math.random() * 0.3);
      }
    }
    return;
  }
  const cx = (Math.random() * 2 - 1) * (FIELD_W - 2);
  for (let k = 0; k < n; k++) {
    addEnemy(cx + (Math.random() - 0.5) * 3.5, pickEnemyType(runnerR, tankR), ENEMY_SPAWN_Z - Math.random() * 1.5);
  }
}
function spawnBoss() {
  const b = STAGES[stageIdx].boss;
  // 보스는 여유 슬롯을 쓰므로 일반적으로 실패하지 않지만, 실패하면 다음 프레임에 다시 시도한다
  if (!addEnemy(0, E_BOSS, ENEMY_SPAWN_Z - 1, true)) return;
  bossMaxHp = b.hp;
  if (b.escort) {
    for (let k = 0; k < b.escort; k++) addEnemy((Math.random() * 2 - 1) * (FIELD_W - 1), E_RUNNER, ENEMY_SPAWN_Z - Math.random() * 3, true);
  }
  bossSpawned = true;
}

// ================= 업데이트 =================
function update(dt) {
  stageTime += dt;
  const st = STAGES[stageIdx];
  const waveIdx = waveIndexAt(st, stageTime);
  const bossWave = waveIdx >= st.waves.length;
  const baseSpeed = 1.0 + stageIdx * 0.06;

  // --- 대포 발사 ---
  fireTimer += dt;
  const interval = FIRE_INTERVALS[fireLevel];
  while (fireTimer >= interval) {
    fireTimer -= interval;
    fireKickT = FIRE_KICK_DUR;
    for (let c = 0; c < cannonCount; c++) {
      const [dx, dz] = CANNON_OFFSETS[cannonCount][c];
      if (addSoldier(cannonX + dx + (Math.random() - 0.5) * 0.3, CANNON_Z + dz - 2 * CANNON_SCALE, (Math.random() - 0.5) * 0.8, null)) stats.fired++;
    }
  }

  // --- 적 스폰 ---
  if (bossWave && !bossSpawned) spawnBoss();
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnTimer = bossWave ? st.bossWave.interval : st.waves[waveIdx].interval;
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
    if (itemTimer <= 0) { itemTimer = ITEM_INTERVAL; spawnItem(); } // 테스트용: 자주 등장
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
      stats.leak++;
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
    logStats(`STAGE ${stageIdx + 1} GAME OVER`);
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
  const spawnLim = WALL_SOLDIER_LIM; // 밀어내기의 전장 쪽 벽 한계와 같게 (생성 직후 벽에 겹치지 않게)
  let crystalChanged = false;
  separateSoldiers(); // 이동·게이트 판정 이전에 위치 확정 (병사-병사, 병사-벽)
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

    if (sz[i] < SPAWN_Z - 3) { deadBuf[deadCount++] = i; stats.exit++; continue; }

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
      if (Math.abs(dx) < ICE_W / 2 + SOLDIER_R && Math.abs(dz) < ICE_D / 2 + SOLDIER_R) { // 얼음 박스 직사각형 판정
        deadBuf[deadCount++] = i;
        stats.crystal++;
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
            if (ehp[e] <= 0) { score += ETYPE[etype[e]].score; stats.kill++; }
            hit = true;
            break;
          }
        }
      }
    }
    if (hit) { deadBuf[deadCount++] = i; stats.fight++; }
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
  for (let k = 0; k < spawnCount; k++) if (addSoldier(spawnX[k], spawnZ[k], spawnVx[k], spawnFlags, k * GATE_SLOTS)) stats.gate++;
  soldierCapT = Math.max(0, soldierCapT - dt);

  // --- 스테이지 클리어 ---
  if (bossSpawned && !bossAlive) {
    const last = stageIdx === STAGES.length - 1;
    if (last) showOverlay('ALL CLEAR!', `모든 스테이지를 클리어했습니다\n점수 ${score}`, '클릭하여 처음부터 · 번호로 스테이지 선택');
    else showOverlay(`STAGE ${stageIdx + 1} CLEAR`, `점수 ${score}`, '클릭하여 다음 스테이지 · 번호로 스테이지 선택');
    setState(last ? 'win' : 'clear');
    logStats(`STAGE ${stageIdx + 1} CLEAR`);
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
      // 발사 연출: 발사 직전 서서히 부풀다가(가속), 발사 순간 움츠렸다 돌아온다 (포신 굵기만, 몸통·그룹 크기는 그대로)
      let fireMul = 1;
      if (state === 'play') {
        const charge = Math.min(FIRE_CHARGE_MAX, FIRE_INTERVALS[fireLevel] * 0.6);
        const cp = Math.min(1, Math.max(0, (fireTimer - (FIRE_INTERVALS[fireLevel] - charge)) / charge));
        fireMul += FIRE_CHARGE_SWELL * cp * cp - FIRE_KICK_SQUASH * (fireKickT / FIRE_KICK_DUR);
      }
      m.group.scale.setScalar(CANNON_SCALE * pop);
      tmpColor.setHex(LEVEL_COLORS[shownLevel]);
      m.barrelMat.color.copy(tmpColor);
      const bt = (1 + shownLevel * 0.1) * fireMul; // 포신 굵기: 레벨 굵기 × 발사 연출 (길이는 그대로)
      m.barrel.scale.set(bt, 1, bt);
      // 대포 추가 발광: 팝과 같은 타이머로 번쩍였다가 사라진다 (끝나면 정확히 0으로 복원)
      let glow = 0;
      if (cannonPopT > 0 && cannonCount > 1) {
        glow = (c === cannonCount - 1 ? CANNON_GLOW_NEW : CANNON_GLOW_OLD) * (cannonPopT / CANNON_POP_DUR);
      }
      m.barrelMat.emissiveIntensity = glow;
      m.wheelMat.emissiveIntensity = glow;
    }
  }

  const waveCount = STAGES[stageIdx].waves.length;
  const wave = waveIndexAt(STAGES[stageIdx], stageTime);
  hud.textContent =
    `STAGE ${stageIdx + 1}/${STAGES.length}  ${wave >= waveCount ? 'BOSS' : `웨이브 ${wave + 1}/${waveCount}`}   HP ${hp}   점수 ${score}\n` +
    `병사 ${sCount}${sCount >= MAX_SOLDIERS || soldierCapT > 0 ? ' MAX' : ''}   대포 ${cannonCount}   공격속도 Lv${fireLevel}` +
    (STATS_ON
      ? `\n[통계] 아군생성 ${stats.fired + stats.gate} (발사 ${stats.fired} + 게이트 ${stats.gate})   적생성 ${stats.enemy}\n` +
        `아군소멸: 끝도달 ${stats.exit} · 적과전투 ${stats.fight} · 얼음타격 ${stats.crystal}   적처치 ${stats.kill} · 방어선도달 ${stats.leak}`
      : '');
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

{
  // ?stage=N (1부터)이 범위 안이면 그 스테이지로 시작한다 (에디터 플레이 테스트용). 없거나 범위 밖이면 1번
  const sp = new URLSearchParams(location.search).get('stage');
  const sn = sp !== null && /^\d+$/.test(sp) ? Number(sp) : 0;
  loadStage(sn >= 1 && sn <= STAGES.length ? sn - 1 : 0);
}
requestAnimationFrame(loop);
