// 오브젝트 타입 레지스트리. model.js / view.js / panels.js는 타입을 모르고 이 목록을 순회해서 동작한다.
// 새 오브젝트는 registerType({...}) 한 번이면 추가된다 (README.md 참고).
//
// 타입 정의:
//   id, label, addLabel                      식별자 / 표시 이름 / "추가" 버튼 글자
//   storage: { kind:'array', key } | { kind:'flag', key }
//        array: stage[key]가 오브젝트 배열 (게이트처럼 여러 개)
//        flag : stage[key]가 boolean이고 오브젝트 데이터는 stage 자체의 필드 (얼음 대포처럼 0/1개)
//   max                                      array 최대 개수 (flag는 1)
//   create(stage, config) -> obj             array 새 오브젝트 기본값
//   fields: [필드 정의]                       속성 패널 폼 (fields.js 참고). obj는 array면 요소, flag면 stage
//   describe(obj, stage, config) -> string   목록/상태 표시용 짧은 이름
//   notes(obj, stage, config) -> string[]    패널에 표시할 안내 문구 (선택)
//   configFields: ['키', ...]                선택 패널에 같이 보여줄 전역 수치 이름 (schema.js CONFIG_FIELDS의 name, 선택).
//                                            전역 값이라 모든 스테이지에 적용되고, 기본 스테이지가 잠겨 있어도 수정된다
//   hitTest(obj, x, z, ctx) -> {mode, cursor}|null   ctx = { tol, stage, config }
//   draw(dc, obj, { selected, warn })        dc = view가 주는 그리기 도구 (rect/text/line/...)
//   onDrag(start, d) -> patch                d = { mode, grab, pt, dx, dz, snap, stage, config }, start = 드래그 시작 때의 obj 사본
//   nudge(obj, dx, dz, ctx) -> patch|null    방향키 이동
//   normalize(stage, obj, changedKeys)       값이 바뀐 뒤 연관 값 정리 (예: 같은 구역 교환)
//   warnings(obj, stage, config) -> string[] 경고(저장은 가능). 있으면 캔버스에서 경고색
//   validate(obj, stage, config) -> string[] 추가 오류(저장 차단). 필드 범위 검사는 fields로 자동 수행
//   afterDuplicate(copy)                     복제본 위치 조정 (array 전용, 선택)
import {
  FIELD_W, LANE_X, LANE_W, WORLD_HALF, SPAWN_Z, BASE_Z, CANNON_Z, GATE_SLOTS,
} from '../shared/world.js';

const TYPES = [];

export function registerType(def) {
  if (!def || !def.id || !def.storage || !def.storage.key) throw new Error('타입 정의에 id/storage가 필요합니다');
  const i = TYPES.findIndex((t) => t.id === def.id);
  if (i >= 0) TYPES[i] = def;
  else TYPES.push(def);
  return def;
}
export function unregisterType(id) {
  const i = TYPES.findIndex((t) => t.id === id);
  if (i >= 0) TYPES.splice(i, 1);
}
export const getTypes = () => TYPES;
export const getType = (id) => TYPES.find((t) => t.id === id) || null;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r3 = (v) => Math.round(v * 1000) / 1000;
const sideOf = (x) => (x < 0 ? -1 : 1);
const inRect = (x, z, x0, x1, z0, z1) => x >= x0 && x <= x1 && z >= z0 && z <= z1;

