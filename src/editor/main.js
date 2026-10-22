// 에디터 진입점: 상태(data, 선택, undo), 저장/불러오기, 단축키를 묶는다. 개발 서버 전용 도구.
import fallbackData from '../data/game.json';
import { getTypes, getType } from './objectTypes.js';
import {
  clone, validate, warnings, History, serialize, listOf,
  addObject, removeObject, duplicateObject, applyPatch, editObjectField,
  addStage, duplicateStage, removeStage, moveStage, setStageField, setBossField, isLocked, isBaseStage, lockedStagesMatch,
  setBaseUnlocked, restoreStage, restoreAllStages, changedBaseStages,
} from './model.js';
import { setValue } from './fields.js';
import { createView } from './view.js';
import { createPanels } from './panels.js';

const API = '/api/game-data';
const BACKUP_API = '/api/stage-backup';
const DRAFT_KEY = 'cannonDefense.draftData';
const $ = (id) => document.getElementById(id);

let data = null;
let savedJSON = '';
let stageIdx = 0;
let sel = null; // { typeId, index } | null
let serverOk = false;
let backup = null; // { createdAt, stages } | null (읽지 못함)
let issues = { errors: [], warnings: [] };
const history = new History(50);
const LOCK_MSG = '기본 스테이지(1~5)는 읽기 전용입니다. 복제해서 수정하세요';

// ---------- 상태 표시 ----------
const statusMsg = (text, kind = '') => {
  const el = $('msg');
  el.textContent = text;
  el.className = kind;
};
const isDirty = () => !!data && serialize(data) !== savedJSON;

function refreshChrome() {
  issues = { errors: validate(data), warnings: warnings(data) };
  const dirty = isDirty();
  document.title = `${dirty ? '* ' : ''}Cannon Defense 에디터`;
  $('btnSave').textContent = dirty ? '저장 *' : '저장';
  $('btnSave').disabled = !serverOk || issues.errors.length > 0;
  $('btnSave').title = !serverOk ? '개발 서버가 필요합니다 (읽기 전용)' : issues.errors.length ? '오류를 먼저 고치세요' : '';
  $('btnUndo').disabled = !history.canUndo();
  $('btnRedo').disabled = !history.canRedo();
}

// ---------- 선택 유효성 ----------
function fixSelection() {
  if (!sel) return false;
  const type = getType(sel.typeId);
  if (type && listOf(data.stages[stageIdx], type)[sel.index]) return false;
  sel = null;
  return true;
}

let panels, view;
function afterChange(structural = false) {
  if (fixSelection()) structural = true;
  refreshChrome();
  if (structural) panels.renderAll();
  else panels.sync();
  view.draw();
}

