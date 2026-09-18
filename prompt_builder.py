# -*- coding: utf-8 -*-
"""Ghép prompt từ 9 file JSON, dùng chung cho giao diện và script test.

Notebook Interior_Design_Render.ipynb KHÔNG biết SPACE / room type / style / color —
nó chỉ nhận chuỗi prompt. Toàn bộ việc tra JSON và ghép chuỗi nằm ở đây, nên đổi mô tả
một style là sửa JSON rồi gọi lại, không phải chạy lại notebook.

    from prompt_builder import Catalog
    cat = Catalog()                       # đọc 9 file JSON cùng thư mục
    body = cat.build("Interior", "Phòng khách", "Peaceful", "Cozy Beige", keep_layout=True)
    # -> {"prompt": ..., "prompt_2": ..., "negative_prompt": ..., "negative_prompt_2": ...,
    #     "keep_layout": True}
    requests.post(url + "/generate/interior_design", json={**body, "anh_url": ...})

Vì sao tách prompt làm hai: SDXL có hai text encoder, mỗi cái chỉ nhận 77 token. Nhồi
hết vào một chỗ thì diffusers cắt phần cuối — mất đúng quality tag nằm ở cuối. Encoder 1
giữ nội dung chính (không gian + hạng mục + style + màu), encoder 2 giữ phần bổ nghĩa.
"""
from __future__ import annotations

import json
import os
import random
from typing import Optional

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = 'space_config_full.json'


def _load(path: str) -> dict:
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def _items(doc: dict) -> list:
    return doc.get('data', {}).get('items', [])


def _by_name(items: list) -> dict:
    """Khoá theo name đã trim. Vài item trong JSON có khoảng trắng / dấu chấm thừa
    ("Natural ", "Minimal Nature.") nên phải chuẩn hoá, nếu không tra sẽ trượt."""
    return {it['name'].strip().rstrip('.'): it for it in items}


