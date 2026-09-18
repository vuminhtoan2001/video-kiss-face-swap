/* eslint-disable no-console */
/**
 * Chạy qua các tổ hợp SPACE x loại phòng x phong cách, render từng cái rồi dựng báo cáo HTML.
 *
 *   AI_APP_SECRET=<bí mật> node chay-to-hop.js --gioi-han 12
 *   AI_APP_SECRET=<bí mật> node chay-to-hop.js --space Garden --tat-ca
 *   node chay-to-hop.js --kho                 # ghép thử, không gọi mạng, không tốn GPU
 *   node chay-to-hop.js --chi-bao-cao         # dựng lại HTML từ kết quả đã có
 *
 * Bảng màu: CHỈ chạy key `surprise_me` (đúng yêu cầu). "Surprise Me" tự bốc một bảng
 * trong danh sách của nhóm, khoá theo hạt giống băm từ chính tổ hợp — nên mỗi tổ hợp ra
 * một bảng khác nhau mà chạy lại vẫn đúng bảng cũ, so sánh được giữa hai lần chạy.
 *
 * Ảnh gốc: mặc định lấy URL CDN theo nhóm (xem ANH_MAU) và gửi bằng `anh_url` — Colab
 * tải thẳng từ Internet (~46 MB/s). Dùng `--base64` để đọc file trong ./input lên thay
 * thế, hoặc `--anh-url <url>` để ép một ảnh dùng chung cho mọi nhóm.
 *
 * Có thể dừng giữa chừng: kết quả ghi dần vào ket-qua/bao-cao.json, chạy lại sẽ BỎ QUA
 * tổ hợp đã xong (trừ khi --lam-lai).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { Catalog, uocToken } = require('./prompt-builder');
const { trangThaiCum, chayJob, SECRET } = require('./ai-client');
const { dungHtml } = require('./tao-bao-cao');

// Dấu hiệu lỗi HẠ TẦNG — luôn đáng thử lại, kể cả khi api bảo không. Tunnel của Colab
// đổi URL mỗi lần khởi động lại, nên DNS trượt là chuyện thường trong lượt chạy dài.
const LOI_HA_TANG = /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|trycloudflare\.com|\b50[234]\b|timeout/i;

const THU_MUC_RA = path.join(__dirname, 'ket-qua');
const FILE_BAO_CAO = path.join(THU_MUC_RA, 'bao-cao.json');
const KEY_MAU = 'surprise_me';

// Ảnh gốc theo nhóm. Ảnh càng rõ chân tường / khung cửa sổ thì MLSD bắt đường càng
// chuẩn, và phòng render ra càng đúng hình dạng thật.
//
// `url` là đường mặc định: Colab tải thẳng từ CDN (~46 MB/s), nhanh hơn hẳn nhồi
// base64 qua api rồi qua tunnel. `file` chỉ dùng khi chạy với --base64 (máy không ra
// được Internet, hoặc muốn thử ảnh khác mà chưa kịp up lên CDN).
//
// LƯU Ý: ảnh Interior trên CDN là `interior_sample_2.png`, KHÁC file local
// `interior_sample_1.jpg` — hai đường này ra hai ảnh gốc khác nhau, nên báo cáo luôn
// ghi lại đúng ảnh đã dùng thật (trường `anh_goc`) chứ không đoán.
const ANH_MAU = {
  Interior: {
    url: 'https://d3y8wgliw9mu5.cloudfront.net/interior_sample_2.png',
    file: 'input/interior_sample_1.jpg',
  },
  Exterior: {
    url: 'https://d3y8wgliw9mu5.cloudfront.net/exterior_sample_1.png',
    file: 'input/exterior_sample_1.png',
  },
  Garden: {
    url: 'https://d3y8wgliw9mu5.cloudfront.net/garden_sample_1.png',
    file: 'input/garden_sample_1.png',
  },
};

function thamSo(argv) {
  const a = {
    space: null, room: null, style: null, gioiHan: 10, tatCa: false,
    keepLayout: 'true', seed: 42, songSong: 1, kho: false, chiBaoCao: false,
    lamLai: false, anhUrl: null, base64: false, choCumPhut: 60, thuLai: 2, nguongNgat: 8,
  };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    const val = () => argv[++i];
    if (t === '--space') a.space = val();
    else if (t === '--room') a.room = val();
    else if (t === '--style') a.style = val();
    else if (t === '--gioi-han') a.gioiHan = Number(val());
    else if (t === '--tat-ca') a.tatCa = true;
    else if (t === '--keep-layout') a.keepLayout = val();
    else if (t === '--seed') a.seed = Number(val());
    else if (t === '--song-song') a.songSong = Number(val());
    else if (t === '--anh-url') a.anhUrl = val();
    else if (t === '--base64') a.base64 = true;
    else if (t === '--cho-cum-phut') a.choCumPhut = Number(val());
    else if (t === '--thu-lai') a.thuLai = Number(val());
    else if (t === '--nguong-ngat') a.nguongNgat = Number(val());
    else if (t === '--kho') a.kho = true;
    else if (t === '--chi-bao-cao') a.chiBaoCao = true;
    else if (t === '--lam-lai') a.lamLai = true;
    else if (t === '--help' || t === '-h') {
      console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
      process.exit(0);
    } else throw new Error(`Không hiểu tham số: ${t}`);
  }
  return a;
}

/** Sinh mọi bộ (space, room, style, keepLayout) khớp với phần đã ghim. */
function sinhToHop(cat, a) {
  const ra = [];
  const keeps = a.keepLayout === 'both' ? [true, false] : [a.keepLayout === 'true'];
  for (const sp of a.space ? [a.space] : cat.tenSpace()) {
    const phongs = cat.tenPhong(sp).length ? cat.tenPhong(sp) : [null];
    for (const rm of a.room ? [a.room] : phongs) {
      if (a.room && !phongs.includes(a.room)) continue;
      for (const st of a.style ? [a.style] : cat.tenStyle(sp)) {
        for (const k of keeps) ra.push({ space: sp, room: rm, style: st, keepLayout: k });
      }
    }
  }
  return ra;
}

