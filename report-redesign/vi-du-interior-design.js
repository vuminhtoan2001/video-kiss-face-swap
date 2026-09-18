/* eslint-disable no-console */
/**
 * VÍ DỤ HOÀN CHỈNH — type `interior_design` (render nội thất / ngoại thất / sân vườn).
 *
 * Một file, không phụ thuộc gì ngoài Node 18+ (`fetch` và `node:crypto` có sẵn).
 * Chép thẳng sang app là chạy được.
 *
 *   AI_APP_SECRET=<bí mật> node clients/vi-du-interior-design.js
 *
 * Bốn bước, đúng như mọi type khác:
 *
 *   1. Hỏi cụm còn máy không   GET  /api/c/ai/app/status
 *   2. Tạo job                 POST /api/c/ai/app/jobs
 *   3. Poll tới khi xong       GET  /api/c/ai/app/jobs/:key
 *   4. Tải ẢNH về              GET  /api/c/ai/app/jobs/:key/result
 *
 * Khác `face_swap_*` đúng hai chỗ: vào là MỘT ảnh phòng (không phải ảnh mặt +
 * video), và ra là **ảnh JPEG**, không phải mp4.
 *
 * ── Điều quan trọng nhất về type này ────────────────────────────────────────
 *
 * Notebook **KHÔNG biết** SPACE / loại phòng / phong cách / bảng màu. Nó chỉ
 * nhận một chuỗi `prompt`. Bên ngoài (giao diện hoặc script) chọn
 * SPACE -> room type -> style -> color -> keep_layout, tra 9 file JSON rồi GHÉP
 * chuỗi, và gửi chuỗi đó xuống.
 *
 * Được gì: đổi mô tả một phong cách là **sửa JSON**, không phải sửa notebook rồi
 * mở lại Colab và tải lại 8 GB model. File dưới đây viết cứng prompt cho gọn;
 * app thật thì dùng chung `prompt_builder.py` với giao diện, để hai bên không
 * lệch nhau.
 *
 * App KHÔNG bao giờ nói chuyện với Colab. Colab đẩy ảnh kết quả thẳng về
 * api.downloadvideo.vn, app tải từ api.
 */
const crypto = require('crypto');
const fs = require('fs');

// ─────────────────────────────────────────────────────────────── cấu hình
const BASE = process.env.AI_APP_BASE_URL || 'https://api.downloadvideo.vn';
const SECRET = process.env.AI_APP_SECRET; // ĐỪNG viết cứng, đừng để lọt vào git

// X-Fleet-Key CHÍNH LÀ tên type. Một bí mật dùng chung cho mọi type, nên gọi type
// khác thì chỉ đổi đúng dòng này — không phải khai thêm gì ở api.
//
// Tên type là `interior_design`, KHÔNG phải `Interior_Design_Render` (đó là tên
// FILE notebook). api dùng `^[a-z0-9_]+$`, một chữ HOA là job không tạo được.
const TYPE = 'interior_design';

if (!SECRET) {
  console.error('Thiếu AI_APP_SECRET. Xem docs/HUONG-DAN-APP-FACE-SWAP.md (phần ký dùng chung).');
  process.exit(2);
}

