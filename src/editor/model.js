// 에디터 데이터 로직 (DOM 없음, Node에서 테스트 가능). 오브젝트 종류는 모르고 objectTypes 레지스트리를 순회한다.
// 모든 편집 함수는 전달받은 data를 제자리에서 바꾸며, 모르는 키는 건드리지 않아 저장 시 그대로 보존된다.
import { getTypes, getType } from './objectTypes.js';
import { checkField, validateFields, getValue, setValue } from './fields.js';
import {
  MAX_STAGES, LOCKED_STAGE_COUNT, ETYPE_COUNT, STAGE_FIELDS, BOSS_FIELDS, CONFIG_FIELDS, ETYPE_FIELDS, ETYPE_NAMES,
} from './schema.js';

export { MAX_STAGES, LOCKED_STAGE_COUNT };

// 기본 스테이지(인덱스 < LOCKED_STAGE_COUNT)는 기본적으로 읽기 전용. 아래 모든 변경 함수가 isLocked를 검사해 거부한다.
// 사용자가 "편집 잠금 해제"를 하면(세션 메모리에만 유지, 저장 안 함) 내용 편집은 허용되지만
// 삭제·순서 이동은 계속 막는다 (isBaseStage 기준: 스테이지 개수와 번호 보존).
let baseUnlocked = false;
export const setBaseUnlocked = (b) => { baseUnlocked = !!b; };
export const isBaseUnlocked = () => baseUnlocked;
export const isBaseStage = (stageIdx) => stageIdx < LOCKED_STAGE_COUNT;
export const isLocked = (stageIdx) => isBaseStage(stageIdx) && !baseUnlocked;

export const clone = (v) => structuredClone(v);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round3 = (v) => Math.round(v * 1000) / 1000;
export const snapTo = (v, step = 0.5) => round3(Math.round(v / step) * step);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------- 오브젝트 목록 접근 (저장 방식은 타입 정의의 storage가 정한다) ----------
// array 타입은 stage[key] 요소들, flag 타입은 켜져 있으면 [stage] 하나
export function listOf(stage, type) {
  const { kind, key } = type.storage;
  if (kind === 'array') return Array.isArray(stage[key]) ? stage[key] : [];
  return stage[key] === true ? [stage] : [];
}

export function canAdd(stage, type) {
  const { kind, key } = type.storage;
  if (kind === 'flag') return stage[key] === true ? { ok: false, reason: `${type.label}은(는) 이미 켜져 있습니다` } : { ok: true };
  const max = type.max ?? Infinity;
  if (listOf(stage, type).length >= max) return { ok: false, reason: `${type.label}은(는) 최대 ${max}개까지 추가할 수 있습니다` };
  return { ok: true };
}

// 반환: 새 오브젝트 인덱스 또는 -1
export function addObject(data, si, typeId) {
  const stage = data.stages[si];
  const type = getType(typeId);
  if (isLocked(si) || !stage || !type || !canAdd(stage, type).ok) return -1;
  const { kind, key } = type.storage;
  if (kind === 'flag') {
    stage[key] = true;
    return 0;
  }
  if (!Array.isArray(stage[key])) stage[key] = [];
  stage[key].push(type.create(stage, data.config));
  return stage[key].length - 1;
}

export function removeObject(data, si, typeId, idx) {
  const stage = data.stages[si];
  const type = getType(typeId);
  if (isLocked(si) || !stage || !type) return false;
  const { kind, key } = type.storage;
  if (kind === 'flag') {
    if (stage[key] !== true) return false;
    stage[key] = false;
    return true;
  }
  if (!Array.isArray(stage[key]) || idx < 0 || idx >= stage[key].length) return false;
  stage[key].splice(idx, 1);
  return true;
}

export function duplicateObject(data, si, typeId, idx) {
  const stage = data.stages[si];
  const type = getType(typeId);
  if (isLocked(si) || !stage || !type || type.storage.kind !== 'array') return -1;
  if (!canAdd(stage, type).ok || !stage[type.storage.key][idx]) return -1;
  const copy = clone(stage[type.storage.key][idx]);
  if (type.afterDuplicate) type.afterDuplicate(copy);
  stage[type.storage.key].push(copy);
  return stage[type.storage.key].length - 1;
}

