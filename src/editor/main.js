// 에디터 진입점: 상태(data, 선택, undo), 저장/불러오기, 단축키를 묶는다.
// 개발 서버(서버 저장 모드)와 정적 배포(내려받기 모드) 양쪽에서 동작하며, 모드는 API가 실제로 응답하는지로 판정한다 (env.js).
import fallbackData from '../data/game.json';
import { getTypes, getType } from './objectTypes.js';
import {
  clone, validate, warnings, History, serialize, listOf,
  addObject, removeObject, duplicateObject, applyPatch, editObjectField,
  addStage, duplicateStage, removeStage, moveStage, setStageField, setBossField, setEndlessField, isLocked, isBaseStage, lockedStagesMatch,
  setBaseUnlocked, isBaseUnlocked, LOCKED_STAGE_COUNT, restoreStage, restoreAllStages, changedBaseStages,
  setWaveField, setBossWaveField, addWave, removeWave, resetWaves, prepareForSave,
} from './model.js';
import { setValue } from './fields.js';
import { createView } from './view.js';
import { createPanels } from './panels.js';
import { detectEnvironment, apiUrl, gameUrl } from './env.js';
import { saveWork, clearWork, loadWork, judgeWork, mergeRecovered, hashData } from './autosave.js';

const API = apiUrl(document.baseURI, 'game-data'); // 문서 기준 상대 경로 (하위 경로 배포 대응)
const DRAFT_KEY = 'cannonDefense.draftData';
const $ = (id) => document.getElementById(id);

let data = null;
let savedJSON = '';
let savedData = null; // 마지막 저장/로드본(파싱). 파생 기본값 웨이브를 쓸지 판단하는 기준
let stageIdx = 0;
let sel = null; // { typeId, index } | null
let canSave = false;   // 서버 저장 API가 실제로 동작함
let canBackup = false; // 기본 스테이지 백업을 읽음
let backup = null; // { createdAt, stages } | null (읽지 못함)
let backupReason = '';
let baseHash = '';
let autosavePaused = true; // 복구 여부를 정하기 전에는 자동 저장본을 덮어쓰지 않는다
let issues = { errors: [], warnings: [] };
const history = new History(50);
const NO_SAVE_MSG = '서버가 없어 파일로 저장할 수 없습니다. JSON 내려받기를 사용하세요';
const LOCK_MSG = '기본 스테이지(1~5)는 읽기 전용입니다. 복제해서 수정하세요';

// ---------- 상태 표시 ----------
const statusMsg = (text, kind = '') => {
  const el = $('msg');
  el.textContent = text;
  el.className = kind;
};
// 저장될 내용(prepareForSave: 기본값과 같고 원래 없던 waves/bossWave는 생략)이 저장본과 다를 때만 변경으로 본다
const isDirty = () => !!data && serialize(prepareForSave(data, savedData)) !== savedJSON;

