/* eslint-disable no-console */
/**
 * Dựng báo cáo HTML từ ket-qua/bao-cao.json — mỗi tổ hợp một thẻ, ảnh gốc cạnh ảnh render.
 *
 *   node tao-bao-cao.js          # dựng lại từ kết quả đã có
 *
 * File HTML nằm cùng thư mục với ảnh nên đường dẫn ảnh là tương đối — copy cả thư mục
 * ket-qua/ đi đâu cũng mở được, không cần server.
 */
const fs = require('fs');
const path = require('path');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const CSS = `
:root{--nen:#0f1115;--the:#171a21;--vien:#272c37;--chu:#e6e8ee;--mo:#9aa3b2;--nhan:#2a3040;--ok:#3fb950;--loi:#f85149}
*{box-sizing:border-box}
body{margin:0;background:var(--nen);color:var(--chu);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{position:sticky;top:0;z-index:5;background:rgba(15,17,21,.95);backdrop-filter:blur(8px);border-bottom:1px solid var(--vien);padding:14px 20px}
h1{margin:0 0 4px;font-size:17px}
.tomtat{color:var(--mo);font-size:13px}
.tomtat b{color:var(--chu)}
.loc{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;align-items:center}
.loc button{background:var(--nhan);color:var(--chu);border:1px solid var(--vien);border-radius:999px;padding:4px 12px;cursor:pointer;font-size:12px}
.loc button.chon{background:#3b82f6;border-color:#3b82f6}
.loc input{background:var(--nhan);color:var(--chu);border:1px solid var(--vien);border-radius:6px;padding:5px 10px;font-size:12px;min-width:200px}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(430px,1fr));gap:16px;padding:16px 20px 60px}
.the{background:var(--the);border:1px solid var(--vien);border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
.the.an{display:none}
.anh{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--vien)}
.anh figure{margin:0;position:relative;background:#000;aspect-ratio:4/3;overflow:hidden}
.anh img{width:100%;height:100%;object-fit:contain;cursor:zoom-in;display:block}
.anh figcaption{position:absolute;left:0;top:0;background:rgba(0,0,0,.65);color:#fff;font-size:10px;padding:2px 7px;border-bottom-right-radius:6px;letter-spacing:.04em}
.than{padding:11px 13px;display:flex;flex-direction:column;gap:7px;flex:1}
.ten{font-weight:600;font-size:14px;line-height:1.35}
.ten .mo{color:var(--mo);font-weight:400}
.nhan{display:flex;flex-wrap:wrap;gap:5px}
.nhan span{background:var(--nhan);border-radius:5px;padding:2px 7px;font-size:11px;color:var(--mo)}
.nhan span.ok{color:var(--ok)}.nhan span.loi{color:var(--loi)}
details{border-top:1px solid var(--vien);padding-top:7px;margin-top:auto}
summary{cursor:pointer;color:var(--mo);font-size:12px;user-select:none}
pre{white-space:pre-wrap;word-break:break-word;font:11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;color:#c9d1d9;background:#0d1117;border:1px solid var(--vien);border-radius:6px;padding:8px;margin:7px 0 0;max-height:210px;overflow:auto}
pre b{color:#7ee787;font-weight:600}
.loi-box{color:var(--loi);font-size:12px;background:#2d1214;border:1px solid #5c2326;border-radius:6px;padding:7px}
#den{position:fixed;inset:0;background:rgba(0,0,0,.92);display:none;align-items:center;justify-content:center;z-index:50;cursor:zoom-out;padding:24px}
#den img{max-width:100%;max-height:100%;object-fit:contain}
#trong{padding:40px 20px;color:var(--mo);text-align:center;grid-column:1/-1}
`;

const JS = `
const the = [...document.querySelectorAll('.the')];
const trangThai = { space: '', keep: '', ok: '', tim: '' };
function loc() {
  let hien = 0;
  for (const t of the) {
    const d = t.dataset;
    const khop =
      (!trangThai.space || d.space === trangThai.space) &&
      (!trangThai.keep || d.keep === trangThai.keep) &&
      (!trangThai.ok || d.ok === trangThai.ok) &&
      (!trangThai.tim || d.tim.includes(trangThai.tim));
    t.classList.toggle('an', !khop);
    if (khop) hien++;
  }
  document.getElementById('dem').textContent = hien;
  document.getElementById('trong').style.display = hien ? 'none' : 'block';
}
for (const b of document.querySelectorAll('.loc button')) {
  b.onclick = () => {
    const nhom = b.dataset.nhom;
    const cungNhom = [...document.querySelectorAll('.loc button[data-nhom="' + nhom + '"]')];
    const dangChon = b.classList.contains('chon');
    for (const x of cungNhom) x.classList.remove('chon');
    if (!dangChon) b.classList.add('chon');
    trangThai[nhom] = dangChon ? '' : b.dataset.gia;
    loc();
  };
}
document.getElementById('tim').oninput = (e) => {
  trangThai.tim = e.target.value.toLowerCase().trim();
  loc();
};
const den = document.getElementById('den');
document.addEventListener('click', (e) => {
  if (e.target.tagName === 'IMG' && e.target.closest('.anh')) {
    den.querySelector('img').src = e.target.src;
    den.style.display = 'flex';
  } else if (e.target.closest('#den')) den.style.display = 'none';
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') den.style.display = 'none'; });
loc();
`;

/**
 * Ảnh gốc có thể là URL CDN (đường mặc định) hoặc đường dẫn file trong repo (khi chạy
 * --base64). Trả về src dùng được cho cả hai: URL giữ nguyên, file thì lùi một cấp vì
 * HTML nằm trong ket-qua/.
 */
function srcAnhGoc(anhGoc) {
  if (!anhGoc) return '';
  return /^https?:\/\//.test(anhGoc) ? anhGoc : '../' + anhGoc;
}

