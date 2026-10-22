// 실행 환경 감지 (DOM 없음, Node에서 테스트 가능). 개발 서버 API가 실제로 응답하는지로만 판정한다.
// 판정 기준: HTTP 200 + Content-Type이 JSON + 본문이 기대한 모양일 때만 "사용 가능".
// 정적 호스팅의 404, SPA 폴백(HTML 200), 네트워크 오류, 형식이 다른 JSON은 모두 "불가"다.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// 게임 데이터 모양: 스테이지 배열을 가진 객체
export const isGameDataShape = (d) => isObj(d) && Array.isArray(d.stages) && d.stages.length > 0;
// 백업 모양: 스테이지 배열(최소 minStages개)을 가진 객체
export const isBackupShape = (minStages) => (d) => isObj(d) && Array.isArray(d.stages) && d.stages.length >= minStages;

/**
 * url을 GET해 유효한 JSON인지 확인한다.
 * 반환: { ok: true, data } | { ok: false, reason }
 */
export async function probeJson(fetchFn, url, isValid) {
  let res;
  try {
    res = await fetchFn(url, { cache: 'no-store' });
  } catch (e) {
    return { ok: false, reason: `네트워크 오류 (${e.message})` };
  }
  if (res.status !== 200) return { ok: false, reason: `HTTP ${res.status}` };
  const type = (res.headers?.get?.('content-type') || '').toLowerCase();
  if (!/\bjson\b/.test(type)) return { ok: false, reason: `JSON이 아닌 응답 (${type || 'Content-Type 없음'})` };
  let data;
  try { data = JSON.parse(await res.text()); } catch { return { ok: false, reason: 'JSON 파싱 실패' }; }
  if (!isValid(data)) return { ok: false, reason: '예상한 데이터 형식이 아닙니다' };
  return { ok: true, data };
}

export const apiUrl = (baseURI, name) => new URL(`api/${name}`, baseURI).href;

/**
 * 서버 기능 감지.
 * 반환: { canSave, canBackup, data, backup, saveReason, backupReason }
 *  data: canSave일 때 서버의 game.json, backup: canBackup일 때 백업 본문
 */
export async function detectEnvironment(fetchFn, baseURI, minBackupStages = 5) {
  const [g, b] = await Promise.all([
    probeJson(fetchFn, apiUrl(baseURI, 'game-data'), isGameDataShape),
    probeJson(fetchFn, apiUrl(baseURI, 'stage-backup'), isBackupShape(minBackupStages)),
  ]);
  return {
    canSave: g.ok, data: g.ok ? g.data : null, saveReason: g.ok ? '' : g.reason,
    canBackup: b.ok, backup: b.ok ? b.data : null, backupReason: b.ok ? '' : b.reason,
  };
}

// 플레이 테스트 주소: 에디터 페이지와 같은 폴더의 게임(index.html)을 가리킨다 (하위 경로 배포 대응)
export function gameUrl(baseURI, stageNo) {
  const u = new URL('./', baseURI);
  u.searchParams.set('draft', '1');
  u.searchParams.set('stage', String(stageNo));
  return u.href;
}