class Catalog:
    """Đọc toàn bộ JSON một lần, tra nhanh, và ghép prompt."""

    def __init__(self, thu_muc: str = HERE):
        self.dir = thu_muc
        cfg = _load(os.path.join(thu_muc, CONFIG_FILE))
        self.shared = cfg['data']['shared']
        self.spaces = {s['name']: s for s in _items(cfg)}
        self.rooms, self.styles, self.colors = {}, {}, {}
        for ten, sp in self.spaces.items():
            self.rooms[ten] = _by_name(_items(_load(os.path.join(thu_muc, sp['room_list_file']))))
            self.styles[ten] = _by_name(_items(_load(os.path.join(thu_muc, sp['style_list_file']))))
            self.colors[ten] = _by_name(_items(_load(os.path.join(thu_muc, sp['color_list_file']))))

    # ---------------------------------------------------------------- tra cứu
    def space_names(self) -> list:
        return list(self.spaces)

    def room_names(self, space: str) -> list:
        """Rỗng với Garden — nhóm này không có loại, chỉ chọn style và màu."""
        return list(self.rooms[space])

    def style_names(self, space: str, bo_custom: bool = True) -> list:
        return [n for n, it in self.styles[space].items()
                if not (bo_custom and it.get('is_custom'))]

    def color_names(self, space: str, bo_random: bool = True) -> list:
        return [n for n, it in self.colors[space].items()
                if not (bo_random and it.get('is_random'))]

    # ---------------------------------------------------------------- ghép prompt
    def resolve_color(self, space: str, color: Optional[str], style: str,
                      seed: Optional[int] = None) -> tuple:
        """Trả về (tên bảng màu dùng thật, đoạn mô tả màu).

        color None / "Theo style" -> lấy màu mặc định của style.
        "Surprise Me" -> random trong CÁC BẢNG CỦA NHÓM ĐÓ, khoá theo seed nên cùng
        seed ra cùng màu; không khoá thì không tái tạo lại được ảnh vừa ưng.
        """
        theo_style = self.shared['color_by_style_label']
        ngau_nhien = self.shared['color_random_label']
        if color in (None, '', theo_style):
            st = self._style(space, style)
            return f'{theo_style} ({style})', st.get('prompt_color_default') or ''
        if color == ngau_nhien:
            pool = self.color_names(space, bo_random=True)
            picked = random.Random(seed).choice(pool)
            return f'{ngau_nhien} -> {picked}', self.colors[space][picked]['prompt']
        it = self.colors[space].get(color)
        if it is None:
            raise KeyError(f"Bảng màu '{color}' không có trong {space}. "
                           f"Hợp lệ: {self.color_names(space)}")
        return color, it['prompt'] or ''

    def _style(self, space: str, style: str) -> dict:
        it = self.styles[space].get(style)
        if it is None:
            raise KeyError(f"Style '{style}' không dùng được cho {space}. "
                           f"Hợp lệ: {self.style_names(space)}")
        return it

    def _room(self, space: str, room: Optional[str]) -> Optional[dict]:
        if room in (None, ''):
            return None
        it = self.rooms[space].get(room)
        if it is None:
            raise KeyError(f"'{room}' không thuộc {space}. Hợp lệ: {self.room_names(space)}")
        return it

    def build(self, space: str, room: Optional[str], style: str,
              color: Optional[str] = None, keep_layout: bool = True,
              seed: Optional[int] = None, custom_style_prompt: str = '') -> dict:
        """Ghép thân JSON gửi thẳng cho POST /generate/interior_design.

        room để None với Garden (nhóm không có loại) -> dùng default_subject của nhóm.
        custom_style_prompt: dùng khi chọn style "Customize" (ô nhập tự do trên UI).
        """
        if space not in self.spaces:
            raise KeyError(f"Nhóm '{space}' không hợp lệ. Hợp lệ: {self.space_names()}")
        sp = self.spaces[space]
        if self.room_names(space) and room in (None, ''):
            raise ValueError(f'Nhóm {space} cần chọn loại. Hợp lệ: {self.room_names(space)}')
        if not self.room_names(space) and room not in (None, ''):
            raise ValueError(f'Nhóm {space} không có loại — để room = None')

        st = self._style(space, style)
        rm = self._room(space, room)
        ten_mau, mo_ta_mau = self.resolve_color(space, color, style, seed)

        look = st.get('prompt') or custom_style_prompt
        if not look:
            raise ValueError(f"Style '{style}' không có prompt sẵn — truyền custom_style_prompt")

        # Chủ thể: loại cụ thể nếu có, không thì default_subject của nhóm.
        if rm:
            ten_en, hang_muc = rm['name_en'], rm['prompt']
            must_have = rm.get('prompt_must_have') or hang_muc
            extra = rm.get('prompt_extra') or ''
            neg_room = rm.get('negative') or ''
            neg_items = rm.get('negative_wrong_items') or ''
            neg_rooms = rm.get('negative_wrong_rooms') or ''
        else:
            ten_en, hang_muc = sp['default_subject_en'], sp['default_subject_prompt']
            must_have = ', '.join(x.strip() for x in hang_muc.split(',')[:2])
            extra = neg_room = neg_items = neg_rooms = ''

        # Style vẽ minh hoạ (Cartoon) thì "photorealistic" là phản tác dụng.
        quality = (self.shared['non_photo_quality']
                   if style in self.shared['non_photo_styles'] else sp['prompt_quality'])

        # KHÔNG GIAN ĐỨNG ĐẦU: CLIP đánh trọng số token đầu cao hơn hẳn, để style lên
        # trước thì "bathroom interior" rơi xuống vị trí ~45 và bị style lấn.
        chu_the = f"{ten_en} {sp['suffix']}".strip()
        prompt = ', '.join(x for x in (chu_the, hang_muc, look, mo_ta_mau) if x)
        prompt_2 = ', '.join(x for x in (f'{ten_en} with {must_have}', extra,
                                         sp['prompt_complete'], quality) if x)
        negative = ', '.join(x for x in (self.shared['negative_base'], neg_room,
                                         sp['negative_other_space'],
                                         sp.get('negative_extra') or '') if x)
        negative_2 = ', '.join(x for x in (sp['negative_incomplete'], neg_items, neg_rooms) if x)

        return {'prompt': prompt, 'prompt_2': prompt_2,
                'negative_prompt': negative, 'negative_prompt_2': negative_2,
                'keep_layout': bool(keep_layout),
                # đi kèm để log / đặt tên file, notebook bỏ qua phần meta này
                '_meta': {'space': space, 'room': room, 'style': style,
                          'color': ten_mau, 'keep_layout': bool(keep_layout)}}


def tach_meta(body: dict) -> tuple:
    """Tách _meta ra khỏi thân gửi đi — notebook không cần nó."""
    meta = body.pop('_meta', {})
    return body, meta


if __name__ == '__main__':
    cat = Catalog()
    print('Nhóm:', cat.space_names())
    for sp in cat.space_names():
        print(f'  {sp:9s}: {len(cat.room_names(sp)):2d} loại | '
              f'{len(cat.style_names(sp)):2d} style | {len(cat.color_names(sp)):2d} màu')
    for sp, rm, st, co in [('Interior', 'Phòng khách', 'Peaceful', 'Cozy Beige'),
                           ('Exterior', 'Biệt thự', 'Mediterranean', 'Terra Coast'),
                           ('Garden', None, 'Zen', 'Forest Hues')]:
        b = cat.build(sp, rm, st, co)
        print(f"\n[{sp} / {rm or '—'} / {st} / {co}]")
        for k in ('prompt', 'prompt_2', 'negative_prompt', 'negative_prompt_2'):
            print(f'  {k:18s}: {b[k]}')