// ---------- 게이트 (+N / ×N) ----------
const GATE_HALF_Z = 0.4; // 캔버스에서 그리는 두께의 절반
const gate = {
  id: 'gate',
  label: '게이트',
  addLabel: '게이트 추가',
  storage: { kind: 'array', key: 'gates' },
  max: GATE_SLOTS,
  create: () => ({ op: '+', val: 10, x: 0, z: 0, w: FIELD_W * 2 }),
  fields: [
    { name: 'op', label: '종류', type: 'select', options: [{ value: '+', label: '+ (더하기)' }, { value: '×', label: '× (곱하기)' }] },
    { name: 'val', label: '값', type: 'number', min: 1, max: 999, step: 1, int: true },
    { name: 'x', label: 'x (중심)', type: 'number', min: -WORLD_HALF, max: WORLD_HALF, step: 0.5 },
    { name: 'z', label: 'z', type: 'number', min: SPAWN_Z, max: BASE_Z, step: 0.5 },
    { name: 'w', label: '폭 w', type: 'number', min: 0.5, max: FIELD_W * 2, step: 0.5 },
  ],
  describe: (g) => `${g.op}${g.val}`,
  notes: () => [`전장 안(x ±${FIELD_W})에서만 이동합니다. 드래그: 0.5 격자 스냅(Shift로 해제), 좌우 가장자리: 폭 조절`],
  hitTest(g, x, z, ctx) {
    const l = g.x - g.w / 2;
    const r = g.x + g.w / 2;
    if (Math.abs(z - g.z) > GATE_HALF_Z + ctx.tol * 0.5 || x < l - ctx.tol || x > r + ctx.tol) return null;
    const edge = Math.min(ctx.tol, g.w / 3);
    if (Math.abs(x - l) <= edge) return { mode: 'resize-l', cursor: 'ew-resize' };
    if (Math.abs(x - r) <= edge) return { mode: 'resize-r', cursor: 'ew-resize' };
    return { mode: 'move', cursor: 'move' };
  },
  draw(dc, g, { selected, warn }) {
    const fill = warn ? 'rgba(255,150,40,0.75)' : 'rgba(40,120,255,0.7)';
    const stroke = selected ? '#ffffff' : warn ? '#ffd08a' : '#bfe0ff';
    dc.rect(g.x - g.w / 2, g.z - GATE_HALF_Z, g.x + g.w / 2, g.z + GATE_HALF_Z, fill, stroke, selected ? 3 : 1.5);
    dc.text(`${g.op}${g.val}`, g.x, g.z, { color: '#fff', bold: true, size: 15 });
    if (selected) {
      dc.rect(g.x - g.w / 2 - 0.12, g.z - 0.3, g.x - g.w / 2 + 0.12, g.z + 0.3, '#ffd23a');
      dc.rect(g.x + g.w / 2 - 0.12, g.z - 0.3, g.x + g.w / 2 + 0.12, g.z + 0.3, '#ffd23a');
    }
  },
  onDrag(s, d) {
    const left0 = s.x - s.w / 2;
    const right0 = s.x + s.w / 2;
    if (d.mode === 'resize-l') {
      const left = clamp(d.snap(d.pt.x), -FIELD_W, right0 - 0.5);
      return { x: r3((left + right0) / 2), w: r3(right0 - left) };
    }
    if (d.mode === 'resize-r') {
      const right = clamp(d.snap(d.pt.x), left0 + 0.5, FIELD_W);
      return { x: r3((left0 + right) / 2), w: r3(right - left0) };
    }
    return {
      x: r3(clamp(d.snap(s.x + d.dx), -FIELD_W + s.w / 2, FIELD_W - s.w / 2)),
      z: r3(clamp(d.snap(s.z + d.dz), SPAWN_Z, BASE_Z)),
    };
  },
  nudge: (g, dx, dz) => ({
    x: r3(clamp(g.x + dx, -FIELD_W + g.w / 2, FIELD_W - g.w / 2)),
    z: r3(clamp(g.z + dz, SPAWN_Z, BASE_Z)),
  }),
  afterDuplicate(c) { c.z = r3(c.z - 1 < SPAWN_Z ? c.z + 1 : c.z - 1); },
  warnings(g, stage) {
    const out = [];
    if (g.x - g.w / 2 < -FIELD_W - 1e-6 || g.x + g.w / 2 > FIELD_W + 1e-6) out.push('게이트가 전장(x ±7) 밖으로 나갑니다');
    for (const o of stage.gates) {
      if (o === g || Math.abs(o.z - g.z) >= 0.25) continue;
      if (Math.min(o.x + o.w / 2, g.x + g.w / 2) - Math.max(o.x - o.w / 2, g.x - g.w / 2) > 1e-6) {
        out.push('같은 z에서 다른 게이트와 겹칩니다');
        break;
      }
    }
    return out;
  },
};

// ---------- 옆 구역 오브젝트 공통 (얼음 대포 / 대포 추가 벽) ----------
// 두 오브젝트는 서로 다른 옆 구역에 있어야 한다. 한쪽을 바꾸면 다른 쪽이 자동으로 반대편이 된다.
const swapSide = (own, other) => (stage, obj, keys) => {
  if (keys.includes(own) && stage[own] === stage[other] && (stage[own] === -1 || stage[own] === 1)) stage[other] = -stage[own];
};
const SIDE_OPTIONS = [{ value: -1, label: '왼쪽 구역' }, { value: 1, label: '오른쪽 구역' }];