// ──────────────────────────────────────────────────────────────── phần ký
//
// Đây là phần duy nhất cần đọc kỹ. Chuỗi ký phải khớp TỪNG BYTE với server:
//
//   METHOD \n path-kèm-query \n ts \n nonce \n sha256hex(body)
//
// Ba chỗ hay sai:
//   - Ký một chuỗi rồi gửi chuỗi khác. Server băm BYTE THÔ của body, không parse
//     rồi băm lại. JSON.stringify MỘT LẦN, ký trên nó, gửi ĐÚNG nó.
//   - Quên query. '/app/status?type=x' phải ký cả '?type=x', đúng thứ tự.
//   - Đồng hồ lệch quá 300 giây -> 401. Bật NTP.
//
function kyRequest(method, duongDan, raw) {
  const ts = Math.floor(Date.now() / 1000);
  // 16 byte ngẫu nhiên. Đừng dùng bộ đếm hay timestamp: hai request cùng giây sẽ
  // trùng nonce, và server từ chối nonce đã thấy.
  const nonce = crypto.randomBytes(16).toString('hex');
  const bodyHash = crypto
    .createHash('sha256')
    .update(raw || Buffer.alloc(0))
    .digest('hex');
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

// ───────────────────────────────────────────────────────────── luồng chính
async function renderNoiThat({
  deviceId,
  anh,
  prompt,
  prompt2,
  negative,
  negative2,
  giuBoCuc = true,
  steps,
  seed,
  guidance,
  megapixel,
}) {
  // 1. Cụm còn máy không. Hỏi TRƯỚC khi cho người dùng bấm nút — không hỏi thì họ
  //    chỉ biết "hết máy" sau khi đã chờ xong. Không cần `?type=`: prefix nói rồi.
  const cum = (await goi('GET', '/api/c/ai/app/status')).result;
  console.log(
    `cụm: ${cum.readyProfiles} máy rảnh, ${cum.runningJobs} job đang chạy, ` +
      `ước tính chờ ${cum.etaSeconds ?? '?'}s`,
  );
  if (!cum.available) {
    throw new Error(cum.warmingUp ? 'Máy chủ AI đang khởi động, thử lại sau ít phút' : 'Cụm đang bận');
  }

  // 2. Tạo job. Trả về NGAY, không chờ render.
  const tao = await goi('POST', '/api/c/ai/app/jobs', {
    // `type` là thừa vì prefix đã nói; để đây cho dễ đọc. Gửi khác prefix thì 403.
    type: TYPE,
    deviceId, // BẮT BUỘC: bằng chứng sở hữu job — prefix khác không đọc được
    params: {
      // Ảnh phòng gốc. URL CÔNG KHAI: Colab tải thẳng từ Internet (~46 MB/s),
      // nhanh hơn hẳn đẩy file qua api rồi qua tunnel. Cứ để ở CDN/S3 của mình.
      // (Còn `anh_base64` cho bên không có chỗ host file, nhưng chậm hơn nhiều.)
      anh_url: anh,

      // SDXL có HAI text encoder, mỗi cái chỉ nhận 77 token. Tách làm đôi để tag
      // chất lượng ở cuối không bị cắt mất:
      //   prompt   — không gian + hạng mục + look của style + bảng màu
      //   prompt_2 — hạng mục định danh + tag hoàn thiện + tag chất lượng
      // Nhồi hết vào `prompt` thì phần đuôi rơi ra ngoài 77 token mà KHÔNG có
      // cảnh báo nào — ảnh vẫn ra, chỉ là thiếu đúng phần mình vừa thêm.
      prompt,
      prompt_2: prompt2,
      negative_prompt: negative,
      negative_prompt_2: negative2,

      // true  -> giữ cửa sổ / đường tường của ảnh gốc (ControlNet weight 0.60)
      // false -> cho model đổi bố cục (weight 0.25)
      keep_layout: giuBoCuc,

      // Bỏ trống hết mấy dòng dưới thì notebook dùng mặc định đã dò
      // (30 steps, cfg 6.0, seed 42, 1 megapixel). Xem GET /version của tunnel.
      steps,
      seed, // cùng seed + cùng prompt = cùng ảnh; đổi seed để lấy phương án khác
      guidance,
      megapixel,
    },
  });
  console.log(`job ${tao.jobKey} đã tạo`);

  // 3. Poll. Mỗi lượt gọi đều ngắn nên không đụng trần ~100s của Cloudflare, dù
  //    job chạy hơn một phút. ĐỪNG giữ một kết nối dài chờ kết quả.
  const t0 = Date.now();
  let job;
  for (;;) {
    await new Promise((s) => setTimeout(s, 3000));
    job = (await goi('GET', `/api/c/ai/app/jobs/${tao.jobKey}`)).result;
    console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)}s  ${job.status}`);

    if (job.status === 'done') break;
    if (job.status === 'error') {
      // `retryable` phân biệt hai loại lỗi rất khác nhau:
      //   true  - Colab bị ngắt / tunnel chết / hết máy -> mời người dùng thử lại
      //   false - anh_url hỏng, ảnh tải về rỗng -> thử lại bao nhiêu lần cũng vậy
      const e = new Error(job.retryMessage || job.error);
      e.retryable = job.retryable;
      throw e;
    }
    if (Date.now() - t0 > 10 * 60 * 1000) throw new Error('Quá 10 phút, bỏ cuộc');
  }

  // 4. Tải ảnh về.
  const t1 = Date.now();
  const duongDan = `/api/c/ai/app/jobs/${tao.jobKey}/result`;
  const r = await fetch(BASE + duongDan, { headers: kyRequest('GET', duongDan) });
  if (!r.ok) throw new Error(`Tải kết quả lỗi ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());

  return {
    jobKey: tao.jobKey,
    anh: buf,
    kieu: r.headers.get('content-type'), // image/jpeg
    giay: Number(((Date.now() - t1) / 1000).toFixed(2)),
    // 'dia'    = Colab đã đẩy file về api (đường thường)
    // 'tunnel' = api đang kéo ngược qua tunnel của Colab, chậm hơn ~85 lần
    nguon: r.headers.get('x-result-source'),
    soLieu: job.so_lieu || null,
  };
}