// ---------- 앱 인터페이스 (view / panels가 호출) ----------
const app = {
  getData: () => data,
  getStageIdx: () => stageIdx,
  getSel: () => sel,
  getIssues: () => issues,
  select(s) { sel = s; afterChange(true); },
  setStageIdx(i) { stageIdx = i; sel = null; afterChange(true); },

  // 연속 입력/드래그를 undo 한 단계로 묶기
  beginEdit() { history.record(data); },
  cancelEdit() { history.discardLast(); },
  hasBackup: () => !!backup,
  unlockBase() {
    const warn = backup ? '' : '[경고] 백업 없음: backup/base-stages.json을 읽지 못했습니다. 원본 복원을 쓸 수 없습니다.\n\n';
    if (!confirm(warn + '기본 스테이지 1~5 원본은 backup/base-stages.json에 백업되어 있습니다. 편집 잠금을 해제할까요?')) return;
    setBaseUnlocked(true);
    afterChange(true);
    statusMsg('기본 스테이지 편집 잠금을 해제했습니다 (새로고침하면 다시 잠김)');
  },
  relockBase() { setBaseUnlocked(false); afterChange(true); statusMsg('기본 스테이지를 다시 잠갔습니다'); },
  restoreBase(all) {
    if (!backup) return;
    const label = all ? '기본 스테이지 1~5 모두' : `스테이지 ${stageIdx + 1}`;
    if (!confirm(`${label}를 백업 원본으로 되돌릴까요? (되돌리기로 취소 가능, 저장해야 파일에 반영됩니다)`)) return;
    history.record(data);
    const ok = all ? restoreAllStages(data, backup) : restoreStage(data, stageIdx, backup);
    if (!ok) { history.discardLast(); statusMsg('복원할 수 없습니다', 'err'); return; }
    afterChange(true);
    statusMsg(`${label}를 원본으로 복원했습니다. 저장해야 game.json에 반영됩니다`, 'ok');
  },
  endEdit() { refreshChrome(); },
  dragStart() { if (!isLocked(stageIdx)) history.record(data); },
  dragEnd() { afterChange(false); },
  // fn이 false를 돌려주면 변경이 거부된 것 (잠긴 스테이지). 호출한 쪽이 undo 기록을 취소한다
  mutate(fn) { const ok = fn(data); afterChange(false); return ok; },

  patch(typeId, idx, p) { if (applyPatch(data, stageIdx, typeId, idx, p)) afterChange(false); },
  mouse(x, z) { $('coord').textContent = x === null ? 'x, z: -' : `x ${x.toFixed(2)}, z ${z.toFixed(2)}`; },

  editObjectField(typeId, idx, field, v) { return editObjectField(data, stageIdx, typeId, idx, field, v); },
  setStageField(field, v) { return setStageField(data, stageIdx, field, v); },
  setBossField(field, v) { return setBossField(data, stageIdx, field, v); },
  setConfigField(field, v) { setValue(field, data.config, v); },
  setEtypeField(ri, field, v) { setValue(field, data.enemyTypes[ri], v); },

  addObject(typeId) {
    const type = getType(typeId);
    history.record(data);
    const idx = addObject(data, stageIdx, typeId);
    if (idx < 0) { history.discardLast(); statusMsg(isLocked(stageIdx) ? LOCK_MSG : '추가할 수 없습니다', 'err'); return; }
    sel = { typeId, index: idx };
    afterChange(true);
    statusMsg(`${type.label} 추가됨`);
  },
  removeSelected() {
    if (!sel) return;
    history.record(data);
    if (!removeObject(data, stageIdx, sel.typeId, sel.index)) {
      history.discardLast();
      if (isLocked(stageIdx)) statusMsg(LOCK_MSG, 'err');
      return;
    }
    sel = null;
    afterChange(true);
  },
  duplicateSelected() {
    if (!sel) return;
    history.record(data);
    const idx = duplicateObject(data, stageIdx, sel.typeId, sel.index);
    if (idx < 0) { history.discardLast(); statusMsg(isLocked(stageIdx) ? LOCK_MSG : '복제할 수 없습니다 (개수 제한)', 'err'); return; }
    sel = { typeId: sel.typeId, index: idx };
    afterChange(true);
  },
  stageAction(key) {
    if (key === 'del' && isBaseStage(stageIdx)) { statusMsg('기본 스테이지(1~5)는 삭제할 수 없습니다', 'err'); return; }
    if (key === 'del' && !confirm(`스테이지 ${stageIdx + 1}을(를) 삭제할까요?`)) return;
    history.record(data);
    let ni = -1;
    if (key === 'add') ni = addStage(data, stageIdx);
    else if (key === 'dup') ni = duplicateStage(data, stageIdx);
    else if (key === 'del') ni = removeStage(data, stageIdx) ? Math.min(stageIdx, data.stages.length - 1) : -1;
    else if (key === 'up') ni = moveStage(data, stageIdx, -1);
    else if (key === 'down') ni = moveStage(data, stageIdx, 1);
    if (ni < 0) { history.discardLast(); return; }
    stageIdx = ni; sel = null; // add/dup은 맨 뒤에 추가된 새 스테이지를 선택
    if (key === 'add' || key === 'dup') statusMsg(`스테이지 ${ni + 1}로 복제했습니다`);
    afterChange(true);
  },
};

view = createView($('canvas'), app);
panels = createPanels({
  stages: $('secStages'), add: $('secAdd'), sel: $('secSel'), stage: $('secStage'),
  config: $('secConfig'), etypes: $('secEtypes'), issues: $('secIssues'),
}, app);

// ---------- undo / redo ----------
function restore(d) {
  if (!d) return;
  data = d;
  stageIdx = Math.min(stageIdx, data.stages.length - 1);
  afterChange(true);
}
const undo = () => restore(history.undo(data));
const redo = () => restore(history.redo(data));
$('btnUndo').onclick = undo;
$('btnRedo').onclick = redo;

