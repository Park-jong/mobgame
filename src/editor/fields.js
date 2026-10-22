// 필드 정의 공통 로직 (DOM 없음). 필드 정의 형식:
//   { name, label, type: 'number'|'select'|'text'|'color'|'checkbox'|'numlist'|'note',
//     min, max, step, int, options:[{value,label}], multiline, length(numlist), help,
//     optional(number 전용: undefined 허용), get(obj), set(obj, v), check(v, obj) -> 오류 문자열|null, text(obj, ctx) (note 전용) }
// 리스트 폼 정의 (행 목록, 예: 웨이브): { name, label, min, max, itemFields:[필드 정의], itemLabel(i), addLabel }
//   validateList가 길이(min~max)와 행마다 itemFields를 검사하고, panels.js의 buildListForm이 행 입력·삭제·추가 UI를 만든다.
// 값이 범위를 벗어나도 편집 데이터에는 그대로 저장하고, checkField가 오류를 알려 준다(빨간 테두리·저장 차단).

export const getValue = (f, obj) => (f.get ? f.get(obj) : obj[f.name]);
export function setValue(f, obj, v) {
  if (f.set) f.set(obj, v);
  else obj[f.name] = v;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function checkNumber(f, v) {
  if (f.optional && v === undefined) return null;
  if (!isNum(v)) return '숫자를 입력하세요';
  if (f.int && !Number.isInteger(v)) return '정수여야 합니다';
  if (f.min !== undefined && v < f.min) return `${f.min} 이상이어야 합니다`;
  if (f.max !== undefined && v > f.max) return `${f.max} 이하여야 합니다`;
  return null;
}

// 값 하나를 검사한다. 오류가 없으면 null
export function checkField(f, v, obj) {
  let msg = null;
  switch (f.type) {
    case 'number': msg = checkNumber(f, v); break;
    case 'select':
      if (!f.options.some((o) => o.value === v)) msg = '허용되지 않은 값입니다';
      break;
    case 'text': if (typeof v !== 'string') msg = '문자열이어야 합니다'; break;
    case 'color': if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) msg = "'#rrggbb' 형식이어야 합니다"; break;
    case 'checkbox': if (typeof v !== 'boolean') msg = 'true/false여야 합니다'; break;
    case 'numlist':
      if (!Array.isArray(v) || v.length !== f.length) msg = `길이 ${f.length}의 배열이어야 합니다`;
      else {
        for (let i = 0; i < v.length && !msg; i++) {
          const m = checkNumber(f, v[i]);
          if (m) msg = `[${i + 1}] ${m}`;
        }
      }
      break;
    default: break; // note 등
  }
  if (!msg && f.check) msg = f.check(v, obj) || null;
  return msg;
}

// 리스트 폼 검사: 항목 배열 전체. [{ path, msg }]
export function validateList(def, items, path) {
  if (!Array.isArray(items)) return [{ path, msg: `${def.label}: 배열이어야 합니다` }];
  const out = [];
  if (items.length < def.min || items.length > def.max) out.push({ path, msg: `${def.label}: ${def.min}~${def.max}개여야 합니다 (현재 ${items.length}개)` });
  items.forEach((it, i) => {
    const ip = `${path}[${i}]`;
    if (it === null || typeof it !== 'object' || Array.isArray(it)) {
      out.push({ path: ip, msg: `${def.itemLabel(i)}: 객체여야 합니다` });
      return;
    }
    for (const m of validateFields(def.itemFields, it, ip)) out.push({ path: m.path, msg: `${def.itemLabel(i)} ${m.msg}` });
  });
  return out;
}

// 필드 목록 전체를 검사해 [{ path, msg }]로 돌려준다
export function validateFields(fields, obj, path) {
  const out = [];
  for (const f of fields) {
    if (f.type === 'note') continue;
    const msg = checkField(f, getValue(f, obj), obj);
    if (msg) out.push({ path: `${path}.${f.name}`, msg: `${f.label}: ${msg}` });
  }
  return out;
}
