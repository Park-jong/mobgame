// 필드 정의 공통 로직 (DOM 없음). 필드 정의 형식:
//   { name, label, type: 'number'|'select'|'text'|'color'|'checkbox'|'numlist'|'note',
//     min, max, step, int, options:[{value,label}], multiline, length(numlist), help,
//     get(obj), set(obj, v), check(v, obj) -> 오류 문자열|null, text(obj, ctx) (note 전용) }
// 값이 범위를 벗어나도 편집 데이터에는 그대로 저장하고, checkField가 오류를 알려 준다(빨간 테두리·저장 차단).

export const getValue = (f, obj) => (f.get ? f.get(obj) : obj[f.name]);
export function setValue(f, obj, v) {
  if (f.set) f.set(obj, v);
  else obj[f.name] = v;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function checkNumber(f, v) {
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
