#!/usr/bin/env python3
"""
embed_text.py — 删除旧文字层 + 用旧坐标写入校对文本
"""

import sys, json, io, os, re, platform, subprocess, traceback


def find_fonts():
    s = platform.system()
    if s == 'Linux':
        preferred = ['/usr/share/fonts/zhubi/NotoSansSC-Regular.ttf']
        for fp in preferred:
            if os.path.exists(fp):
                return [fp]
        try:
            r = subprocess.run(['fc-list', ':lang=zh', 'file'], capture_output=True, text=True, timeout=5)
            if r.returncode == 0 and r.stdout.strip():
                ttf_only, ttc_fallback = [], []
                for line in r.stdout.strip().split('\n'):
                    fp = line.split(':')[0].strip()
                    if fp and os.path.exists(fp):
                        (ttf_only if fp.lower().endswith(('.ttf', '.otf')) else ttc_fallback).append(fp)
                return ttf_only if ttf_only else ttc_fallback
        except Exception:
            pass
    if s == 'Darwin':
        return ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Light.ttc']
    return ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simsun.ttc']


def load_font(font_name, fp):
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    if fp.lower().endswith('.ttc'):
        for idx in range(12):
            try:
                pdfmetrics.registerFont(TTFont(font_name, fp, subfontIndex=idx))
                print(f'Font OK: {fp} (sub={idx})')
                return True
            except Exception:
                continue
        print(f'Font FAIL: {fp}')
        return False
    try:
        pdfmetrics.registerFont(TTFont(font_name, fp))
        print(f'Font OK: {fp}')
        return True
    except Exception as e:
        print(f'Font FAIL: {fp} -> {e}')
        return False


def get_line_y_positions(page):
    """提取旧文字层每行的 y 坐标（从上到下排序）"""
    # 方法1: pypdf visitor API
    try:
        raw_y = []
        def visitor(text, cm, tm, font_dict, font_size):
            if text.strip():
                raw_y.append(round(tm[5], 1))
        page.extract_text(visitor_text=visitor)
        if len(raw_y) > 3:
            unique = sorted(set(raw_y), reverse=True)
            return unique
    except Exception:
        pass

    # 方法2: 正则解析 content stream
    try:
        from pypdf.generic import ArrayObject
        contents = page['/Contents']
        streams = []
        if isinstance(contents, ArrayObject):
            for ref in contents:
                try: streams.append(ref.get_object().get_data())
                except: pass
        else:
            obj = contents.get_object() if hasattr(contents, 'get_object') else contents
            try: streams.append(obj.get_data())
            except: pass

        y_set = set()
        for data in streams:
            text = data.decode('latin-1', errors='replace')
            text = re.sub(r'$$[^)]*$$', '', text)
            for m in re.finditer(
                r'[\d.\-]+ +[\d.\-]+ +[\d.\-]+ +[\d.\-]+ +([\d.\-]+) +([\d.\-]+)\s+Tm',
                text
            ):
                try:
                    y = float(m.group(2))
                    if 0 < y < 5000:
                        y_set.add(round(y, 1))
                except ValueError:
                    pass
        return sorted(y_set, reverse=True)
    except Exception:
        return []


def strip_text_from_page(page):
    try:
        contents = page['/Contents']
    except KeyError:
        return
    from pypdf.generic import ArrayObject
    if isinstance(contents, ArrayObject):
        for ref in contents:
            _strip_stream(ref.get_object())
    else:
        obj = contents.get_object() if hasattr(contents, 'get_object') else contents
        _strip_stream(obj)


def _strip_stream(stream):
    try:
        data = stream.get_data()
        text = data.decode('latin-1', errors='replace')
        cleaned = re.sub(r'\bBT\b.*?\bET\b', '', text, flags=re.DOTALL)
        cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
        stream.set_data(cleaned.encode('latin-1'))
    except Exception as e:
        print(f'  Strip warning: {e}')