// ──────────────────────────────────────────────────────────────── chạy thử
//
// Prompt dưới đây viết cứng cho gọn. App thật thì GHÉP nó từ 9 file JSON bằng
// `prompt_builder.py` — cùng một hàm với giao diện, để hai bên không lệch nhau.
(async () => {
  const ra = await renderNoiThat({
    // Id ỔN ĐỊNH của từng thiết bị hoặc từng người dùng. Nó xuống DB và là thứ
    // phân biệt job của ai.
    deviceId: 'thiet-bi-' + crypto.randomBytes(4).toString('hex'),

    // Một phòng trống. Ảnh càng rõ chân tường / khung cửa sổ thì MLSD bắt đường
    // càng chuẩn, và phòng render ra càng đúng hình dạng thật.
    anh: 'https://images.pexels.com/photos/1571460/pexels-photo-1571460.jpeg?auto=compress&cs=tinysrgb&w=1200',

    prompt:
      'living room interior, large sectional sofa, wooden coffee table, armchair, ' +
      'area rug, floor lamp, framed wall art, linen curtains, indoor plants, ' +
      'scandinavian style, warm oak and off-white palette',
    prompt2:
      'living room, fully furnished, professionally staged, all essential furniture present, ' +
      'photorealistic, professional interior photography, natural daylight, sharp focus',
    negative:
      'blurry, low quality, distorted, deformed furniture, watermark, text, ' +
      'unrealistic proportions, warped walls, people, duplicate objects, ' +
      'floating furniture, oversaturated',
    negative2: 'empty room, unfurnished, bare floor, no furniture, vacant',

    // true = giữ nguyên cửa sổ và đường tường của ảnh gốc. Đây là thứ khách hàng
    // thường muốn: "vẫn là phòng nhà tôi, chỉ khác nội thất".
    giuBoCuc: true,
    seed: 42, // cùng seed + cùng prompt = cùng ảnh. Đổi seed để lấy phương án khác.
  });

  const ten = `ket-qua-interior-${ra.jobKey.slice(0, 8)}.jpg`;
  fs.writeFileSync(ten, ra.anh);
  console.log(
    `\nxong: ${ten} — ${(ra.anh.length / 1e6).toFixed(2)} MB, ${ra.kieu}, ` +
      `tải mất ${ra.giay}s, nguồn = ${ra.nguon}`,
  );

  // `so_lieu` là số Colab đo được của chính lần render này. Đây là chỗ đầu tiên
  // cần nhìn khi ảnh ra không như ý: `line_scale` cho biết nó bám bố cục gốc chặt
  // tới đâu, `kich_thuoc` cho biết ảnh có bị ép sai tỉ lệ không.
  if (ra.soLieu) {
    const s = ra.soLieu;
    console.log(
      `  render ${s.giay}s · ${(s.kich_thuoc || []).join('x')} · ` +
        `line_scale ${s.line_scale} (keep_layout=${s.keep_layout}) · ` +
        `${s.steps} steps · cfg ${s.guidance} · seed ${s.seed}`,
    );
  }
})().catch((e) => {
  console.error('LỖI:', e.message, e.retryable === true ? '(thử lại được)' : '');
  process.exit(1);
});