function targetOf(data, si, typeId, idx) {
  if (isLocked(si)) return null; // 잠긴 스테이지는 편집 대상이 될 수 없다 (읽기 전용 조회는 listOf로 직접)
  const stage = data.stages[si];
  const type = getType(typeId);
  if (!stage || !type) return null;
  const obj = listOf(stage, type)[idx];
  return obj ? { stage, type, obj } : null;
}

// 여러 키를 한 번에 바꾼다 (드래그 이동/리사이즈). 값은 그대로 저장하고 normalize로 연관 값을 정리한다.
export function applyPatch(data, si, typeId, idx, patch) {
  const t = targetOf(data, si, typeId, idx);
  if (!t || !patch) return false;
  Object.assign(t.obj, patch);
  if (t.type.normalize) t.type.normalize(t.stage, t.obj, Object.keys(patch));
  return true;
}

// 폼 필드 하나 편집 (필드 정의의 set이 있으면 그것을 쓴다)
export function editObjectField(data, si, typeId, idx, field, value) {
  const t = targetOf(data, si, typeId, idx);
  if (!t) return false;
  setValue(field, t.obj, value);
  if (t.type.normalize) t.type.normalize(t.stage, t.obj, [field.name]);
  return true;
}

// ---------- 스테이지 ----------
// 새 스테이지는 기준 스테이지의 복제. 반환: 새 인덱스 또는 -1
export function addStage(data, fromIdx) {
  if (data.stages.length >= MAX_STAGES) return -1;
  data.stages.push(clone(data.stages[fromIdx] ?? data.stages[data.stages.length - 1]));
  return data.stages.length - 1;
}
export function duplicateStage(data, idx) {
  if (data.stages.length >= MAX_STAGES || !data.stages[idx]) return -1;
  data.stages.push(clone(data.stages[idx])); // 항상 맨 뒤 (잠긴 스테이지의 인덱스가 밀리지 않게)
  return data.stages.length - 1;
}
export function removeStage(data, idx) {
  if (isBaseStage(idx) || data.stages.length <= 1 || !data.stages[idx]) return false;
  data.stages.splice(idx, 1);
  return true;
}
// 잠긴 스테이지를 움직이거나, 잠긴 위치로 다른 스테이지를 들이는 이동은 불가
export function canMoveStage(data, idx, dir) {
  const j = idx + dir;
  return !!data.stages[idx] && j >= 0 && j < data.stages.length && !isBaseStage(idx) && !isBaseStage(j);
}
// dir: -1(위로) / 1(아래로). 반환: 새 인덱스 또는 -1
export function moveStage(data, idx, dir) {
  if (!canMoveStage(data, idx, dir)) return -1;
  const j = idx + dir;
  [data.stages[idx], data.stages[j]] = [data.stages[j], data.stages[idx]];
  return j;
}

// 스테이지/보스 폼 필드 편집. 잠긴 스테이지면 변경 없이 false
export function setStageField(data, si, field, value) {
  const stage = data.stages[si];
  if (isLocked(si) || !isObj(stage)) return false;
  setValue(field, stage, value);
  return true;
}
export function setBossField(data, si, field, value) {
  const stage = data.stages[si];
  if (isLocked(si) || !isObj(stage) || !isObj(stage.boss)) return false;
  setValue(field, stage.boss, value);
  return true;
}