function refreshChrome() {
  issues = { errors: validate(data), warnings: warnings(data) };
  const dirty = isDirty();
  document.title = `${dirty ? '* ' : ''}Cannon Defense 에디터`;
  $('btnSave').textContent = dirty ? '저장 *' : '저장';
  $('btnSave').disabled = !canSave || issues.errors.length > 0;
  $('btnSave').title = !canSave ? NO_SAVE_MSG : issues.errors.length ? '오류를 먼저 고치세요' : '';
  $('btnDownload').classList.toggle('primary', !canSave);
  scheduleAutosave();
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
  hasBackup: () => canBackup && !!backup,
  backupReason: () => backupReason,
  unlockBase() {
    const warn = canBackup ? '' : `[경고] 백업 없음: ${backupReason}. 원본 복원을 쓸 수 없습니다.\n\n`;
    const info = canBackup ? '기본 스테이지 1~5 원본은 backup/base-stages.json에 백업되어 있습니다. ' : '';
    if (!confirm(warn + info + '편집 잠금을 해제할까요?')) return;
    setBaseUnlocked(true);
    afterChange(true);
    statusMsg('기본 스테이지 편집 잠금을 해제했습니다 (새로고침하면 다시 잠김)');
  },
  relockBase() { setBaseUnlocked(false); afterChange(true); statusMsg('기본 스테이지를 다시 잠갔습니다'); },
  restoreBase(all) {
    if (!canBackup || !backup) return;
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
  setEndlessField(field, v) { return setEndlessField(data, stageIdx, field, v); },
  setConfigField(field, v) { setValue(field, data.config, v); },
  setWaveField(k, field, v) { return setWaveField(data, stageIdx, k, field, v); },
  setBossWaveField(field, v) { return setBossWaveField(data, stageIdx, field, v); },
  // 구조가 바뀌는 웨이브 동작(행 추가/삭제/기본값): undo 기록 후 실행, 거부되면 기록 취소
  waveAction(fn, okMsg) {
    history.record(data);
    if (!fn(data, stageIdx)) { history.discardLast(); statusMsg(isLocked(stageIdx) ? LOCK_MSG : '변경할 수 없습니다 (개수 제한)', 'err'); return; }
    afterChange(true);
    if (okMsg) statusMsg(okMsg);
  },
  addWave() { app.waveAction((d, s) => addWave(d, s) >= 0, '웨이브를 추가했습니다'); },
  removeWave(k) { app.waveAction((d, s) => removeWave(d, s, k)); },
  resetWaves() { app.waveAction(resetWaves, '웨이브를 기본값으로 되돌렸습니다'); },
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

// ---------- 자동 임시 저장 (브라우저 localStorage, 파일 아님) ----------
const AUTOSAVE_DELAY = 500;
let autosaveTimer = 0;
let autosaveWarned = false;
function setAutosaveLabel(text, warn = false) {
  const el = $('autosave');
  el.textContent = text;
  el.className = warn ? 'warn' : '';
}
function writeAutosave() {
  autosaveTimer = 0;
  if (!data) return;
  if (!isDirty()) { clearWork(localStorage); setAutosaveLabel(''); return; } // 변경이 없으면 복구할 것도 없다
  const r = saveWork(localStorage, data, baseHash);
  if (r.ok) { setAutosaveLabel(`브라우저 임시 저장됨 · 파일 아님 (${new Date().toLocaleTimeString()})`); return; }
  setAutosaveLabel('임시 저장 실패', true);
  if (!autosaveWarned) { // 상태바 경고는 한 번만 (계속 동작)
    autosaveWarned = true;
    statusMsg(`브라우저 임시 저장 실패 (용량 초과 또는 접근 불가): ${r.error}. 편집은 계속되지만 JSON 내려받기로 보관하세요`, 'err');
  }
}
function scheduleAutosave() {
  if (autosavePaused) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(writeAutosave, AUTOSAVE_DELAY);
}
function flushAutosave() {
  if (!autosaveTimer || autosavePaused) return;
  clearTimeout(autosaveTimer);
  writeAutosave();
}
addEventListener('pagehide', flushAutosave);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAutosave(); });

// 시작 시 이전 작업 복구 안내. 결정 전에는 자동 저장을 멈춰 저장본을 보호한다
function offerRecovery() {
  const w = loadWork(localStorage);
  if (w.status === 'corrupt') statusMsg('손상된 자동 저장본을 무시하고 삭제했습니다');
  const judged = w.status === 'ok' ? judgeWork(w.record, savedData) : null;
  if (!judged || !judged.differs) {
    if (w.status === 'ok') clearWork(localStorage); // 기본 데이터와 같으면 복구할 필요 없음
    autosavePaused = false;
    return;
  }
  const when = new Date(w.record.savedAt);
  const whenText = Number.isNaN(when.getTime()) ? '알 수 없음' : when.toLocaleString();
  $('recoverText').textContent = `이전 작업을 복구할까요? (저장 시각 ${whenText})`
    + (judged.baseChanged ? ' · 그 사이 기본 데이터(game.json)가 바뀌었습니다' : '');
  $('recover').hidden = false;
  const finish = () => { $('recover').hidden = true; autosavePaused = false; };
  $('btnRecover').onclick = () => {
    const { data: merged, excluded } = mergeRecovered(data, w.record.data, isBaseUnlocked());
    history.record(data);
    data = merged;
    stageIdx = Math.min(stageIdx, data.stages.length - 1);
    sel = null;
    finish();
    afterChange(true);
    if (excluded.length) statusMsg(`이전 작업을 복구했습니다. 잠긴 기본 스테이지 ${excluded.map((i) => i + 1).join(', ')}의 변경분은 제외했습니다`);
    else statusMsg('이전 작업을 복구했습니다 (아직 저장되지 않은 상태)', 'ok');
  };
  $('btnDiscard').onclick = () => {
    clearWork(localStorage);
    finish();
    statusMsg('자동 저장본을 버렸습니다');
  };
}

