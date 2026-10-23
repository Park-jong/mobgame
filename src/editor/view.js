// 탑뷰 캔버스 렌더 + 마우스 상호작용. 오브젝트 종류는 모르고 objectTypes 레지스트리의 draw/hitTest/onDrag를 호출한다.
// 좌표계는 게임과 같다: x는 오른쪽 +, z는 아래쪽 +(대포 쪽). 스케일은 창 크기에 맞춰 고정(줌 없음).
import {
  FIELD_W, LANE_GAP, LANE_W, LANE_X, WORLD_HALF, SPAWN_Z, ENEMY_SPAWN_Z, BASE_Z, CANNON_Z, WALL_X, WALL_END_Z,
} from '../shared/world.js';
import { getTypes } from './objectTypes.js';
import { listOf, snapTo, round3, objectWarnings, isLocked, isBaseStage } from './model.js';

const X_MIN = -WORLD_HALF - 1.5, X_MAX = WORLD_HALF + 1.5;
const Z_MIN = ENEMY_SPAWN_Z - 2, Z_MAX = CANNON_Z + 2.5;
const PAD_L = 34, PAD_R = 8, PAD_T = 8, PAD_B = 22;
const DRAG_THRESHOLD_PX = 3;

/**
 * app 인터페이스:
 *   getData(), getStageIdx(), getSel() -> {typeId, index}|null, select(sel|null)
 *   dragStart()            첫 이동 직전에 한 번 (undo 기록용)
 *   patch(typeId, idx, p)  데이터에 패치 적용 (기록 안 함)
 *   dragEnd()
 *   mouse(x, z)            마우스 월드 좌표 (캔버스 밖이면 null)
 */