// ---------- 원본 복원 (백업 = { createdAt, stages:[5개] }) ----------
const backupOk = (backup) => isObj(backup) && Array.isArray(backup.stages) && backup.stages.length >= LOCKED_STAGE_COUNT;
// 기본 스테이지 하나를 백업의 같은 번호로 되돌린다. 잠금 해제 상태에서만. 반환: 성공 여부
export function restoreStage(data, idx, backup) {
  if (!baseUnlocked || !isBaseStage(idx) || !backupOk(backup) || !isObj(backup.stages[idx])) return false;
  data.stages[idx] = clone(backup.stages[idx]);
  return true;
}
export function restoreAllStages(data, backup) {
  if (!baseUnlocked || !backupOk(backup) || LOCKED_STAGE_COUNT === 0) return false;
  for (let i = 0; i < LOCKED_STAGE_COUNT; i++) if (!isObj(backup.stages[i])) return false;
  for (let i = 0; i < LOCKED_STAGE_COUNT; i++) data.stages[i] = clone(backup.stages[i]);
  return true;
}
// 기본 스테이지 중 base와 달라진 번호(0부터) 목록
export function changedBaseStages(data, base) {
  const out = [];
  for (let i = 0; i < LOCKED_STAGE_COUNT; i++) if (!deepEqual(data.stages?.[i], base.stages?.[i])) out.push(i);
  return out;
}

// ---------- JSON 불러오기 규칙 ----------
const deepEqual = (a, b) => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
};
// 불러올 데이터의 잠긴 스테이지(0~LOCKED_STAGE_COUNT-1)가 현재 데이터와 같은가
export function lockedStagesMatch(current, incoming) {
  if (LOCKED_STAGE_COUNT === 0 || baseUnlocked) return true; // 잠금 해제 중에는 1~5가 달라도 허용
  if (!incoming || !Array.isArray(incoming.stages)) return false;
  for (let i = 0; i < LOCKED_STAGE_COUNT; i++) {
    if (!deepEqual(current.stages[i], incoming.stages[i])) return false;
  }
  return true;
}

// ---------- 검증 ----------
// 오류(저장 차단): [{ path, msg }]. 범위는 schema/objectTypes의 필드 정의 = main.js sanitizeData와 같다.
export function validate(data) {
  const errs = [];
  if (!isObj(data)) return [{ path: '', msg: '최상위가 객체여야 합니다' }];
  if (!isObj(data.config)) errs.push({ path: 'config', msg: 'config는 객체여야 합니다' });
  else errs.push(...validateFields(CONFIG_FIELDS, data.config, 'config'));

  if (!Array.isArray(data.enemyTypes) || data.enemyTypes.length < ETYPE_COUNT) {
    errs.push({ path: 'enemyTypes', msg: `enemyTypes는 ${ETYPE_COUNT}개 이상의 배열이어야 합니다` });
  } else {
    for (let i = 0; i < ETYPE_COUNT; i++) {
      const e = data.enemyTypes[i];
      if (!isObj(e)) errs.push({ path: `enemyTypes[${i}]`, msg: `${ETYPE_NAMES[i]}: 객체여야 합니다` });
      else errs.push(...validateFields(ETYPE_FIELDS, e, `enemyTypes[${i}]`).map((x) => ({ ...x, msg: `${ETYPE_NAMES[i]} ${x.msg}` })));
    }
  }

  if (!Array.isArray(data.stages) || data.stages.length === 0) {
    errs.push({ path: 'stages', msg: 'stages는 비어 있지 않은 배열이어야 합니다' });
    return errs;
  }
  if (data.stages.length > MAX_STAGES) errs.push({ path: 'stages', msg: `스테이지는 최대 ${MAX_STAGES}개입니다` });
  const config = isObj(data.config) ? data.config : {};
  data.stages.forEach((s, i) => {
    const p = `stages[${i}]`;
    const n = `스테이지 ${i + 1}`;
    if (!isObj(s)) { errs.push({ path: p, msg: `${n}: 객체여야 합니다` }); return; }
    const add = (list) => errs.push(...list.map((x) => ({ ...x, msg: `${n} ${x.msg}` })));
    add(validateFields(STAGE_FIELDS, s, p));
    if (isObj(s.boss)) add(validateFields(BOSS_FIELDS, s.boss, `${p}.boss`).map((x) => ({ ...x, msg: `보스 ${x.msg}` })));
    else errs.push({ path: `${p}.boss`, msg: `${n}: boss는 객체여야 합니다` });

    for (const type of getTypes()) {
      const { kind, key } = type.storage;
      if (kind === 'flag') {
        if (typeof s[key] !== 'boolean') errs.push({ path: `${p}.${key}`, msg: `${n}: ${key}는 true/false여야 합니다` });
        add(validateFields(type.fields, s, p));
        for (const m of (type.validate ? type.validate(s, s, config) : [])) errs.push({ path: `${p}.${key}`, msg: `${n}: ${m}` });
      } else {
        const arr = s[key];
        if (arr === undefined) continue;
        if (!Array.isArray(arr)) { errs.push({ path: `${p}.${key}`, msg: `${n}: ${key}는 배열이어야 합니다` }); continue; }
        if (arr.length > (type.max ?? Infinity)) errs.push({ path: `${p}.${key}`, msg: `${n}: ${type.label}은(는) 최대 ${type.max}개입니다 (현재 ${arr.length}개)` });
        arr.forEach((o, k) => {
          if (!isObj(o)) { errs.push({ path: `${p}.${key}[${k}]`, msg: `${n}: ${type.label} ${k + 1}: 객체여야 합니다` }); return; }
          add(validateFields(type.fields, o, `${p}.${key}[${k}]`).map((x) => ({ ...x, msg: `${type.label} ${k + 1} ${x.msg}` })));
          for (const m of (type.validate ? type.validate(o, s, config) : [])) errs.push({ path: `${p}.${key}[${k}]`, msg: `${n}: ${type.label} ${k + 1}: ${m}` });
        });
      }
    }
  });
  return errs;
}