function maToHop(t) {
  return `${t.space}|${t.room || ''}|${t.style}|${t.keepLayout ? 'keep' : 'free'}`;
}

function tenFile(t, i) {
  const s = [String(i).padStart(4, '0'), t.space, t.room || 'khong-loai', t.style,
    t.keepLayout ? 'keep' : 'free'].join('_');
  return s.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120) + '.jpg';
}

function docBaoCao() {
  if (!fs.existsSync(FILE_BAO_CAO)) return [];
  try {
    return JSON.parse(fs.readFileSync(FILE_BAO_CAO, 'utf8'));
  } catch {
    console.warn('bao-cao.json hỏng, bắt đầu lại từ đầu');
    return [];
  }
}

function ghiBaoCao(dong) {
  fs.writeFileSync(FILE_BAO_CAO, JSON.stringify(dong, null, 1));
}

function anhBase64(space) {
  const p = path.join(__dirname, ANH_MAU[space].file);
  if (!fs.existsSync(p)) throw new Error(`Thiếu ảnh gốc cho ${space}: ${p}`);
  const duoi = path.extname(p).slice(1).toLowerCase();
  return `data:image/${duoi === 'jpg' ? 'jpeg' : duoi};base64,` + fs.readFileSync(p).toString('base64');
}

async function main() {
  const a = thamSo(process.argv);
  fs.mkdirSync(THU_MUC_RA, { recursive: true });

  if (a.chiBaoCao) {
    const dong = docBaoCao();
    const f = dungHtml(dong, THU_MUC_RA, ANH_MAU);
    console.log(`Dựng lại báo cáo từ ${dong.length} dòng -> ${f}`);
    return 0;
  }

  const cat = new Catalog();
  let toHop = sinhToHop(cat, a);
  console.log(`Tổng tổ hợp khớp điều kiện: ${toHop.length}`);

  // --- kiểm khô: ghép prompt, soi token, không gọi mạng ---
  if (a.kho) {
    let loi = 0;
    let dai = 0;
    for (const t of toHop) {
      let b;
      try {
        b = cat.build(t.space, t.room, t.style, layTenMau(cat, t.space), { keepLayout: t.keepLayout });
      } catch (e) {
        loi++;
        console.log(`  LỖI ${maToHop(t)}: ${e.message}`);
        continue;
      }
      for (const k of ['prompt', 'prompt_2', 'negative_prompt', 'negative_prompt_2']) {
        const n = uocToken(b[k]);
        if (n > 77) {
          dai++;
          console.log(`  >77 token (${n}) ${k}: ${maToHop(t)}`);
        }
      }
    }
    console.log(`\nGhép lỗi: ${loi} | chuỗi ước lượng vượt 77 token: ${dai} / ${toHop.length * 4}`);
    return loi ? 1 : 0;
  }

  if (!SECRET) {
    console.error('Thiếu AI_APP_SECRET. Dùng --kho để chạy thử không cần bí mật.');
    return 2;
  }

  // --- bỏ qua tổ hợp đã xong ---
  const cu = docBaoCao();
  const daXong = new Set(a.lamLai ? [] : cu.filter((d) => d.ok).map((d) => d.ma));
  // Đếm số BỊ LOẠI khỏi lần chạy này, không phải tổng số đã xong trong bao-cao.json:
  // chạy --space Exterior mà báo "bỏ qua 1" trong khi cái đã xong là Interior thì
  // đọc log không hiểu chuyện gì.
  const truocKhiLoc = toHop.length;
  toHop = toHop.filter((t) => !daXong.has(maToHop(t)));
  const soBoQua = truocKhiLoc - toHop.length;
  if (soBoQua) {
    console.log(`Bỏ qua ${soBoQua} tổ hợp đã xong (dùng --lam-lai để chạy lại hết).`);
  }

  if (!a.tatCa && a.gioiHan && toHop.length > a.gioiHan) {
    // Trộn có hạt giống để lần chạy sau lấy đúng bộ đó, không phải bộ ngẫu nhiên khác.
    const r = crypto.createHash('sha256').update(String(a.seed)).digest();
    toHop = toHop
      .map((t, i) => ({ t, k: r[i % r.length] * 1000 + (i % 997) }))
      .sort((x, y) => x.k - y.k)
      .slice(0, a.gioiHan)
      .map((x) => x.t);
    console.log(`Lấy ${toHop.length} tổ hợp (seed ${a.seed}). Dùng --tat-ca để chạy hết.`);
  }
  if (!toHop.length) {
    console.log('Không còn gì để chạy.');
    return 0;
  }

  const cum = await choCum(a.choCumPhut);
  if (!cum) return 1;

  const ket = [...cu.filter((d) => daXong.has(d.ma))];
  // Dùng chung giữa các luồng: một sự cố hệ thống thì luồng nào cũng gặp.
  let lienTiepLoi = 0;
  let dungSom = false;
  const b64 = {};
  let i = 0;
  const t0 = Date.now();

  async function congViec(luong) {
    for (;;) {
      const idx = i++;
      if (idx >= toHop.length || dungSom) return;
      const t = toHop[idx];
      const stt = ket.length + 1;
      const tenMau = layTenMau(cat, t.space);
      const than = cat.build(t.space, t.room, t.style, tenMau, { keepLayout: t.keepLayout });
      const meta = than._meta;
      delete than._meta;

      // Mặc định gửi URL công khai; --base64 mới đọc file local lên.
      let anhGoc;
      if (a.anhUrl) {
        than.anh_url = a.anhUrl;
        anhGoc = a.anhUrl;
      } else if (a.base64) {
        if (!b64[t.space]) b64[t.space] = anhBase64(t.space);
        than.anh_base64 = b64[t.space];
        anhGoc = ANH_MAU[t.space].file;
      } else {
        than.anh_url = ANH_MAU[t.space].url;
        anhGoc = than.anh_url;
      }
      than.seed = a.seed;

      const nhan = `${meta.space}/${meta.room || '—'}/${meta.style}/${meta.color}`;
      console.log(`[${idx + 1}/${toHop.length}]${luong ? ` (luồng ${luong})` : ''} ${nhan} ` +
        `keep=${t.keepLayout} ...`);

      const dong = {
        ma: maToHop(t), stt, ...meta,
        prompt: than.prompt, prompt_2: than.prompt_2,
        negative_prompt: than.negative_prompt, negative_prompt_2: than.negative_prompt_2,
        anh_goc: anhGoc, luc: new Date().toISOString(),
      };
      // Lỗi `retryable` là Colab rớt tunnel / hết máy — chuyện thường trong lượt chạy
      // vài chục giờ, và thử lại là xong. Lỗi không retryable (ảnh gốc hỏng) thì thử
      // lại bao nhiêu lần cũng vậy, bỏ qua luôn cho nhanh.
      for (let lan = 0; ; lan++) {
        try {
          const ra = await chayJob({
            deviceId: 'bao-cao-' + crypto.randomBytes(4).toString('hex'),
            params: than,
          });
          const fn = tenFile(t, stt);
          fs.writeFileSync(path.join(THU_MUC_RA, fn), ra.anh);
          Object.assign(dong, {
            ok: true, file: fn, kb: Math.round(ra.anh.length / 1024), giay: ra.giay,
            nguon: ra.nguon, job_key: ra.jobKey, so_lieu: ra.soLieu,
            so_lan_thu: lan + 1,
          });
          const s = ra.soLieu || {};
          console.log(`      OK ${ra.giay}s -> ${fn} (${dong.kb} KB) ` +
            `${(s.kich_thuoc || []).join('x')} line_scale=${s.line_scale}` +
            (lan ? ` (thử lần ${lan + 1})` : ''));
          break;
        } catch (e) {
          // api đôi khi phân loại sai: lỗi DNS/mạng tới tunnel của Colab bị đánh
          // `retryable: false` (đã gặp thật: ENOTFOUND ...trycloudflare.com khi một máy
          // chết nhưng api còn giữ URL cũ). Đó là hạ tầng chứ không phải đầu vào hỏng,
          // nên tự nhận diện thêm thay vì tin tuyệt đối vào cờ của api.
          const nenThu = e.retryable === true || LOI_HA_TANG.test(e.message || '');
          const conThu = nenThu && lan < a.thuLai;
          console.log(`      LỖI: ${e.message}` +
            (conThu ? ` — thử lại sau 60s (${lan + 1}/${a.thuLai})` : ''));
          if (!conThu) {
            Object.assign(dong, { ok: false, loi: e.message, thu_lai_duoc: nenThu,
              job_key: e.jobKey || null, so_lan_thu: lan + 1 });
            break;
          }
          await new Promise((s) => setTimeout(s, 60000));
          await choCum(a.choCumPhut);   // cụm có thể vừa mất máy, chờ nó quay lại
        }
      }
      ket.push(dong);
      ghiBaoCao(ket);          // ghi sau MỖI job: dừng giữa chừng vẫn còn nguyên

      // CẦU DAO NGẮT. Lỗi hệ thống (sai endpoint, sai type, cụm chạy nhầm notebook)
      // trả về TỨC THÌ, nên không có cái này thì runner nghiền hết 1115 tổ hợp trong
      // vài phút mà không render nổi một ảnh — đã xảy ra thật: 559 tổ hợp Exterior
      // trượt liên tiếp vì "Colab 405 Method Not Allowed".
      if (dong.ok) lienTiepLoi = 0;
      else if (++lienTiepLoi >= a.nguongNgat) {
        console.error(`\nNGẮT: ${lienTiepLoi} job lỗi liên tiếp — gần như chắc chắn là ` +
          `sự cố hệ thống, không phải lỗi lẻ.\nLỗi cuối: ${dong.loi}\n` +
          `Đã ghi ${ket.filter((x) => x.ok).length} ảnh thành công. Sửa xong chạy lại ` +
          `lệnh cũ, phần đã xong sẽ được bỏ qua.`);
        dungSom = true;
        return;
      }
      // Dựng lại HTML mỗi 10 ảnh. Lượt Exterior dài ~25 giờ — chờ hết nhóm mới có
      // báo cáo thì không xem được tiến độ, mà dựng lại chỉ tốn vài chục mili giây.
      if (ket.length % 10 === 0) dungHtml(ket, THU_MUC_RA, ANH_MAU);
    }
  }

  const songSong = Math.max(1, Math.min(a.songSong, cum.readyProfiles || 1));
  await Promise.all(Array.from({ length: songSong }, (_, k) => congViec(songSong > 1 ? k + 1 : 0)));

  const xong = ket.filter((d) => d.ok).length;
  const f = dungHtml(ket, THU_MUC_RA, ANH_MAU);
  if (dungSom) {
    console.log('\nDỪNG SỚM vì lỗi liên tiếp — danh sách còn lại CHƯA chạy.');
  }
  console.log(`\nXong ${xong}/${ket.length} trong ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`Báo cáo: ${f}`);
  // Trả mã lỗi khi ngắt: chuỗi `&&` ở ngoài sẽ KHÔNG nhảy sang nhóm kế tiếp,
  // tránh lặp lại sự cố trên cả Exterior lẫn Interior.
  return dungSom || xong !== ket.length ? 1 : 0;
}

/**
 * Chờ cụm rảnh thay vì bỏ cuộc ngay.
 *
 * Kiểm tra một lần rồi thoát là sai với lượt chạy vài chục giờ: chỉ cần đúng lúc bắt
 * đầu có một job khác đang chạy, hoặc máy vừa khởi động lại, là cả chuỗi chết ở dòng
 * đầu tiên. Cụm bận là trạng thái TẠM THỜI, không phải lỗi.
 */
async function choCum(soPhut = 60) {
  const han = Date.now() + soPhut * 60 * 1000;
  let lan = 0;
  for (;;) {
    let cum;
    try {
      cum = await trangThaiCum();
    } catch (e) {
      // Mạng chập chờn cũng không được làm chết lượt chạy.
      console.log(`  [chờ cụm] lỗi mạng: ${e.message}`);
      cum = null;
    }
    if (cum) {
      const mo = `${cum.readyProfiles} máy rảnh, ${cum.runningJobs} job đang chạy, ` +
        `ước chờ ${cum.etaSeconds ?? '?'}s`;
      if (cum.available) {
        console.log(`Cụm: ${mo}`);
        return cum;
      }
      if (lan === 0) console.log(`Cụm chưa sẵn sàng (${mo}) — chờ tối đa ${soPhut} phút.`);
      else if (lan % 6 === 0) console.log(`  [chờ cụm] ${mo}`);
    }
    if (Date.now() > han) {
      console.error(`Cụm vẫn chưa sẵn sàng sau ${soPhut} phút, bỏ cuộc.`);
      return null;
    }
    lan++;
    await new Promise((s) => setTimeout(s, 30000));
  }
}

/** Tên hiển thị của bảng màu có key `surprise_me` trong nhóm đó. */
function layTenMau(cat, space) {
  const m = cat.mauTheoKey(space, KEY_MAU);
  if (!m) throw new Error(`Nhóm ${space} không có bảng màu key='${KEY_MAU}'`);
  return m.ten;
}

main().then((m) => process.exit(m)).catch((e) => {
  console.error('LỖI:', e.message);
  process.exit(1);
});
