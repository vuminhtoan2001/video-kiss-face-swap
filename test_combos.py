# -*- coding: utf-8 -*-
"""Sinh tổ hợp từ JSON rồi gọi API của Interior_Design_Render.ipynb.

    # 1. Kiểm khô: ghép thử TOÀN BỘ tổ hợp, không gọi mạng, không tốn GPU
    python test_combos.py --dry-run

    # 2. Render thử 12 tổ hợp ngẫu nhiên
    python test_combos.py --url https://xxx.trycloudflare.com \
        --anh https://example.com/phong.jpg --limit 12

    # 3. Quét hết một nhóm, một style cố định, đủ mọi bảng màu
    python test_combos.py --url ... --anh ... --space Garden --style Zen --all

Chạy tuần tự: GPU trong notebook đã serialize bằng RUN_LOCK nên bắn song song cũng
chỉ xếp hàng, mà lại khó đọc log hơn.
"""
from __future__ import annotations

import argparse
import csv
import itertools
import json
import os
import random
import re
import sys
import time

import requests

from prompt_builder import Catalog, tach_meta

TIMEOUT_POLL = 900        # 1 job ~40-120 s; 15 phút là dư kể cả khi có job xếp hàng trước
NHIP_POLL = 5


def uoc_token(s: str) -> int:
    """Ước lượng TRẦN số token CLIP. Đo trên log thật: con số này cao hơn số token
    thật khoảng 15%, nên vượt 77 ở đây chưa chắc đã bị cắt, nhưng sát 77 thì nên xem lại."""
    return int(len(re.findall(r"[\w']+|[.,]", s)) * 1.25) + 2


def to_hop(cat: Catalog, space=None, room=None, style=None, color=None):
    """Sinh mọi bộ (space, room, style, color) khớp với phần đã ghim."""
    for sp in ([space] if space else cat.space_names()):
        rooms = cat.room_names(sp) or [None]
        if room:
            if room not in rooms:
                continue
            rooms = [room]
        styles = [style] if style else cat.style_names(sp)
        colors = [color] if color else cat.color_names(sp)
        for r, s, c in itertools.product(rooms, styles, colors):
            yield sp, r, s, c


def goi_api(url: str, than: dict, anh: str, timeout=TIMEOUT_POLL) -> dict:
    """POST job, poll tới khi xong, tải ảnh về. Trả dict kết quả."""
    r = requests.post(f'{url}/generate/interior_design',
                      json={**than, 'anh_url': anh}, timeout=60)
    r.raise_for_status()
    jid = r.json()['job_id']
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(NHIP_POLL)
        st = requests.get(f'{url}/jobs/{jid}', timeout=30).json()
        if st['status'] == 'done':
            return {'ok': True, 'job_id': jid, 'giay': st['elapsed'],
                    'so_lieu': st.get('so_lieu') or {}}
        if st['status'] == 'error':
            return {'ok': False, 'job_id': jid, 'giay': st['elapsed'],
                    'loi': f"{st.get('error_type')}: {st.get('error')}",
                    'where': st.get('where')}
    return {'ok': False, 'job_id': jid, 'giay': timeout, 'loi': 'het gio cho'}


def tai_ket_qua(url: str, jid: str, duong: str):
    r = requests.get(f'{url}/jobs/{jid}/result', timeout=300)
    r.raise_for_status()
    with open(duong, 'wb') as f:
        f.write(r.content)
    return len(r.content)