// 경고(저장 가능): [{ path, msg }]
export function warnings(data) {
  const out = [];
  if (!isObj(data) || !Array.isArray(data.stages)) return out;
  const config = isObj(data.config) ? data.config : {};
  data.stages.forEach((s, i) => {
    if (!isObj(s)) return;
    const n = `스테이지 ${i + 1}`;
    if (typeof s.runner === 'number' && typeof s.tank === 'number' && s.runner + s.tank > 1 + 1e-9) {
      out.push({ path: `stages[${i}]`, msg: `${n}: 러너+탱커 비율 합이 1을 넘습니다 (탱커가 먼저 배정됨)` });
    }
    for (const type of getTypes()) {
      if (!type.warnings) continue;
      listOf(s, type).forEach((o, k) => {
        for (const m of type.warnings(o, s, config)) out.push({ path: `stages[${i}].${type.storage.key}[${k}]`, msg: `${n}: ${type.label} ${k + 1}: ${m}` });
      });
    }
  });
  return out;
}

// 특정 오브젝트의 경고 여부 (캔버스 경고색)
export function objectWarnings(data, si, typeId, idx) {
  const stage = data.stages[si];
  const type = getType(typeId);
  const obj = stage && type ? listOf(stage, type)[idx] : null;
  return obj && type.warnings ? type.warnings(obj, stage, data.config) : [];
}

export { checkField, getValue, setValue };

// ---------- undo / redo ----------
// 편집 직전 상태를 record(snapshot)로 쌓는다. 드래그는 시작 상태를 한 번만 record하면 한 단계가 된다.
export class History {
  constructor(max = 50) { this.max = max; this.undoStack = []; this.redoStack = []; }
  record(snapshot) {
    this.undoStack.push(clone(snapshot));
    if (this.undoStack.length > this.max) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  discardLast() { this.undoStack.pop(); } // 방금 record한 것을 취소(변경이 실패했을 때)
  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  // 현재 상태를 넘기면 이전 상태를 돌려준다 (없으면 null)
  undo(current) {
    if (!this.undoStack.length) return null;
    this.redoStack.push(clone(current));
    return this.undoStack.pop();
  }
  redo(current) {
    if (!this.redoStack.length) return null;
    this.undoStack.push(clone(current));
    return this.redoStack.pop();
  }
  clear() { this.undoStack.length = 0; this.redoStack.length = 0; }
}

// 직렬화 (저장/내려받기 공통). 알 수 없는 키도 그대로 나간다
export const serialize = (data) => JSON.stringify(data, null, 2) + '\n';
