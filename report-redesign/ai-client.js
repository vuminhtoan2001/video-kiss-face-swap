/* eslint-disable no-console */
/**
 * Client gọi api.downloadvideo.vn — tách từ vi-du-interior-design.js để service và ví dụ
 * dùng chung một bộ ký, không lệch nhau.
 *
 * App KHÔNG bao giờ nói chuyện thẳng với Colab. Colab đẩy ảnh về api, app tải từ api.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Nạp ./.env nếu có, KHÔNG đè biến môi trường đã đặt sẵn.
 * File .env nằm trong .gitignore — bí mật không lọt vào git, mà chạy thì không phải
 * dán lại mỗi lần.
 */
(function napEnv() {
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  for (const dong of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = dong.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

const BASE = process.env.AI_APP_BASE_URL || 'https://api.downloadvideo.vn';
const SECRET = process.env.AI_APP_SECRET;

// X-Fleet-Key CHÍNH LÀ tên type. api dùng `^[a-z0-9_]+$` — một chữ HOA là job không tạo
// được. `interior_design` là TÊN TYPE, không phải tên file notebook.
const TYPE = 'interior_design';

/**
 * Chuỗi ký phải khớp TỪNG BYTE với server:
 *   METHOD \n path-kèm-query \n ts \n nonce \n sha256hex(body)
 *
 * Ba chỗ hay sai: ký một chuỗi rồi gửi chuỗi khác (server băm BYTE THÔ của body, nên
 * JSON.stringify MỘT LẦN rồi ký và gửi đúng nó); quên phần query; đồng hồ lệch quá
 * 300 giây thì 401.
 */
function kyRequest(method, duongDan, raw) {
  const ts = Math.floor(Date.now() / 1000);
  // 16 byte ngẫu nhiên. Bộ đếm hay timestamp sẽ trùng nonce khi hai request cùng giây,
  // và server từ chối nonce đã thấy.
  const nonce = crypto.randomBytes(16).toString('hex');
  const bodyHash = crypto.createHash('sha256').update(raw || Buffer.alloc(0)).digest('hex');
  const chuoi = [method.toUpperCase(), duongDan, String(ts), nonce, bodyHash].join('\n');
  return {
    'X-Fleet-Key': TYPE,
    'X-Fleet-Ts': String(ts),
    'X-Fleet-Nonce': nonce,
    'X-Fleet-Sig': crypto.createHmac('sha256', SECRET).update(chuoi).digest('hex'),
  };
}

async function goi(method, duongDan, body) {
  const raw = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const headers = kyRequest(method, duongDan, raw);
  if (raw) headers['Content-Type'] = 'application/json';

  const r = await fetch(BASE + duongDan, { method, headers, body: raw });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${duongDan} -> ${r.status}: ${text.slice(0, 200)}`);
  }
  if (!r.ok || json.success === false) {
    const e = new Error(
      `${method} ${duongDan} -> ${r.status}: ` +
        (json.message || (json.error && json.error.message) || text.slice(0, 200)),
    );
    e.status = r.status;
    throw e;
  }
  return json;
}

/** Cụm còn máy rảnh không. Hỏi TRƯỚC khi bắn hàng loạt job. */
async function trangThaiCum() {
  return (await goi('GET', '/api/c/ai/app/status')).result;
}

/**
 * Tạo job -> poll -> tải ảnh. Trả { jobKey, anh: Buffer, giay, nguon, soLieu }.
 *
 * Poll bằng nhiều request ngắn chứ không giữ một kết nối dài: Cloudflare cắt ở ~100
 * giây, mà render một ảnh mất 40-120 giây.
 */
async function chayJob({ deviceId, params, quaHan = 10 * 60 * 1000, nhip = 3000, log = () => {} }) {
  const tao = await goi('POST', '/api/c/ai/app/jobs', { type: TYPE, deviceId, params });
  const t0 = Date.now();
  let job;
  for (;;) {
    await new Promise((s) => setTimeout(s, nhip));
    job = (await goi('GET', `/api/c/ai/app/jobs/${tao.jobKey}`)).result;
    log(job.status, Math.round((Date.now() - t0) / 1000));
    if (job.status === 'done') break;
    if (job.status === 'error') {
      // retryable phân biệt hai loại lỗi rất khác nhau:
      //   true  - Colab bị ngắt / tunnel chết / hết máy -> thử lại được
      //   false - anh_url hỏng, ảnh tải về rỗng -> thử lại bao nhiêu lần cũng vậy
      const e = new Error(job.retryMessage || job.error || 'job error');
      e.retryable = job.retryable;
      e.jobKey = tao.jobKey;
      throw e;
    }
    if (Date.now() - t0 > quaHan) {
      const e = new Error(`quá ${Math.round(quaHan / 1000)}s, bỏ cuộc`);
      e.retryable = true;
      e.jobKey = tao.jobKey;
      throw e;
    }
  }

  const duongDan = `/api/c/ai/app/jobs/${tao.jobKey}/result`;
  const r = await fetch(BASE + duongDan, { headers: kyRequest('GET', duongDan) });
  if (!r.ok) throw new Error(`Tải kết quả lỗi ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());

  return {
    jobKey: tao.jobKey,
    anh: buf,
    kieu: r.headers.get('content-type'),
    giay: Number(((Date.now() - t0) / 1000).toFixed(1)),
    // 'dia' = Colab đã đẩy file về api (đường thường)
    // 'tunnel' = api kéo ngược qua tunnel của Colab, chậm hơn ~85 lần
    nguon: r.headers.get('x-result-source'),
    soLieu: job.so_lieu || null,
  };
}

module.exports = { BASE, TYPE, SECRET, kyRequest, goi, trangThaiCum, chayJob };
