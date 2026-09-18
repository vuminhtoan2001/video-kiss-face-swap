/* eslint-disable no-console */
/**
 * Ghép prompt từ các file JSON trong ./json — bản JS của prompt_builder.py.
 *
 * Notebook Interior_Design_Render.ipynb KHÔNG biết SPACE / loại phòng / phong cách /
 * bảng màu. Nó chỉ nhận chuỗi. Toàn bộ việc tra JSON và ghép chuỗi nằm ở đây, nên đổi
 * mô tả một phong cách là sửa JSON rồi chạy lại — không phải mở Colab tải lại 8 GB model.
 *
 *   const { Catalog } = require('./prompt-builder');
 *   const cat = new Catalog();
 *   const { prompt, prompt_2, negative_prompt, negative_prompt_2 } =
 *       cat.build('Interior', 'Phòng khách', 'Peaceful', 'Surprise Me', { keepLayout: true });
 *
 * Vì sao tách prompt làm hai: SDXL có hai text encoder, mỗi cái chỉ nhận 77 token. Nhồi
 * hết vào một chỗ thì diffusers cắt phần cuối mà KHÔNG cảnh báo — mất đúng tag chất
 * lượng nằm ở cuối. Encoder 1 giữ nội dung chính, encoder 2 giữ phần bổ nghĩa.
 */
const fs = require('fs');
const path = require('path');

const THU_MUC_JSON = path.join(__dirname, 'json');
const FILE_CAU_HINH = 'space_config_full.json';

function doc(ten) {
  return JSON.parse(fs.readFileSync(path.join(THU_MUC_JSON, ten), 'utf8'));
}

function danhSach(doc_) {
  return (doc_.data && doc_.data.items) || [];
}

/**
 * Khoá theo `name` đã chuẩn hoá. Vài item trong JSON gốc có khoảng trắng hoặc dấu chấm
 * thừa ("Natural ", "Minimal Nature.") — không trim thì tra sẽ trượt.
 */
function theoTen(items) {
  const m = new Map();
  for (const it of items) m.set(it.name.trim().replace(/\.$/, ''), it);
  return m;
}

/**
 * PRNG có hạt giống (mulberry32). Dùng cho "Surprise Me": cùng hạt giống ra cùng bảng
 * màu, nên chạy lại báo cáo là ra đúng bộ ảnh cũ. Math.random() thì không tái tạo được.
 */
