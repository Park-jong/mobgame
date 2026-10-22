// 개발 서버 전용 플러그인: 에디터가 쓸 게임 데이터(src/data/game.json) 읽기/저장 API.
//   GET  /api/game-data : 현재 game.json 반환
//   POST /api/game-data : 본문 검증 후 game.json에 원자적으로 저장 (임시 파일 → rename)
//   GET  /api/stage-backup : 기본 스테이지 1~5 백업(src/data/backup/base-stages.json) 반환, 없으면 404. 쓰기 API는 없다.
// 백업은 서버 시작 시 파일이 없을 때만 game.json 앞 5개 스테이지로 한 번 만들고, 이후 절대 덮어쓰지 않는다.
// apply: 'serve'라서 빌드 결과물에는 들어가지 않는다. 저장 경로는 고정이며 요청에서 받지 않는다.
// 저장 후 game.json 변경은 Vite 파일 감시가 감지해 기본 동작(전체 리로드)으로 반영된다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_PATH = '/api/game-data';
const DATA_FILE = fileURLToPath(new URL('../src/data/game.json', import.meta.url));
const BACKUP_FILE = fileURLToPath(new URL('../src/data/backup/base-stages.json', import.meta.url));
const BACKUP_API = '/api/stage-backup';
const BASE_STAGE_COUNT = 5;
const MAX_BYTES = 1024 * 1024; // 본문 크기 제한 1MB

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// 본문을 문자열로 읽는다. 제한을 넘으면 즉시 중단하고 null 반환.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > MAX_BYTES) { over = true; chunks.length = 0; return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// 구조 검증: 최상위 객체, config 객체, enemyTypes 배열, stages 비어 있지 않은 배열. 세부 수치는 게임의 sanitizeData가 처리한다.
function validate(data) {
  if (!isObj(data)) return '최상위가 객체여야 합니다';
  if (!isObj(data.config)) return 'config는 객체여야 합니다';
  if (!Array.isArray(data.enemyTypes)) return 'enemyTypes는 배열이어야 합니다';
  if (!Array.isArray(data.stages) || data.stages.length === 0) return 'stages는 비어 있지 않은 배열이어야 합니다';
  return null;
}

// 백업 파일이 없으면 dataFile의 앞 5개 스테이지로 생성한다. 이미 있으면 건드리지 않는다.
// 반환: 'created' | 'exists' | 'skipped'(스테이지 5개 미만/읽기 실패)
export function ensureBackup(dataFile, backupFile, log = console) {
  if (fs.existsSync(backupFile)) return 'exists';
  let stages;
  try { stages = JSON.parse(fs.readFileSync(dataFile, 'utf8')).stages; } catch (e) {
    log.warn(`[game-data] 백업 생성 실패: ${dataFile}을 읽을 수 없습니다 (${e.message})`);
    return 'skipped';
  }
  if (!Array.isArray(stages) || stages.length < BASE_STAGE_COUNT) {
    log.warn(`[game-data] 스테이지가 ${BASE_STAGE_COUNT}개 미만이라 기본 스테이지 백업을 만들지 않았습니다`);
    return 'skipped';
  }
  const body = { createdAt: new Date().toISOString(), stages: stages.slice(0, BASE_STAGE_COUNT) };
  fs.mkdirSync(path.dirname(backupFile), { recursive: true });
  try {
    fs.writeFileSync(backupFile, JSON.stringify(body, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' }); // wx: 있으면 실패 = 덮어쓰기 불가
  } catch (e) {
    if (e.code === 'EEXIST') return 'exists';
    throw e;
  }
  log.info(`[game-data] 기본 스테이지 백업을 만들었습니다: ${backupFile}`);
  return 'created';
}

export default function gameDataPlugin() {
  return {
    name: 'game-data-api',
    apply: 'serve',
    configureServer(server) {
      try { ensureBackup(DATA_FILE, BACKUP_FILE, server.config.logger); } catch (e) { server.config.logger.warn(`[game-data] 백업 생성 오류: ${e.message}`); }
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || '').split('?')[0];
        const isBackup = url === BACKUP_API && req.method === 'GET';
        if (!isBackup && (url !== API_PATH || (req.method !== 'GET' && req.method !== 'POST'))) return next();

        // 같은 출처만 허용: Origin이 있으면 요청을 받은 호스트와 같아야 한다.
        const origin = req.headers.origin;
        if (origin && origin !== `http://${req.headers.host}`) {
          return send(res, 403, { ok: false, error: '허용되지 않은 Origin입니다' });
        }

        try {
          if (isBackup) {
            let text;
            try { text = await fs.promises.readFile(BACKUP_FILE, 'utf8'); } catch (e) {
              if (e.code === 'ENOENT') return send(res, 404, { ok: false, error: '백업 파일이 없습니다' });
              throw e;
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            return res.end(text);
          }
          if (req.method === 'GET') {
            const text = await fs.promises.readFile(DATA_FILE, 'utf8');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            return res.end(text);
          }

          const text = await readBody(req);
          if (text === null) return send(res, 400, { ok: false, error: `본문이 ${MAX_BYTES} 바이트를 넘습니다` });
          let data;
          try { data = JSON.parse(text); } catch { return send(res, 400, { ok: false, error: 'JSON 파싱에 실패했습니다' }); }
          const err = validate(data);
          if (err) return send(res, 400, { ok: false, error: err });

          const tmp = path.join(path.dirname(DATA_FILE), `.game.json.${process.pid}.tmp`);
          try {
            await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
            await fs.promises.rename(tmp, DATA_FILE);
          } catch (e) {
            await fs.promises.rm(tmp, { force: true });
            throw e;
          }
          return send(res, 200, { ok: true });
        } catch (e) {
          return send(res, 500, { ok: false, error: `서버 오류: ${e.message}` });
        }
      });
    },
  };
}
