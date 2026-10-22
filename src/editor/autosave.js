// 에디터 자동 임시 저장 / 복구 (DOM 없음, Node에서 테스트 가능). storage는 localStorage 호환 객체를 주입받는다.
// 저장 형태: { savedAt: ISO 문자열, baseHash: 기본 데이터 해시, data: 편집 중인 전체 데이터 }
// 게임의 플레이 테스트 임시본(cannonDefense.draftData)과는 별개의 키다.
import { clone, serialize, prepareForSave, canonicalStage, LOCKED_STAGE_COUNT } from './model.js';

export const WORK_KEY = 'cannonDefense.editorWork';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const deepEqual = (a, b) => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
};

// 복구 가능한 최소 구조 (서버 저장 검증과 같은 수준)
export const isWorkable = (d) => isObj(d) && isObj(d.config) && Array.isArray(d.enemyTypes) && Array.isArray(d.stages) && d.stages.length > 0;

// 간단한 문자열 해시 (djb2). 기본 데이터가 바뀌었는지 알리는 용도라 충돌 방어는 필요 없다
export function hashString(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
export const hashData = (data) => hashString(serialize(data));

/** 저장. 반환: { ok: true } | { ok: false, error } (용량 초과/접근 불가도 예외 없이 반환) */
export function saveWork(storage, data, baseHash, now = new Date()) {
  try {
    storage.setItem(WORK_KEY, JSON.stringify({ savedAt: now.toISOString(), baseHash, data }));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export function clearWork(storage) {
  try { storage.removeItem(WORK_KEY); return true; } catch { return false; }
}

/**
 * 읽기. 반환: { status: 'none' } | { status: 'corrupt' } | { status: 'ok', record }
 * 파싱 실패/구조 불량이면 저장본을 삭제하고 'corrupt'를 돌려준다.
 */
export function loadWork(storage) {
  let text;
  try { text = storage.getItem(WORK_KEY); } catch { return { status: 'none' }; }
  if (text == null) return { status: 'none' };
  let rec;
  try { rec = JSON.parse(text); } catch { rec = null; }
  if (!isObj(rec) || !isWorkable(rec.data)) {
    clearWork(storage);
    return { status: 'corrupt' };
  }
  return { status: 'ok', record: rec };
}

/**
 * 기본(저장/로드된) 데이터 base와 비교해 복구할 가치가 있는지 판정한다.
 * 웨이브 파생 기본값 정규화(prepareForSave)를 거쳐 비교하므로 "건드리지 않은" 상태는 같다고 본다.
 * 반환: { differs, baseChanged } (baseChanged: 저장 당시와 기본 데이터가 달라졌는지)
 */
export function judgeWork(record, base) {
  const differs = !deepEqual(prepareForSave(record.data, base), base);
  const baseChanged = typeof record.baseHash === 'string' && record.baseHash !== hashData(base);
  return { differs, baseChanged };
}

/**
 * 복구본 만들기. 잠금과의 충돌 처리: 잠긴 상태(unlocked=false)에서는 기본 스테이지 1~5를 현재 데이터(base)로 유지하고
 * 나머지(스테이지 6 이후, config, enemyTypes 등)만 복구한다. 잠금을 몰래 우회하지 않기 위한 안전한 쪽의 선택이다.
 * 반환: { data, excluded: 복구에서 제외된 기본 스테이지 번호(0부터) }
 */
export function mergeRecovered(current, savedData, unlocked = false) {
  const data = clone(savedData);
  const excluded = [];
  if (unlocked || LOCKED_STAGE_COUNT === 0) return { data, excluded };
  for (let i = 0; i < LOCKED_STAGE_COUNT; i++) {
    const a = canonicalStage(current.stages[i], i, current.config);
    const b = canonicalStage(data.stages[i], i, data.config);
    if (!deepEqual(a, b)) { data.stages[i] = clone(current.stages[i]); excluded.push(i); }
  }
  return { data, excluded };
}