const ICE_D = 2.6;
const crystal = {
  id: 'crystal',
  label: '얼음 대포 (2번 강화)',
  addLabel: '얼음 대포 켜기',
  storage: { kind: 'flag', key: 'crystal' },
  max: 1,
  fields: [
    { name: 'crystalSide', label: '위치(옆 구역)', type: 'select', options: SIDE_OPTIONS },
  ],
  configFields: ['crystalZ'],
  describe: (s) => `얼음 대포 (${s.crystalSide === -1 ? '왼쪽' : '오른쪽'})`,
  notes: () => ['캔버스 드래그는 좌우 구역만 바뀝니다. 세로 위치(z)는 아래 입력칸(전역 수치, 모든 스테이지에 적용)에서 바꿉니다. 대포 추가 벽과 같은 쪽이면 다른 쪽이 자동 교환됩니다'],
  hitTest(s, x, z, ctx) {
    const cx = s.crystalSide * LANE_X;
    const zc = ctx.config.crystalZ;
    return inRect(x, z, cx - LANE_W / 2, cx + LANE_W / 2, zc - ICE_D / 2, zc + ICE_D / 2) ? { mode: 'move', cursor: 'grab' } : null;
  },
  draw(dc, s, { selected, warn }) {
    const cx = s.crystalSide * LANE_X;
    const zc = dc.config.crystalZ;
    dc.rect(cx - LANE_W / 2, SPAWN_Z - 3, cx + LANE_W / 2, CANNON_Z - 1, 'rgba(210,200,60,0.14)'); // 2번 강화 구역 색
    dc.rect(cx - LANE_W / 2, zc - ICE_D / 2, cx + LANE_W / 2, zc + ICE_D / 2,
      warn ? 'rgba(255,150,40,0.6)' : 'rgba(150,225,255,0.55)', selected ? '#fff' : '#d8f6ff', selected ? 3 : 1.5);
    dc.text('얼음 대포', cx, zc - 0.35, { color: '#fff', bold: true, size: 13 });
    dc.text(`z=${zc} (전역)`, cx, zc + 0.45, { color: '#cfefff', size: 11 });
  },
  onDrag: (s, d) => ({ crystalSide: sideOf(d.pt.x) }),
  nudge: (s, dx) => (dx === 0 ? null : { crystalSide: sideOf(dx) }),
  normalize: swapSide('crystalSide', 'itemSide'),
  validate: (s) => (s.crystalSide === s.itemSide ? ['얼음 대포와 대포 추가 벽이 같은 옆 구역입니다 (crystalSide == itemSide)'] : []),
};

const ITEM_Z = -13; // main.js spawnItem의 시작 z (코드 고정)
const items = {
  id: 'items',
  label: '대포 추가 벽 (3번 강화)',
  addLabel: '대포 추가 벽 켜기',
  storage: { kind: 'flag', key: 'items' },
  max: 1,
  fields: [
    { name: 'itemSide', label: '내려오는 옆 구역', type: 'select', options: SIDE_OPTIONS },
  ],
  configFields: ['itemFirstDelay', 'itemInterval'],
  describe: (s) => `대포 추가 벽 (${s.itemSide === -1 ? '왼쪽' : '오른쪽'})`,
  notes: () => ['위(z=-13)에서 대포 쪽으로 내려오는 벽입니다. 구역과 등장 주기(전역 수치, 모든 스테이지에 적용)를 바꿀 수 있습니다. 얼음 대포와 같은 쪽이면 다른 쪽이 자동 교환됩니다'],
  hitTest(s, x, z) {
    const cx = s.itemSide * LANE_X;
    return inRect(x, z, cx - LANE_W / 2, cx + LANE_W / 2, ITEM_Z - 1, ITEM_Z + 1) ? { mode: 'move', cursor: 'grab' } : null;
  },
  draw(dc, s, { selected, warn }) {
    const cx = s.itemSide * LANE_X;
    dc.rect(cx - LANE_W / 2, SPAWN_Z - 3, cx + LANE_W / 2, CANNON_Z - 1, 'rgba(40,190,120,0.14)'); // 3번 강화 구역 색
    dc.rect(cx - LANE_W / 2, ITEM_Z - 0.5, cx + LANE_W / 2, ITEM_Z + 0.5,
      warn ? 'rgba(255,150,40,0.6)' : 'rgba(40,190,80,0.55)', selected ? '#fff' : '#c4f5d2', selected ? 3 : 1.5);
    dc.text('대포 +1', cx, ITEM_Z, { color: '#fff', bold: true, size: 13 });
    // 내려오는 방향 화살표
    dc.line(cx, ITEM_Z + 0.8, cx, CANNON_Z - 2, 'rgba(120,255,160,0.7)', 2, true);
    for (let z = ITEM_Z + 3; z < CANNON_Z - 3; z += 4) dc.arrow(cx, z, 'rgba(120,255,160,0.8)');
  },
  onDrag: (s, d) => ({ itemSide: sideOf(d.pt.x) }),
  nudge: (s, dx) => (dx === 0 ? null : { itemSide: sideOf(dx) }),
  normalize: swapSide('itemSide', 'crystalSide'),
};

registerType(crystal);
registerType(items);
registerType(gate); // 마지막 = 맨 위에 그려지고 먼저 선택된다