def main():
    if len(sys.argv) < 4:
        print('Usage: embed_text.py <input.pdf> <pages.json> <output.pdf> [--progress path]', file=sys.stderr)
        sys.exit(1)

    pdf_path, json_path, output_path = sys.argv[1], sys.argv[2], sys.argv[3]

    progress_path = None
    if '--progress' in sys.argv:
        idx = sys.argv.index('--progress')
        if idx + 1 < len(sys.argv):
            progress_path = sys.argv[idx + 1]

    print(f'Input:  {pdf_path}')
    print(f'Output: {output_path}')

    if not os.path.exists(pdf_path):
        print(f'ERROR: PDF not found', file=sys.stderr); sys.exit(1)
    if not os.path.exists(json_path):
        print(f'ERROR: JSON not found', file=sys.stderr); sys.exit(1)

    try:
        from reportlab.pdfgen import canvas
        from pypdf import PdfReader, PdfWriter
    except ImportError as e:
        print(f'ERROR: {e}', file=sys.stderr); sys.exit(1)

    font_name = 'ZhFont'
    candidates = find_fonts()
    font_found = False
    for fp in candidates:
        if fp and os.path.exists(fp) and load_font(font_name, fp):
            font_found = True
            break
    if not font_found:
        print('ERROR: No usable CJK font', file=sys.stderr); sys.exit(1)

    with open(json_path, 'r', encoding='utf-8') as f:
        text_data = json.load(f)
    print(f'Pages to embed: {len(text_data)}')

    def write_progress(done, total, finished=False):
        if not progress_path: return
        try:
            with open(progress_path, 'w') as f:
                json.dump({'done': done, 'total': total, 'finished': finished}, f)
        except Exception:
            pass

    reader = PdfReader(pdf_path)
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)

    total_pages = len(text_data)
    done = 0
    write_progress(0, total_pages)

    for i, page in enumerate(writer.pages):
        pn = str(i + 1)
        if pn in text_data and text_data[pn].strip():
            try:
                mb = page.mediabox
                w, h = float(mb.width), float(mb.height)

                # ① 在删除之前，提取旧层每行的 y 坐标
                old_y = get_line_y_positions(page)
                has_old = len(old_y) > 3

                # ② 删除旧文字层
                strip_text_from_page(page)

                # ③ 用旧坐标放置新文字
                lines = text_data[pn].split('\n')
                non_empty = [l for l in lines if l.strip()]
                fs = min(12, (h - 80) / max(len(non_empty), 1) / 2.0)
                fs = max(6, fs)
                lh = fs * 2.0

                pkt = io.BytesIO()
                c = canvas.Canvas(pkt, pagesize=(w, h))
                c.setFont(font_name, fs)
                max_chars = int((w - 80) / fs * 1.6)

                y_idx = 0  # 旧坐标索引
                for line in lines:
                    s = line.strip()
                    if not s:
                        continue

                    # 确定 y 坐标
                    if has_old and y_idx < len(old_y):
                        y = old_y[y_idx]
                    elif has_old:
                        # 多余的行 → 在最后一行下方递减
                        y = old_y[-1] - (y_idx - len(old_y) + 1) * lh
                    else:
                        # 无旧坐标 → 均匀分布
                        y = h - 40 - y_idx * lh

                    y_idx += 1
                    if y < 20:
                        break

                    c.setFillColorRGB(0, 0, 0, alpha=0)
                    sub_y = y
                    while len(s) > max_chars:
                        c.drawString(40, sub_y, s[:max_chars])
                        s = s[max_chars:]
                        sub_y -= fs * 1.3
                        if sub_y < 20: break
                    if sub_y >= 20 and s:
                        c.drawString(40, sub_y, s)

                c.save()
                pkt.seek(0)
                page.merge_page(PdfReader(pkt).pages[0])
                done += 1

                if done % 10 == 0 or done == total_pages:
                    write_progress(done, total_pages)
                    print(f'  Progress: {done}/{total_pages}')

            except Exception as e:
                print(f'  Page {pn} error: {e}')
                traceback.print_exc()
                done += 1
                if done % 10 == 0:
                    write_progress(done, total_pages)

    # 压缩（安全调用）
    try:
        writer.compress_identical_objects(
            remove_duplicates=True,
            remove_unreferenced=True
        )
        print('Compressed OK')
    except Exception as e:
        print(f'Compress skipped: {e}')

    with open(output_path, 'wb') as f:
        writer.write(f)

    write_progress(total_pages, total_pages, finished=True)

    input_size = os.path.getsize(pdf_path) / 1048576
    output_size = os.path.getsize(output_path) / 1048576
    print(f'Done: {done}/{len(writer.pages)} pages')
    print(f'Size: {input_size:.1f} MB -> {output_size:.1f} MB')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f'FATAL: {e}', file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)