export function createView(canvas, app) {
  const g = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1, s = 1, ox = 0, oy = 0;
  let drag = null; // { typeId, index, mode, grab, start, startPx, moved }

  const X = (x) => ox + (x - X_MIN) * s;
  const Z = (z) => oy + (z - Z_MIN) * s;
  const toWorld = (px, py) => ({ x: (px - ox) / s + X_MIN, z: (py - oy) / s + Z_MIN });

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    W = Math.max(100, r.width); H = Math.max(100, r.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    s = Math.min((W - PAD_L - PAD_R) / (X_MAX - X_MIN), (H - PAD_T - PAD_B) / (Z_MAX - Z_MIN));
    ox = PAD_L + (W - PAD_L - PAD_R - s * (X_MAX - X_MIN)) / 2;
    oy = PAD_T;
    draw();
  }

  // 레지스트리 draw에 넘기는 그리기 도구 (월드 좌표 기준)
  function makeDc(stage, config) {
    return {
      g, config, stage, scale: s,
      rect(x0, z0, x1, z1, fill, stroke, lw = 1) {
        const px = X(x0), py = Z(z0), pw = (x1 - x0) * s, ph = (z1 - z0) * s;
        if (fill) { g.fillStyle = fill; g.fillRect(px, py, pw, ph); }
        if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.strokeRect(px, py, pw, ph); }
      },
      line(x0, z0, x1, z1, color, lw = 1, dash = false) {
        g.strokeStyle = color; g.lineWidth = lw;
        g.setLineDash(dash ? [6, 4] : []);
        g.beginPath(); g.moveTo(X(x0), Z(z0)); g.lineTo(X(x1), Z(z1)); g.stroke();
        g.setLineDash([]);
      },
      arrow(x, z, color) { // 아래(+z)를 향한 화살표
        g.fillStyle = color;
        g.beginPath();
        g.moveTo(X(x - 0.5), Z(z - 0.4)); g.lineTo(X(x + 0.5), Z(z - 0.4)); g.lineTo(X(x), Z(z + 0.4));
        g.closePath(); g.fill();
      },
      text(str, x, z, o = {}) {
        g.fillStyle = o.color || '#ddd';
        g.font = `${o.bold ? 'bold ' : ''}${o.size || 12}px sans-serif`;
        g.textAlign = o.align || 'center'; g.textBaseline = 'middle';
        g.fillText(str, X(x), Z(z));
      },
    };
  }

  function drawWorld(dc, stage) {
    // 바닥: 전장, 옆 구역(역할 색은 오브젝트 타입이 알려 주지 않으므로 기본색), 벽
    g.fillStyle = '#12161c'; g.fillRect(0, 0, W, H);
    const zTop = Z_MIN, zBot = Z_MAX - 1.0;
    dc.rect(-FIELD_W, zTop, FIELD_W, zBot, '#26384a');
    for (const sign of [-1, 1]) {
      dc.rect(sign * LANE_X - LANE_W / 2, zTop, sign * LANE_X + LANE_W / 2, zBot, '#3a3a3a');
    }
    // 격자 (1칸 연한 선, 5칸 진한 선) + 눈금
    g.font = '10px sans-serif'; g.textBaseline = 'top'; g.textAlign = 'center';
    for (let x = Math.ceil(X_MIN); x <= X_MAX; x++) {
      const major = x % 5 === 0;
      dc.line(x, zTop, x, zBot, major ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.07)');
      if (major) { g.fillStyle = '#8a95a3'; g.fillText(String(x), X(x), Z(zBot) + 4); }
    }
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let z = Math.ceil(Z_MIN); z <= Z_MAX; z++) {
      const major = z % 5 === 0;
      dc.line(X_MIN, z, X_MAX, z, major ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.07)');
      if (major) { g.fillStyle = '#8a95a3'; g.fillText(String(z), X(X_MIN) - 4, Z(z)); }
    }
    // 벽 (z < WALL_END_Z 구간만)
    for (const sign of [-1, 1]) dc.rect(sign * WALL_X - 0.2, zTop, sign * WALL_X + 0.2, WALL_END_Z, '#8a8f99');
    // 구역 라벨
    dc.text('전장', 0, zTop + 0.6, { color: '#7fa6cc', bold: true, size: 13 });
    dc.text('옆 구역(좌)', -LANE_X, zTop + 0.6, { color: '#aaa', size: 12 });
    dc.text('옆 구역(우)', LANE_X, zTop + 0.6, { color: '#aaa', size: 12 });
    dc.text('벽 z<' + WALL_END_Z, -WALL_X, WALL_END_Z + 0.6, { color: '#8a8f99', size: 10 });
    dc.text('벽', WALL_X, WALL_END_Z + 0.6, { color: '#8a8f99', size: 10 });
    // 스폰선 / 방어선 / 대포 영역
    dc.line(X_MIN, ENEMY_SPAWN_Z, X_MAX, ENEMY_SPAWN_Z, '#e07a3a', 2, true);
    dc.text(`적 스폰선 z=${ENEMY_SPAWN_Z}`, -FIELD_W + 3.2, ENEMY_SPAWN_Z - 0.6, { color: '#e07a3a', size: 11 });
    dc.line(X_MIN, SPAWN_Z, X_MAX, SPAWN_Z, 'rgba(160,160,160,0.5)', 1, true);
    dc.text(`병사 소멸선 z=${SPAWN_Z - 3}`, -FIELD_W + 3.2, SPAWN_Z - 0.6, { color: '#999', size: 10 });
    dc.line(X_MIN, BASE_Z, X_MAX, BASE_Z, '#ff4444', 2);
    dc.text(`방어선 z=${BASE_Z}`, -FIELD_W + 2.5, BASE_Z - 0.6, { color: '#ff6666', size: 11 });
    dc.rect(-WORLD_HALF, CANNON_Z - 0.4, WORLD_HALF, CANNON_Z + 0.9, 'rgba(120,200,120,0.18)');
    dc.text(`대포 영역 z=${CANNON_Z}`, 0, CANNON_Z + 0.25, { color: '#8fd08f', size: 11 });
    // 보스 스폰 위치(코드 고정, 표시만)
    g.fillStyle = '#b02a2a'; g.beginPath();
    g.arc(X(0), Z(ENEMY_SPAWN_Z - 1), 7, 0, Math.PI * 2); g.fill();
    dc.text(`보스 스폰 (x=0, 고정)`, 0, ENEMY_SPAWN_Z - 1.9, { color: '#e88', size: 11 });
    dc.text(`호위/일반 스폰 x ±${FIELD_W - 1}`, FIELD_W - 3, ENEMY_SPAWN_Z - 0.6, { color: '#b9784a', size: 10 });
  }

  // 잠긴(기본) 스테이지 표시: 우측 상단 배지
  function drawLockBadge(locked) {
    const text = locked ? '🔒 읽기 전용 (기본 스테이지)' : '🔓 편집 가능(기본 스테이지)';
    g.font = 'bold 12px sans-serif';
    const w = g.measureText(text).width + 16;
    g.fillStyle = locked ? 'rgba(120,40,40,0.9)' : 'rgba(150,100,20,0.95)';
    g.fillRect(W - PAD_R - w, PAD_T, w, 22);
    g.fillStyle = '#ffd9d9'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(text, W - PAD_R - w + 8, PAD_T + 11);
  }

  function draw() {
    if (!W) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const data = app.getData();
    const si = app.getStageIdx();
    const stage = data.stages[si];
    if (!stage) return;
    const dc = makeDc(stage, app.getEffectiveConfig());
    drawWorld(dc, stage);
    const sel = app.getSel();
    for (const type of getTypes()) {
      if (!type.draw) continue;
      listOf(stage, type).forEach((obj, idx) => {
        const selected = !!sel && sel.typeId === type.id && sel.index === idx;
        const warn = objectWarnings(data, si, type.id, idx).length > 0;
        type.draw(dc, obj, { selected, warn });
      });
    }
    if (isBaseStage(si)) drawLockBadge(isLocked(si));
  }

  // 위에 그려진 것부터: 타입은 뒤에서부터, 같은 타입 안에서는 선택된 것 우선 후 뒤에서부터
  function pick(wx, wz) {
    const data = app.getData();
    const si = app.getStageIdx();
    const stage = data.stages[si];
    const ctx = { tol: 7 / s, stage, config: app.getEffectiveConfig() };
    const sel = app.getSel();
    const types = getTypes();
    for (let t = types.length - 1; t >= 0; t--) {
      const type = types[t];
      if (!type.hitTest) continue;
      const list = listOf(stage, type);
      const order = list.map((_, i) => i).reverse();
      if (sel && sel.typeId === type.id) order.sort((a, b) => (b === sel.index) - (a === sel.index));
      for (const i of order) {
        const hit = type.hitTest(list[i], wx, wz, ctx);
        if (hit) return { typeId: type.id, index: i, hit };
      }
    }
    return null;
  }

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const { px, py } = local(e);
    const w = toWorld(px, py);
    const p = pick(w.x, w.z);
    app.select(p ? { typeId: p.typeId, index: p.index } : null);
    if (p && !isLocked(app.getStageIdx())) { // 잠긴 스테이지는 선택만 되고 드래그는 시작하지 않는다
      const data = app.getData();
      const stage = data.stages[app.getStageIdx()];
      const type = getTypes().find((t) => t.id === p.typeId);
      const start = structuredClone(listOf(stage, type)[p.index]);
      drag = { typeId: p.typeId, index: p.index, mode: p.hit.mode, grab: w, start, startPx: { px, py }, moved: false };
      canvas.setPointerCapture(e.pointerId);
    }
    draw();
  });

  canvas.addEventListener('pointermove', (e) => {
    const { px, py } = local(e);
    const w = toWorld(px, py);
    const inside = px >= 0 && py >= 0 && px <= W && py <= H;
    app.mouse(inside ? round3(w.x) : null, inside ? round3(w.z) : null);
    if (drag) {
      if (!drag.moved && Math.hypot(px - drag.startPx.px, py - drag.startPx.py) < DRAG_THRESHOLD_PX) return;
      const type = getTypes().find((t) => t.id === drag.typeId);
      const data = app.getData();
      if (!drag.moved) { drag.moved = true; app.dragStart(); }
      const noSnap = e.shiftKey;
      const patch = type.onDrag(drag.start, {
        mode: drag.mode, grab: drag.grab, pt: w, dx: w.x - drag.grab.x, dz: w.z - drag.grab.z,
        snap: (v) => (noSnap ? round3(v) : snapTo(v, 0.5)), stage: data.stages[app.getStageIdx()], config: app.getEffectiveConfig(),
      });
      app.patch(drag.typeId, drag.index, patch);
      draw();
      return;
    }
    const p = pick(w.x, w.z);
    canvas.style.cursor = p ? (isLocked(app.getStageIdx()) ? 'pointer' : p.hit.cursor || 'move') : 'default';
  });

  const end = () => {
    if (drag) {
      const moved = drag.moved;
      drag = null;
      if (moved) app.dragEnd();
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (!drag) app.mouse(null, null); });

  new ResizeObserver(resize).observe(canvas);
  return { draw, resize };
}