function theHtml(d) {
  const nhan = [];
  nhan.push(`<span class="${d.ok ? 'ok' : 'loi'}">${d.ok ? 'OK' : 'LỖI'}</span>`);
  if (d.giay != null) nhan.push(`<span>${d.giay}s</span>`);
  const s = d.so_lieu || {};
  if (s.kich_thuoc) nhan.push(`<span>${s.kich_thuoc.join('×')}</span>`);
  if (s.line_scale != null) nhan.push(`<span>line ${s.line_scale}</span>`);
  nhan.push(`<span>${d.keep_layout ? 'giữ layout' : 'tự do'}</span>`);
  if (s.steps) nhan.push(`<span>${s.steps} steps · cfg ${s.guidance}</span>`);
  // Hien version notebook da render ra anh nay: chay dai vai chuc gio thi may Colab
  // khoi dong lai nhieu lan, moi lan co the lay ban khac.
  if (s.notebook_version) nhan.push(`<span>${s.notebook_version}</span>`);
  if (d.so_lan_thu > 1) nhan.push(`<span>thử ${d.so_lan_thu} lần</span>`);
  if (d.kb) nhan.push(`<span>${d.kb} KB</span>`);

  const anhRa = d.ok
    ? `<figure><figcaption>KẾT QUẢ</figcaption><img loading="lazy" src="${esc(d.file)}" alt=""></figure>`
    : `<figure><figcaption>KẾT QUẢ</figcaption></figure>`;

  const prompt = ['prompt', 'prompt_2', 'negative_prompt', 'negative_prompt_2']
    .filter((k) => d[k])
    .map((k) => `<b>${k}</b>\n${esc(d[k])}`)
    .join('\n\n');

  const tim = [d.space, d.room, d.style, d.color, d.ok ? 'ok' : 'loi'].join(' ').toLowerCase();

  return `<article class="the" data-space="${esc(d.space)}" data-keep="${d.keep_layout ? '1' : '0'}"
 data-ok="${d.ok ? '1' : '0'}" data-tim="${esc(tim)}">
  <div class="anh">
    <figure><figcaption>GỐC</figcaption><img loading="lazy" src="${esc(srcAnhGoc(d.anh_goc))}" alt=""></figure>
    ${anhRa}
  </div>
  <div class="than">
    <div class="ten">${esc(d.style)} <span class="mo">· ${esc(d.room || 'không có loại')} · ${esc(d.space)}</span></div>
    <div class="nhan"><span>${esc(d.color)}</span>${nhan.join('')}</div>
    ${d.ok ? '' : `<div class="loi-box">${esc(d.loi)}${d.thu_lai_duoc ? ' (thử lại được)' : ''}</div>`}
    <details><summary>prompt đã gửi</summary><pre>${prompt}</pre></details>
  </div>
</article>`;
}

/**
 * @param {Array} dong  nội dung bao-cao.json
 * @param {string} thuMucRa  thư mục chứa ảnh, HTML sẽ ghi vào đây
 * @param {Object} anhMau  { Interior: 'input/xxx.jpg', ... } để hiện ảnh gốc
 */
function dungHtml(dong, thuMucRa, anhMau = {}) {
  const xong = dong.filter((d) => d.ok);
  const giay = xong.map((d) => d.giay).filter((x) => typeof x === 'number');
  const tb = giay.length ? (giay.reduce((a, b) => a + b, 0) / giay.length).toFixed(0) : '—';
  const spaces = [...new Set(dong.map((d) => d.space))];

  const nutSpace = spaces
    .map((s) => `<button data-nhom="space" data-gia="${esc(s)}">${esc(s)} (${dong.filter((d) => d.space === s).length})</button>`)
    .join('');

  const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Báo cáo tổ hợp — Interior Design Render</title>
<style>${CSS}</style></head>
<body>
<header>
  <h1>Báo cáo tổ hợp render — <span id="dem">${dong.length}</span>/${dong.length} thẻ</h1>
  <div class="tomtat">
    <b>${xong.length}</b> thành công · <b>${dong.length - xong.length}</b> lỗi ·
    trung bình <b>${tb}s</b>/ảnh · bảng màu <b>Surprise Me</b> (khoá theo tổ hợp nên chạy lại ra đúng màu cũ) ·
    dựng lúc ${new Date().toLocaleString('vi-VN')}
  </div>
  <div class="loc">
    ${nutSpace}
    <button data-nhom="keep" data-gia="1">giữ layout</button>
    <button data-nhom="keep" data-gia="0">tự do</button>
    <button data-nhom="ok" data-gia="1">chỉ OK</button>
    <button data-nhom="ok" data-gia="0">chỉ lỗi</button>
    <input id="tim" placeholder="tìm theo phong cách / loại phòng / màu…">
  </div>
</header>
<main>
${dong.map(theHtml).join('\n')}
<div id="trong" style="display:none">Không có thẻ nào khớp bộ lọc.</div>
</main>
<div id="den"><img alt=""></div>
<script>${JS}</script>
</body></html>`;

  const f = path.join(thuMucRa, 'bao-cao.html');
  fs.writeFileSync(f, html, 'utf8');
  return f;
}

module.exports = { dungHtml };

if (require.main === module) {
  const thuMuc = path.join(__dirname, 'ket-qua');
  const fileJson = path.join(thuMuc, 'bao-cao.json');
  if (!fs.existsSync(fileJson)) {
    console.error(`Chưa có ${fileJson}. Chạy chay-to-hop.js trước.`);
    process.exit(1);
  }
  const dong = JSON.parse(fs.readFileSync(fileJson, 'utf8'));
  console.log('Dựng báo cáo ->', dungHtml(dong, thuMuc, {}));
}