// ---------- 저장 / 불러오기 ----------
async function save() {
  if (issues.errors.length) return;
  const changed = changedBaseStages(data, JSON.parse(savedJSON)); // 서버 파일(마지막 저장/로드본) 대비 바뀐 기본 스테이지
  if (changed.length && !confirm(`기본 스테이지 ${changed.map((i) => i + 1).join(', ')}이(가) 변경됩니다. 백업: backup/base-stages.json`)) return;
  $('btnSave').disabled = true;
  statusMsg('저장 중...');
  try {
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
    savedJSON = serialize(data);
    statusMsg('저장 완료. Vite가 game.json 변경을 감지해 열려 있는 게임 탭이 자동 리로드되는 것은 정상입니다.', 'ok');
  } catch (e) {
    statusMsg(`저장 실패: ${e.message}`, 'err');
  }
  refreshChrome();
}
$('btnSave').onclick = save;

$('btnDownload').onclick = () => {
  const url = URL.createObjectURL(new Blob([serialize(data)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'game.json';
  a.click();
  URL.revokeObjectURL(url);
};

$('btnImport').onclick = () => $('fileInput').click();
$('fileInput').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const errs = validate(parsed);
    if (errs.length) {
      statusMsg(`불러오기 실패: 오류 ${errs.length}건 (예: ${errs[0].msg})`, 'err');
      return;
    }
    if (!lockedStagesMatch(data, parsed)) {
      statusMsg('불러오기 실패: 기본 스테이지(1~5)는 변경할 수 없습니다', 'err');
      return;
    }
    history.record(data);
    data = parsed;
    stageIdx = 0; sel = null;
    afterChange(true);
    statusMsg('JSON을 불러왔습니다 (저장하기 전까지 게임에는 적용되지 않음)', 'ok');
  } catch (err) {
    statusMsg(`불러오기 실패: ${err.message}`, 'err');
  }
};

$('btnPlay').onclick = () => {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  } catch (e) {
    statusMsg(`임시본 저장 실패: ${e.message}`, 'err');
    return;
  }
  window.open(`/?draft=1&stage=${stageIdx + 1}`, '_blank');
  statusMsg(`임시본으로 스테이지 ${stageIdx + 1} 플레이 테스트를 새 탭에서 열었습니다${issues.errors.length ? ' (오류가 있어 일부 값은 게임이 기본값으로 대체)' : ''}`);
};
$('btnClearDraft').onclick = () => {
  localStorage.removeItem(DRAFT_KEY);
  statusMsg('임시본(localStorage)을 지웠습니다');
};

// ---------- 단축키 ----------
const inField = (t) => t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !inField(e.target)) {
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; }
    if (k === 's') { e.preventDefault(); save(); return; }
  }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  if (inField(e.target) || mod || e.altKey || !sel) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); app.removeSelected(); return; }
  const d = { ArrowLeft: [-0.5, 0], ArrowRight: [0.5, 0], ArrowUp: [0, -0.5], ArrowDown: [0, 0.5] }[e.key];
  if (!d) return;
  e.preventDefault();
  const type = getType(sel.typeId);
  const obj = listOf(data.stages[stageIdx], type)[sel.index];
  const patch = type.nudge && obj ? type.nudge(obj, d[0], d[1], { config: data.config, stage: data.stages[stageIdx] }) : null;
  if (!patch) return;
  history.record(data);
  if (!applyPatch(data, stageIdx, sel.typeId, sel.index, patch)) { history.discardLast(); return; }
  afterChange(false);
});

addEventListener('beforeunload', (e) => {
  if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
});

// ---------- 시작 ----------
async function init() {
  try {
    const res = await fetch(API, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
    serverOk = true;
    statusMsg('game.json을 불러왔습니다');
    try {
      const br = await fetch(BACKUP_API, { cache: 'no-store' });
      if (br.ok) backup = await br.json();
    } catch { /* 백업 없음: 복원 비활성 */ }
  } catch (e) {
    data = clone(fallbackData);
    serverOk = false;
    $('banner').hidden = false;
    $('banner').textContent = `개발 서버가 필요합니다 (npm run dev, 포트 5737). 번들된 JSON으로 읽기 전용 편집 중이라 저장은 불가하고 JSON 내려받기만 가능합니다. (${e.message})`;
  }
  savedJSON = serialize(data);
  refreshChrome();
  panels.renderAll();
  view.resize();
}
init();