function prng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Băm chuỗi thành số 32 bit — để mỗi tổ hợp có bảng màu khác nhau mà vẫn lặp lại được. */
function bam(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

class Catalog {
  constructor() {
    const cfg = doc(FILE_CAU_HINH);
    this.shared = cfg.data.shared;
    this.spaces = new Map(danhSach(cfg).map((s) => [s.name, s]));
    this.rooms = new Map();
    this.styles = new Map();
    this.colors = new Map();
    for (const [ten, sp] of this.spaces) {
      this.rooms.set(ten, theoTen(danhSach(doc(sp.room_list_file))));
      this.styles.set(ten, theoTen(danhSach(doc(sp.style_list_file))));
      this.colors.set(ten, theoTen(danhSach(doc(sp.color_list_file))));
    }
  }

  tenSpace() {
    return [...this.spaces.keys()];
  }

  /** Rỗng với Garden — nhóm này không có loại, chỉ chọn phong cách và bảng màu. */
  tenPhong(space) {
    return [...this.rooms.get(space).keys()];
  }

  tenStyle(space, { boCustom = true } = {}) {
    return [...this.styles.get(space)].filter(([, it]) => !(boCustom && it.is_custom)).map(([n]) => n);
  }

  tenMau(space, { boRandom = true } = {}) {
    return [...this.colors.get(space)].filter(([, it]) => !(boRandom && it.is_random)).map(([n]) => n);
  }

  /** Item bảng màu theo `key` (vd 'surprise_me') — dùng khi chỉ muốn test một key. */
  mauTheoKey(space, key) {
    for (const [ten, it] of this.colors.get(space)) if (it.key === key) return { ten, it };
    return null;
  }

  /**
   * Trả [tên bảng màu dùng thật, đoạn mô tả màu].
   *
   * null / "Theo style" -> màu mặc định của phong cách.
   * "Surprise Me"       -> random trong CÁC BẢNG CỦA NHÓM ĐÓ, khoá theo hạt giống.
   */
  chonMau(space, color, style, hatGiong = 42) {
    const theoStyle = this.shared.color_by_style_label;
    const nguNhien = this.shared.color_random_label;
    if (color == null || color === '' || color === theoStyle) {
      const st = this.layStyle(space, style);
      return [`${theoStyle} (${style})`, st.prompt_color_default || ''];
    }
    if (color === nguNhien) {
      const pool = this.tenMau(space, { boRandom: true });
      const chon = pool[Math.floor(prng(hatGiong)() * pool.length)];
      return [`${nguNhien} -> ${chon}`, this.colors.get(space).get(chon).prompt];
    }
    const it = this.colors.get(space).get(color);
    if (!it) throw new Error(`Bảng màu '${color}' không có trong ${space}. Hợp lệ: ${this.tenMau(space)}`);
    return [color, it.prompt || ''];
  }

  layStyle(space, style) {
    const it = this.styles.get(space).get(style);
    if (!it) throw new Error(`Style '${style}' không dùng được cho ${space}`);
    return it;
  }

  layPhong(space, room) {
    if (room == null || room === '') return null;
    const it = this.rooms.get(space).get(room);
    if (!it) throw new Error(`'${room}' không thuộc ${space}. Hợp lệ: ${this.tenPhong(space)}`);
    return it;
  }

  /**
   * Ghép params gửi thẳng cho POST /api/c/ai/app/jobs.
   *
   * room = null với Garden (nhóm không có loại) -> dùng default_subject của nhóm.
   * hatGiongMau mặc định băm từ chính tổ hợp, nên mỗi tổ hợp ra một bảng màu khác nhau
   * mà chạy lại vẫn đúng bảng cũ. Truyền số cố định nếu muốn mọi tổ hợp cùng một màu.
   */
  build(space, room, style, color, { keepLayout = true, hatGiongMau = null, promptTuDo = '' } = {}) {
    const sp = this.spaces.get(space);
    if (!sp) throw new Error(`Nhóm '${space}' không hợp lệ. Hợp lệ: ${this.tenSpace()}`);
    const coPhong = this.tenPhong(space).length > 0;
    if (coPhong && !room) throw new Error(`Nhóm ${space} cần chọn loại. Hợp lệ: ${this.tenPhong(space)}`);
    if (!coPhong && room) throw new Error(`Nhóm ${space} không có loại — để room = null`);

    const st = this.layStyle(space, style);
    const rm = this.layPhong(space, room);
    const hat = hatGiongMau == null ? bam(`${space}|${room || ''}|${style}`) : hatGiongMau;
    const [tenMau, moTaMau] = this.chonMau(space, color, style, hat);

    const look = st.prompt || promptTuDo;
    if (!look) throw new Error(`Style '${style}' không có prompt sẵn — cần promptTuDo`);

    let tenEn;
    let hangMuc;
    let mustHave;
    let extra = '';
    let negPhong = '';
    let negDoSai = '';
    let negPhongKhac = '';
    if (rm) {
      tenEn = rm.name_en;
      hangMuc = rm.prompt;
      mustHave = rm.prompt_must_have || hangMuc;
      extra = rm.prompt_extra || '';
      negPhong = rm.negative || '';
      negDoSai = rm.negative_wrong_items || '';
      negPhongKhac = rm.negative_wrong_rooms || '';
    } else {
      tenEn = sp.default_subject_en;
      hangMuc = sp.default_subject_prompt;
      mustHave = hangMuc.split(',').slice(0, 2).map((x) => x.trim()).join(', ');
    }

    // Phong cách vẽ minh hoạ (Cartoon) thì "photorealistic" là phản tác dụng.
    const chatLuong = this.shared.non_photo_styles.includes(style)
      ? this.shared.non_photo_quality
      : sp.prompt_quality;

    // KHÔNG GIAN ĐỨNG ĐẦU: CLIP đánh trọng số token đầu cao hơn hẳn. Để phong cách lên
    // trước thì "bathroom interior" rơi xuống vị trí ~45 và bị phong cách lấn át.
    const chuThe = `${tenEn} ${sp.suffix}`.trim();
    const noi = (...xs) => xs.filter(Boolean).join(', ');

    return {
      prompt: noi(chuThe, hangMuc, look, moTaMau),
      prompt_2: noi(`${tenEn} with ${mustHave}`, extra, sp.prompt_complete, chatLuong),
      negative_prompt: noi(this.shared.negative_base, negPhong, sp.negative_other_space, sp.negative_extra),
      negative_prompt_2: noi(sp.negative_incomplete, negDoSai, negPhongKhac),
      keep_layout: !!keepLayout,
      // đi kèm để đặt tên file và dựng báo cáo; bóc ra trước khi gửi API
      _meta: { space, room: room || null, style, color: tenMau, keep_layout: !!keepLayout },
    };
  }
}

/** Ước lượng TRẦN số token CLIP — cao hơn số thật ~15%, dùng để soi chuỗi nào sắp bị cắt. */
function uocToken(s) {
  return Math.floor(((s.match(/[\w']+|[.,]/g) || []).length * 1.25) + 2);
}

module.exports = { Catalog, uocToken, bam };

if (require.main === module) {
  const cat = new Catalog();
  for (const sp of cat.tenSpace()) {
    console.log(
      `${sp.padEnd(9)}: ${String(cat.tenPhong(sp).length).padStart(2)} loại | ` +
        `${String(cat.tenStyle(sp).length).padStart(2)} style | ${cat.tenMau(sp).length} màu`,
    );
  }
  for (const [sp, rm, st] of [
    ['Interior', 'Phòng khách', 'Peaceful'],
    ['Exterior', 'Biệt thự', 'Mediterranean'],
    ['Garden', null, 'Zen'],
  ]) {
    const b = cat.build(sp, rm, st, 'Surprise Me');
    console.log(`\n[${sp} / ${rm || '—'} / ${st} / ${b._meta.color}]`);
    for (const k of ['prompt', 'prompt_2', 'negative_prompt', 'negative_prompt_2']) {
      console.log(`  ${k.padEnd(18)} (~${uocToken(b[k])} tok): ${b[k]}`);
    }
  }
}