// ---------- 저장 / 불러오기 ----------
async function save() {
  if (issues.errors.length) return;
  const changed = changedBaseStages(data, JSON.parse(savedJSON)); // 서버 파일(마지막 저장/로드본) 대비 바뀐 기본 스테이지
  if (changed.length && !confirm(`기본 스테이지 ${changed.map((i) => i + 1).join(', ')}이(가) 변경됩니다. 백업: backup/base-stages.json`)) return;
  $('btnSave').disabled = true;
  statusMsg('저장 중...');
  try {
    const out = prepareForSave(data, savedData);
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
    savedJSON = serialize(out);
    savedData = out;
    baseHash = hashData(out);
    clearWork(localStorage); // 서버 저장 성공 시에만 자동 저장본 삭제
    setAutosaveLabel('');
    statusMsg('저장 완료. Vite가 game.json 변경을 감지해 열려 있는 게임 탭이 자동 리로드되는 것은 정상입니다.', 'ok');
  } catch (e) {
    statusMsg(`저장 실패: ${e.message}`, 'err');
  }
  refreshChrome();
}
$('btnSave').onclick = save;

$('btnDownload').onclick = () => {
  const url = URL.createObjectURL(new Blob([serialize(prepareForSave(data, savedData))], { type: 'application/json' }));
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
  window.open(gameUrl(document.baseURI, stageIdx + 1), '_blank');
  statusMsg(`임시본으로 스테이지 ${stageIdx + 1} 플레이 테스트를 새 탭에서 열었습니다${issues.errors.length ? ' (오류가 있어 일부 값은 게임이 기본값으로 대체)' : ''}`);
};
$('btnClearDraft').onclick = () => {
  // 자동 저장본(에디터 작업 복구용)과 플레이 테스트 임시본(게임 ?draft=1용)은 따로 묻는다. 어느 쪽도 game.json 파일은 건드리지 않는다
  const cleared = [];
  if (confirm('브라우저 자동 저장본(에디터 작업 복구용)을 지울까요?\n지우면 이 브라우저의 미저장 작업을 복구할 수 없습니다. (game.json 파일은 그대로)')) {
    clearWork(localStorage);
    setAutosaveLabel('');
    cleared.push('자동 저장본');
  }
  if (confirm('플레이 테스트 임시본(게임의 ?draft=1이 읽는 데이터)을 지울까요?')) {
    localStorage.removeItem(DRAFT_KEY);
    cleared.push('플레이 테스트 임시본');
  }
  statusMsg(cleared.length ? `${cleared.join(', ')}을(를) 지웠습니다` : '아무것도 지우지 않았습니다');
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
function setMode() {
  const badge = $('modeBadge');
  badge.className = 'badge ' + (canSave ? 'server' : 'offline');
  badge.textContent = canSave ? '서버 저장 모드' : '내려받기 모드 (이 브라우저에서만 보입니다)';
}
async function init() {
  // 모드 판정은 import.meta.env가 아니라 실제 API 응답으로 한다 (env.js)
  const env = await detectEnvironment((u, o) => fetch(u, o), document.baseURI, LOCKED_STAGE_COUNT);
  canSave = env.canSave;
  canBackup = env.canBackup;
  backup = env.backup;
  backupReason = env.backupReason || '백업을 읽지 못했습니다';
  if (canSave) {
    data = env.data;
    statusMsg('game.json을 불러왔습니다');
  } else {
    data = clone(fallbackData); // 번들된 game.json
    $('banner').hidden = false;
    $('banner').textContent = (import.meta.env.DEV
      ? `개발 서버의 저장 API에 연결하지 못했습니다 (npm run dev, 포트 5737 확인). (${env.saveReason}) `
      : '정적 배포본이라 서버 저장이 없습니다. ')
      + '번들된 game.json을 기본 데이터로 열었고, 편집 내용은 JSON 내려받기로 보관하세요. 수정한 파일을 src/data/game.json에 넣고 다시 빌드해야 게임에 반영됩니다.';
  }
  setMode();
  savedJSON = serialize(data);
  savedData = JSON.parse(savedJSON);
  baseHash = hashData(savedData);
  refreshChrome();
  panels.renderAll();
  view.resize();
  offerRecovery();
}
init();
