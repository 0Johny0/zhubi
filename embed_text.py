#!/usr/bin/env python3
"""
embed_text.py — 将校对文本写入扫描 PDF（生成可搜索 PDF）

用法：
    python embed_text.py 原始.pdf 校对数据.json 输出.pdf
    python embed_text.py 原始.pdf 校对数据.json 输出.pdf --font /path/to/font.ttf

依赖：
    pip install reportlab pypdf
"""

import sys, json, io, os, platform


def find_fonts():
    s = platform.system()
    if s == 'Darwin':
        return ['/System/Library/Fonts/PingFang.ttc',
                '/System/Library/Fonts/STHeiti Light.ttc',
                '/System/Library/Fonts/Hiragino Sans GB.ttc']
    if s == 'Linux':
        return ['/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
                '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
                '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
                '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
                '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc']
    return ['C:/Windows/Fonts/msyh.ttc',
            'C:/Windows/Fonts/simsun.ttc',
            'C:/Windows/Fonts/simhei.ttf']


def main():
    if len(sys.argv) < 4:
        print(__doc__); sys.exit(1)

    pdf_path, json_path, output_path = sys.argv[1], sys.argv[2], sys.argv[3]
    custom_font = sys.argv[5] if len(sys.argv) > 5 and sys.argv[4] == '--font' else None

    from reportlab.pdfgen import canvas
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from pypdf import PdfReader, PdfWriter

    font_name = 'ZhFont'
    candidates = [custom_font] if custom_font else find_fonts()
    candidates.append('NotoSansSC-Regular.ttf')

    for fp in candidates:
        if not fp or not os.path.exists(fp):
            continue
        try:
            pdfmetrics.registerFont(TTFont(font_name, fp))
            print(f'Font: {fp}')
            break
        except Exception:
            continue
    else:
        print('No CJK font found.')
        print('  Ubuntu: sudo apt install fonts-noto-cjk')
        print('  Or: python embed_text.py ... --font /path/to/font.ttf')
        sys.exit(1)

    with open(json_path, 'r', encoding='utf-8') as f:
        text_data = json.load(f)
    print(f'Pages: {len(text_data)}')

    reader = PdfReader(pdf_path)
    writer = PdfWriter()
    done = 0

    for i, page in enumerate(reader.pages):
        pn = str(i + 1)
        if pn in text_data and text_data[pn].strip():
            mb = page.mediabox
            w, h = float(mb.width), float(mb.height)

            lines = text_data[pn].split('\n')
            fs = min(12, (h - 80) / max(len(lines), 1) / 2.0)
            fs = max(6, fs)
            lh = fs * 2.0

            pkt = io.BytesIO()
            c = canvas.Canvas(pkt, pagesize=(w, h))
            c.setFont(font_name, fs)

            y = h - 40
            max_chars = int((w - 80) / fs * 1.6)

            for line in lines:
                if y < 30:
                    break
                s = line.strip()
                if not s:
                    y -= lh * 0.4
                    continue
                c.setFillColorRGB(0, 0, 0, alpha=0)
                while len(s) > max_chars:
                    c.drawString(40, y, s[:max_chars])
                    s = s[max_chars:]
                    y -= lh
                    if y < 30:
                        break
                if y >= 30 and s:
                    c.drawString(40, y, s)
                y -= lh

            c.save()
            pkt.seek(0)
            try:
                page.merge_page(PdfReader(pkt).pages[0])
                done += 1
            except Exception as e:
                print(f'  Page {i+1}: {e}')

        writer.add_page(page)

    with open(output_path, 'wb') as f:
        writer.write(f)

    size_mb = os.path.getsize(output_path) / 1048576
    print(f'Done: {done}/{len(reader.pages)} pages, {size_mb:.1f} MB -> {output_path}')


if __name__ == '__main__':
    main()