def ten_file(meta: dict, i: int) -> str:
    phan = [str(i).zfill(3), meta['space'], meta.get('room') or 'no-room',
            meta['style'], meta['color'].split('->')[-1].strip(),
            'keep' if meta['keep_layout'] else 'free']
    return re.sub(r'[^A-Za-z0-9._-]+', '-', '_'.join(phan))[:110] + '.jpg'


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--url', help='PUBLIC_URL của notebook (https://xxx.trycloudflare.com)')
    ap.add_argument('--anh', help='URL ảnh gốc để render')
    ap.add_argument('--space'), ap.add_argument('--room')
    ap.add_argument('--style'), ap.add_argument('--color')
    ap.add_argument('--keep-layout', choices=['true', 'false', 'both'], default='true')
    ap.add_argument('--limit', type=int, default=10, help='số tổ hợp lấy ngẫu nhiên (0 = hết)')
    ap.add_argument('--all', action='store_true', help='chạy hết, bỏ qua --limit')
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--out', default='ket_qua_test')
    ap.add_argument('--dry-run', action='store_true',
                    help='chỉ ghép prompt và kiểm token, không gọi API')
    a = ap.parse_args()

    cat = Catalog()
    bo = list(to_hop(cat, a.space, a.room, a.style, a.color))
    keeps = {'true': [True], 'false': [False], 'both': [True, False]}[a.keep_layout]
    bo = [(sp, r, s, c, k) for (sp, r, s, c) in bo for k in keeps]
    print(f'Tổng tổ hợp khớp điều kiện: {len(bo)}')

    if not a.all and a.limit and len(bo) > a.limit:
        random.Random(a.seed).shuffle(bo)
        bo = bo[:a.limit]
        print(f'Lấy ngẫu nhiên {len(bo)} (seed {a.seed}). Dùng --all để chạy hết.')

    # ---------------------------------------------------------------- dry run
    if a.dry_run:
        dai = loi = 0
        for sp, r, s, c, k in bo:
            try:
                than, meta = tach_meta(cat.build(sp, r, s, c, keep_layout=k, seed=a.seed))
            except Exception as e:
                loi += 1
                print(f'  LỖI {sp}/{r}/{s}/{c}: {e}')
                continue
            for khoa in ('prompt', 'prompt_2', 'negative_prompt', 'negative_prompt_2'):
                n = uoc_token(than[khoa])
                if n > 77:
                    dai += 1
                    print(f'  >77 token ({n}) {khoa}: {sp}/{r}/{s}/{c}')
        print(f'\nGhép lỗi: {loi} | chuỗi ước lượng vượt 77 token: {dai} / {len(bo) * 4}')
        return 1 if loi else 0

    if not a.url or not a.anh:
        ap.error('cần --url và --anh (hoặc dùng --dry-run)')

    ver = requests.get(f'{a.url}/version', timeout=30).json()
    print(f"Notebook: {ver['notebook']} {ver['notebook_version']} | "
          f"model_san_sang={ver['models_ready']} | gpu={ver.get('gpu')}")
    if not ver['models_ready']:
        print('CẢNH BÁO: model chưa sẵn sàng, job sẽ lỗi. Xem log cell 5 trong Colab.')

    os.makedirs(a.out, exist_ok=True)
    bao_cao, t0 = [], time.time()
    for i, (sp, r, s, c, k) in enumerate(bo, 1):
        than, meta = tach_meta(cat.build(sp, r, s, c, keep_layout=k, seed=a.seed))
        than['seed'] = a.seed
        than['test_case'] = f"{sp}-{s}"[:48]
        nhan = f"{meta['space']}/{meta.get('room') or '—'}/{meta['style']}/{meta['color']}"
        print(f"[{i}/{len(bo)}] {nhan} keep={k} ...", flush=True)
        kq = goi_api(a.url, than, a.anh)
        dong = {'stt': i, **meta, 'ok': kq['ok'], 'giay': kq.get('giay'),
                'job_id': kq.get('job_id'), 'loi': kq.get('loi', '')}
        if kq['ok']:
            fn = ten_file(meta, i)
            byte = tai_ket_qua(a.url, kq['job_id'], os.path.join(a.out, fn))
            dong['file'] = fn
            dong['kb'] = round(byte / 1024)
            sl = kq.get('so_lieu') or {}
            print(f"      OK {kq['giay']}s -> {fn} ({dong['kb']} KB) "
                  f"{sl.get('kich_thuoc')} line_scale={sl.get('line_scale')}")
        else:
            dong['file'] = ''
            print(f"      LỖI: {kq.get('loi')}")
        bao_cao.append(dong)

    duong_csv = os.path.join(a.out, 'bao_cao.csv')
    with open(duong_csv, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=list(bao_cao[0]))
        w.writeheader()
        w.writerows(bao_cao)
    with open(os.path.join(a.out, 'bao_cao.json'), 'w', encoding='utf-8') as f:
        json.dump(bao_cao, f, ensure_ascii=False, indent=1)

    xong = sum(1 for d in bao_cao if d['ok'])
    print(f'\nXong {xong}/{len(bao_cao)} trong {time.time() - t0:.0f}s. '
          f'Ảnh + báo cáo trong {a.out}/ ({duong_csv})')
    return 0 if xong == len(bao_cao) else 1


if __name__ == '__main__':
    sys.exit(main())
