// 속성 패널 / 스테이지 탭 / 툴바: 전부 필드 정의 배열과 오브젝트 타입 레지스트리에서 자동 생성한다.
// 오브젝트 종류는 모른다 (getTypes()를 순회).
import { getTypes, getType } from './objectTypes.js';
import {
  listOf, canAdd, checkField, getValue, MAX_STAGES, isLocked, isBaseStage, isBaseUnlocked, canMoveStage,
  effectiveWaves, effectiveBossWave, waveSummary,
} from './model.js';
import { STAGE_FIELDS, BOSS_FIELDS, CONFIG_FIELDS, ETYPE_FIELDS, ETYPE_NAMES, BOSSWAVE_FIELDS, WAVE_LIST } from './schema.js';

const h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue; // null이면 속성을 붙이지 않는다 (disabled: null이 비활성이 되는 것 방지)
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of kids) if (c) e.append(c);
  return e;
};

function numberEl(f) {
  const e = h('input', { type: 'number' });
  e.step = f.step ?? (f.int ? 1 : 'any');
  if (f.min !== undefined) e.min = f.min;
  if (f.max !== undefined) e.max = f.max;
  return e;
}
const parseNum = (e) => (e.value === '' ? NaN : Number(e.value));

// 필드 하나의 입력 위젯. { el, set(v), get(), mark(msg), contains(node) }
export function makeInput(f, onInput) {
  let el, get, set;
  switch (f.type) {
    case 'number':
      el = numberEl(f);
      get = () => parseNum(el);
      set = (v) => { el.value = Number.isFinite(v) ? String(v) : ''; };
      el.addEventListener('input', () => onInput(get()));
      break;
    case 'numlist': {
      el = h('div', { class: 'numlist' });
      const ins = Array.from({ length: f.length }, () => numberEl(f));
      ins.forEach((i) => { i.addEventListener('input', () => onInput(get())); el.append(i); });
      get = () => ins.map(parseNum);
      set = (v) => ins.forEach((i, k) => { i.value = Array.isArray(v) && Number.isFinite(v[k]) ? String(v[k]) : ''; });
      break;
    }
    case 'select':
      el = h('select');
      f.options.forEach((o, i) => el.append(h('option', { value: String(i), text: o.label })));
      get = () => f.options[el.selectedIndex].value;
      set = (v) => { const i = f.options.findIndex((o) => o.value === v); el.selectedIndex = i; };
      el.addEventListener('input', () => onInput(get()));
      break;
    case 'checkbox':
      el = h('input', { type: 'checkbox' });
      get = () => el.checked;
      set = (v) => { el.checked = v === true; };
      el.addEventListener('input', () => onInput(get()));
      break;
    case 'color':
      el = h('input', { type: 'color' });
      get = () => el.value;
      set = (v) => { el.value = typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#000000'; };
      el.addEventListener('input', () => onInput(get()));
      break;
    case 'note':
      el = h('div', { class: 'note' });
      get = () => null;
      set = (v) => { el.textContent = v ?? ''; };
      break;
    default: // text
      el = f.multiline ? h('textarea', { rows: '4' }) : h('input', { type: 'text' });
      get = () => el.value;
      set = (v) => { el.value = typeof v === 'string' ? v : ''; };
      el.addEventListener('input', () => onInput(get()));
  }
  const mark = (msg) => {
    el.classList.toggle('bad', !!msg);
    el.title = msg || '';
    el.querySelectorAll?.('input').forEach((i) => i.classList.toggle('bad', !!msg));
  };
  // 읽기 전용 표시: 속성(attribute)이 아니라 boolean 프로퍼티로 설정 (false가 확실히 해제되도록)
  const setDisabled = (b) => {
    const on = !!b;
    if (el.tagName === 'DIV') el.querySelectorAll('input,select,textarea').forEach((i) => { i.disabled = on; });
    else el.disabled = on;
  };
  return { el, get, set, mark, setDisabled, contains: (n) => el === n || el.contains(n) };
}

/**
 * 폼 자동 생성.
 *  getObj(): 현재 대상 객체 (데이터가 undo 등으로 교체돼도 항상 최신을 읽도록 함수로 받는다)
 *  opts.onInput(field, value): 값 변경 알림 / opts.noteCtx(): note 필드용 컨텍스트 / opts.readOnly(): true면 입력 전부 disabled
 * 반환 { el, sync() }
 */
export function buildForm(fields, getObj, opts) {
  const el = h('div', { class: 'form' });
  const widgets = fields.map((f) => {
    const w = makeInput(f, (v) => opts.onInput(f, v));
    const row = h('label', { class: 'row' + (f.type === 'note' ? ' noterow' : '') },
      f.type === 'note' ? null : h('span', { class: 'lbl', text: f.label }), w.el);
    el.append(row);
    return w;
  });
  const sync = () => {
    const obj = getObj();
    if (!obj) return;
    const ro = !!(opts.readOnly && opts.readOnly());
    fields.forEach((f, i) => {
      const w = widgets[i];
      w.setDisabled(ro);
      if (f.type === 'note') { w.set(f.text(obj, opts.noteCtx ? opts.noteCtx() : {})); return; }
      const v = getValue(f, obj);
      if (!w.contains(document.activeElement)) w.set(v);
      w.mark(checkField(f, v, obj));
    });
  };
  sync();
  return { el, sync };
}

// 표 자동 생성 (행 = 객체, 열 = 필드)
export function buildTable(fields, getRows, rowNames, opts) {
  const el = h('table', { class: 'etable' });
  el.append(h('thead', {}, h('tr', {}, h('th'), ...fields.map((f) => h('th', { text: f.label })))));
  const body = h('tbody');
  const grid = getRows().map((_, ri) => {
    const tr = h('tr', {}, h('th', { text: rowNames[ri] }));
    const ws = fields.map((f) => {
      const w = makeInput(f, (v) => opts.onInput(ri, f, v));
      tr.append(h('td', {}, w.el));
      return w;
    });
    body.append(tr);
    return ws;
  });
  el.append(body);
  const sync = () => {
    const ro = !!(opts.readOnly && opts.readOnly());
    getRows().forEach((row, ri) => fields.forEach((f, fi) => {
      const w = grid[ri][fi];
      w.setDisabled(ro);
      const v = getValue(f, row);
      if (!w.contains(document.activeElement)) w.set(v);
      w.mark(checkField(f, v, row));
    }));
  };
  sync();
  return { el, sync };
}

/**
 * 리스트 폼 자동 생성 (행 목록: 행마다 itemFields 입력 + 삭제 버튼, 아래에 추가 버튼). 정의 형식은 fields.js 맨 위 주석.
 *  getItems(): 현재 행 배열 / opts.onInput(ri, field, v), opts.onAdd(), opts.onRemove(ri), opts.readOnly()
 * 행 개수가 바뀌면 호출한 쪽이 폼을 다시 만들어야 한다(행은 만들 때의 개수로 고정). 반환 { el, sync }
 */
export function buildListForm(def, getItems, opts) {
  const el = h('div', { class: 'listform' });
  const table = h('table', { class: 'etable' });
  table.append(h('thead', {}, h('tr', {}, h('th'), ...def.itemFields.map((f) => h('th', { text: f.label })), h('th'))));
  const body = h('tbody');
  const rows = getItems().map((_, ri) => {
    const tr = h('tr', {}, h('th', { text: def.itemLabel(ri) }));
    const ws = def.itemFields.map((f) => {
      const w = makeInput(f, (v) => opts.onInput(ri, f, v));
      tr.append(h('td', {}, w.el));
      return w;
    });
    const del = h('button', { text: '삭제', title: '이 행 삭제', onclick: () => opts.onRemove(ri) });
    tr.append(h('td', {}, del));
    body.append(tr);
    return { ws, del };
  });
  table.append(body);
  const addBtn = h('button', { text: def.addLabel || '추가', onclick: () => opts.onAdd() });
  el.append(h('div', { class: 'tablewrap' }, table), h('div', { class: 'btnbar' }, addBtn));
  const sync = () => {
    const items = getItems();
    const ro = !!(opts.readOnly && opts.readOnly());
    rows.forEach((r, ri) => {
      const item = items[ri];
      if (!item) return;
      def.itemFields.forEach((f, fi) => {
        const w = r.ws[fi];
        w.setDisabled(ro);
        const v = getValue(f, item);
        if (!w.contains(document.activeElement)) w.set(v);
        w.mark(checkField(f, v, item));
      });
      r.del.disabled = ro || items.length <= def.min;
      r.del.title = ro ? '읽기 전용' : items.length <= def.min ? `최소 ${def.min}개는 있어야 합니다` : '이 행 삭제';
    });
    addBtn.disabled = ro || items.length >= def.max;
    addBtn.title = ro ? '읽기 전용' : items.length >= def.max ? `최대 ${def.max}개까지 추가할 수 있습니다` : '';
  };
  sync();
  return { el, sync };
}

/**
 * 패널 전체. els = { stages, add, sel, stage, config, etypes, issues } (각각 컨테이너 요소)
 * app = main.js가 주는 동작 모음 (getData/getStageIdx/getSel/select/beginEdit/endEdit/mutate/...)
 */
export function createPanels(els, app) {
  let forms = []; // sync 대상
  let issuesBox = null;

  // 입력 세션: 포커스를 잃거나 change가 올 때까지의 연속 입력을 undo 한 단계로 묶는다
  let session = false;
  // fn이 false를 돌려주면(잠긴 스테이지 등 모델이 거부) 이 입력 때문에 시작한 undo 기록은 취소한다
  const edit = (fn) => {
    const started = !session;
    if (started) { app.beginEdit(); session = true; }
    if (app.mutate(fn) === false && started) { app.cancelEdit(); session = false; }
  };
  document.addEventListener('change', () => { session = false; app.endEdit(); }, true);

  const stageOf = () => app.getData().stages[app.getStageIdx()];
  const locked = () => isLocked(app.getStageIdx());

  function renderStages() {
    const box = els.stages;
    box.replaceChildren();
    const data = app.getData();
    const tabs = h('div', { class: 'tabs' });
    data.stages.forEach((_, i) => tabs.append(h('button', {
      class: 'tab' + (i === app.getStageIdx() ? ' cur' : ''), text: (isLocked(i) ? '🔒' : isBaseStage(i) ? '🔓' : '') + String(i + 1),
      title: `스테이지 ${i + 1}${isLocked(i) ? ' (기본 스테이지: 읽기 전용)' : isBaseStage(i) ? ' (기본 스테이지: 잠금 해제됨)' : ''}`,
      onclick: () => app.setStageIdx(i),
    })));
    const n = data.stages.length;
    const act = (text, key, disabled, title) => h('button', { text, title, disabled: disabled ? '' : null, onclick: () => app.stageAction(key) });
    const cur = app.getStageIdx();
    const bar = h('div', { class: 'btnbar' },
      act('+ 추가', 'add', n >= MAX_STAGES, `현재 스테이지를 복제해 맨 뒤에 추가 (최대 ${MAX_STAGES}개)`),
      act('복제', 'dup', n >= MAX_STAGES, '현재 스테이지를 복제해 맨 뒤에 추가'),
      act('삭제', 'del', n <= 1 || isBaseStage(cur), isBaseStage(cur) ? '기본 스테이지는 삭제할 수 없습니다' : '현재 스테이지 삭제 (최소 1개 유지)'),
      act('▲', 'up', !canMoveStage(data, cur, -1), '앞으로 이동'),
      act('▼', 'down', !canMoveStage(data, cur, 1), '뒤로 이동'));
    box.append(h('h3', { text: '스테이지' }), tabs, bar);
    if (isLocked(cur)) {
      box.append(h('div', { class: 'lockbox' },
        h('div', { text: '기본 스테이지 1~5는 읽기 전용입니다. 복제해서 수정하세요.' }),
        h('button', {
          text: '복제해서 편집', disabled: n >= MAX_STAGES ? '' : null,
          title: n >= MAX_STAGES ? `스테이지는 최대 ${MAX_STAGES}개입니다` : '맨 뒤에 복제하고 선택',
          onclick: () => app.stageAction('dup'),
        }),
        h('button', {
          class: 'danger', text: '🔓 편집 잠금 해제', title: '기본 스테이지를 직접 편집합니다 (원본은 백업되어 있음, 이 세션에서만 유지)',
          onclick: () => app.unlockBase(),
        })));
    } else if (isBaseUnlocked()) {
      const canRestore = app.hasBackup();
      box.append(h('div', { class: 'lockbox open' },
        h('div', { text: '⚠ 기본 스테이지 편집 중 (잠금 해제됨)' }),
        h('div', { class: 'btnbar' },
          h('button', { text: '다시 잠그기', onclick: () => app.relockBase() }),
          h('button', {
            text: '원본으로 복원', disabled: canRestore && isBaseStage(cur) ? null : '',
            title: !canRestore ? `복원할 수 없습니다: ${app.backupReason()}` : isBaseStage(cur) ? '현재 스테이지를 백업 원본으로 되돌립니다 (undo 가능)' : '기본 스테이지(1~5)를 선택하세요',
            onclick: () => app.restoreBase(false),
          }),
          h('button', {
            text: '1~5 모두 복원', disabled: canRestore ? null : '',
            title: canRestore ? '기본 스테이지 1~5를 모두 백업 원본으로 되돌립니다 (undo 가능)' : `복원할 수 없습니다: ${app.backupReason()}`,
            onclick: () => app.restoreBase(true),
          })),
        h('div', { class: 'hint', text: '복원 후 저장해야 game.json에 반영됩니다. 삭제와 순서 이동은 계속 막혀 있습니다.' }),
        canRestore ? null : h('div', { class: 'hint wrn', text: `백업을 쓸 수 없어 복원이 비활성입니다 (${app.backupReason()})` })));
    }
    if (n > 5) box.append(h('div', { class: 'warnbox', text: '스테이지가 6개 이상입니다. 게임의 숫자 키 선택(1~5)은 일부만 지원합니다 (화면의 번호 버튼은 모두 동작).' }));
  }

  function renderAdd() {
    const box = els.add;
    box.replaceChildren(h('h3', { text: '오브젝트 추가' }));
    const bar = h('div', { class: 'btnbar' });
    const stage = stageOf();
    for (const type of getTypes()) {
      const c = canAdd(stage, type);
      const off = locked() || !c.ok;
      bar.append(h('button', {
        text: type.addLabel || `${type.label} 추가`, title: locked() ? '기본 스테이지는 읽기 전용입니다' : c.ok ? '' : c.reason,
        disabled: off ? '' : null, onclick: () => app.addObject(type.id),
      }));
      if (!locked() && !c.ok && type.storage.kind === 'array') bar.append(h('div', { class: 'hint', text: c.reason }));
    }
    box.append(bar);
  }

  function renderSel() {
    const box = els.sel;
    box.replaceChildren();
    const sel = app.getSel();
    const type = sel && getType(sel.typeId);
    const stage = stageOf();
    if (!type || !listOf(stage, type)[sel.index]) {
      box.append(h('h3', { text: '선택 항목' }), h('div', { class: 'hint', text: '캔버스에서 오브젝트를 클릭하세요.' }));
      return;
    }
    const obj = () => listOf(stageOf(), type)[sel.index];
    const label = type.describe ? type.describe(obj(), stage, app.getData().config) : type.label;
    const bar = h('div', { class: 'btnbar' },
      type.storage.kind === 'array' ? h('button', { text: '복제', disabled: locked() ? '' : null, onclick: () => app.duplicateSelected() }) : null,
      h('button', { text: type.storage.kind === 'flag' ? '끄기(제거)' : '삭제 (Del)', disabled: locked() ? '' : null, onclick: () => app.removeSelected() }));
    box.append(h('h3', { text: `선택: ${type.label} · ${label}` }), bar);
    const noteCtx = () => ({ config: app.getData().config });
    const f = buildForm(type.fields, obj, {
      noteCtx, readOnly: locked,
      onInput: (field, v) => edit(() => app.editObjectField(sel.typeId, sel.index, field, v)),
    });
    forms.push(f);
    box.append(f.el);
    for (const t of (type.notes ? type.notes(obj(), stage, app.getData().config) : [])) box.append(h('div', { class: 'hint', text: t }));
  }

  function renderStageForm() {
    const box = els.stage;
    box.replaceChildren(h('h3', { text: '스테이지 설정' }));
    // 플래그형 오브젝트(켜기/끄기)는 레지스트리에서 체크박스를 자동 생성
    const flagFields = getTypes().filter((t) => t.storage.kind === 'flag').map((t) => ({
      name: t.storage.key, label: t.label, type: 'checkbox',
    }));
    const fields = [...STAGE_FIELDS, ...flagFields];
    const f = buildForm(fields, stageOf, {
      readOnly: locked,
      onInput: (field, v) => edit(() => app.setStageField(field, v)),
    });
    forms.push(f);
    box.append(f.el, h('h4', { text: '보스' }));
    const bf = buildForm(BOSS_FIELDS, () => stageOf().boss, {
      readOnly: locked,
      onInput: (field, v) => edit(() => app.setBossField(field, v)),
    });
    forms.push(bf);
    box.append(bf.el, h('div', { class: 'hint', text: '보스 스폰 위치(x=0, z=SPAWN_Z-1)는 코드 고정이라 편집할 수 없습니다.' }));
    renderWaves(box);
  }

  // 웨이브 섹션: 일반 웨이브 리스트 + 보스 웨이브 행 + 요약. waves/bossWave가 없으면 파생 기본값이 보이고, 편집하면 그때 데이터에 채워진다
  function renderWaves(box) {
    const data = () => app.getData();
    const si = () => app.getStageIdx();
    box.append(h('h4', {}, '웨이브 ', h('span', { class: 'tag', text: '러너/탱커를 비우면 스테이지 비율' })));
    const wl = buildListForm(WAVE_LIST, () => effectiveWaves(data(), si()), {
      readOnly: locked,
      onInput: (ri, field, v) => edit(() => app.setWaveField(ri, field, v)),
      onAdd: () => app.addWave(),
      onRemove: (ri) => app.removeWave(ri),
    });
    forms.push(wl);
    box.append(wl.el, h('h4', { text: '보스 웨이브 (보스 처치까지 계속)' }));
    const bw = buildTable(BOSSWAVE_FIELDS, () => [effectiveBossWave(data(), si())], ['보스 웨이브'], {
      readOnly: locked,
      onInput: (ri, field, v) => edit(() => app.setBossWaveField(field, v)),
    });
    forms.push(bw);
    const sum = h('div', { class: 'hint' });
    const summary = {
      sync: () => {
        const s = waveSummary(data(), si());
        const rate = (r) => (Math.round(r * 100) / 100).toString();
        sum.textContent = `일반 웨이브 총 ${s.totalSec}초, 예상 생성 적 수 ${s.totalEnemies}마리 (보스 웨이브 제외)\n`
          + `초당 생성 수: ${s.perWave.map((w, k) => `웨이브 ${k + 1} ${rate(w.rate)}`).join(' / ')} / 보스 웨이브 ${rate(s.bossRate)}`;
        sum.style.whiteSpace = 'pre-line';
      },
    };
    summary.sync();
    forms.push(summary);
    box.append(h('div', { class: 'tablewrap' }, bw.el), sum, h('div', { class: 'btnbar' }, h('button', {
      text: '웨이브 기본값으로', disabled: locked() ? '' : null,
      title: locked() ? '기본 스테이지는 읽기 전용입니다' : '이 스테이지의 waves / bossWave를 지우고 기본 공식으로 되돌립니다 (되돌리기 가능)',
      onclick: () => app.resetWaves(),
    })), h('div', {
      class: 'hint',
      text: '필드가 없는 스테이지는 기본 공식(웨이브 3개, 길이=전역 웨이브 길이, 간격 1초, 수 3+2k+스테이지 번호-1, 보스 웨이브 수 2+스테이지 번호-1)으로 동작합니다. 기본값과 같으면 저장 시 필드를 쓰지 않습니다.',
    }));
  }

  function renderConfig() {
    const box = els.config;
    box.replaceChildren(h('h3', {}, '전역 수치 ', h('span', { class: 'tag', text: '모든 스테이지에 적용됨' })));
    const f = buildForm(CONFIG_FIELDS, () => app.getData().config, {
      onInput: (field, v) => edit(() => app.setConfigField(field, v)),
    });
    forms.push(f);
    box.append(f.el);
  }

  function renderEtypes() {
    const box = els.etypes;
    box.replaceChildren(h('h3', {}, '적 종류 ', h('span', { class: 'tag', text: '모든 스테이지에 적용됨' })));
    const t = buildTable(ETYPE_FIELDS, () => app.getData().enemyTypes.slice(0, ETYPE_NAMES.length), ETYPE_NAMES, {
      onInput: (ri, field, v) => edit(() => app.setEtypeField(ri, field, v)),
    });
    forms.push(t);
    box.append(h('div', { class: 'tablewrap' }, t.el));
  }

  function renderIssues() {
    els.issues.replaceChildren();
    issuesBox = h('div');
    els.issues.append(h('h3', { text: '검증' }), issuesBox);
    syncIssues();
  }
  function syncIssues() {
    const { errors, warnings } = app.getIssues();
    issuesBox.replaceChildren();
    if (!errors.length && !warnings.length) issuesBox.append(h('div', { class: 'ok', text: '오류 없음' }));
    errors.forEach((e) => issuesBox.append(h('div', { class: 'err', text: `오류 · ${e.msg}` })));
    warnings.forEach((e) => issuesBox.append(h('div', { class: 'wrn', text: `경고 · ${e.msg}` })));
  }

  // 구조가 바뀌었을 때(선택, 스테이지 전환, 추가/삭제, undo 등) 전체 재생성
  function renderAll() {
    forms = [];
    renderStages(); renderAdd(); renderSel(); renderStageForm(); renderConfig(); renderEtypes(); renderIssues();
  }
  // 값만 바뀌었을 때(입력, 드래그) 입력 값·오류 표시만 갱신
  function sync() {
    forms.forEach((f) => f.sync());
    renderAdd(); // 개수 제한에 따른 버튼 활성 상태
    syncIssues();
  }
  return { renderAll, sync };
}
