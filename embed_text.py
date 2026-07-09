#!/usr/bin/env python3
"""
embed_text.py — 将校对文本写入扫描 PDF（生成可搜索 PDF）
"""

import sys, json, io, os, platform, subprocess, traceback


def find_fonts():
    s = platform.system()
    if s == 'Darwin':
        return ['/System/Library/Fonts/PingFang.ttc',
                '/System/Library/Fonts/STHeiti Light.ttc',
                '/System/Library/Fonts/Hiragino Sans GB.ttc']
    if s == 'Linux':
        # 先用 fc-list 找系统已安装的中文字体
        try:
            r = subprocess.run(
                ['fc-list', ':lang=zh', 'file'],
                capture_output=True, text=True, timeout=5
            )
            if r.returncode == 0 and r.stdout.strip():
                found = []
                for line in r.stdout.strip().split('\n'):
                    fp = line.split(':')[0].strip()
                    if fp and os.path.exists(fp):
                        found.append(fp)
                if found:
                    print(f'fc-list found {len(found)} CJK fonts')
                    return found
        except Exception:
            pass

        # fc-list 失败则硬编码常见路径
        return [
            '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
            '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
            '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
            '/usr/share/fonts/truetype/noto/NotoSansCJKsc-Regular.otf',
            '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf',
            '/usr/share/fonts/noto-cjk/NotoSansCJKsc-Regular.otf',
            '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
            '/usr/share/fonts/wqy-microhei/wqy-microhei.ttc',
            '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
            '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc',
        ]

    return ['C:/Windows/Fonts/msyh.ttc',
            'C:/Windows/Fonts/simsun.ttc',
            'C:/Windows/Fonts/simhei.ttf']


def main():
    if len(sys.argv) < 4:
        print('Usage: embed_text.py <input.pdf> <pages.json> <output.pdf>', file=sys.stderr)
        sys.exit(1)

    pdf_path, json_path, output_path = sys.argv[1], sys.argv[2], sys.argv[3]

    print(f'Input PDF: {pdf_path}')
    print(f'JSON:      {json_path}')
    print(f'Output:    {output_path}')

    if not os.path.exists(pdf_path):
        print(f'ERROR: PDF not found: {pdf_path}', file=sys.stderr)
        sys.exit(1)
    if not os.path.exists(json_path):
        print(f'ERROR: JSON not found: {json_path}', file=sys.stderr)
        sys.exit(1)

    try:
        from reportlab.pdfgen import canvas
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from pypdf import PdfReader, PdfWriter
    except ImportError as e:
        print(f'ERROR: Missing dependency: {e}', file=sys.stderr)
        print('Install: pip install reportlab pypdf', file=sys.stderr)
        sys.exit(1)

    # 注册字体
    font_name = 'ZhFont'
    font_found = False
    candidates = find_fonts()

    for fp in candidates:
        if not fp or not os.path.exists(fp):
            continue
        try:
            pdfmetrics.registerFont(TTFont(font_name, fp))
            print(f'Font OK: {fp}')
            font_found = True
            break
        except Exception as e:
            print(f'Font skip: {fp} -> {e}')
            continue

    if not font_found:
        print('ERROR: No CJK font found. Install fonts-noto-cjk or pass --font', file=sys.stderr)
        print(f'Searched: {candidates}', file=sys.stderr)
        sys.exit(1)

    with open(json_path, 'r', encoding='utf-8') as f:
        text_data = json.load(f)
    print(f'Pages to embed: {len(text_data)}')

    reader = PdfReader(pdf_path)
    writer = PdfWriter()
    done = 0

    for i, page in enumerate(reader.pages):
        pn = str(i + 1)
        if pn in text_data and text_data[pn].strip():
            try:
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
                page.merge_page(PdfReader(pkt).pages[0])
                done += 1
            except Exception as e:
                print(f'  Page {i+1} error: {e}')
                traceback.print_exc()

        writer.add_page(page)

    with open(output_path, 'wb') as f:
        writer.write(f)

    size_mb = os.path.getsize(output_path) / 1048576
    print(f'Done: {done}/{len(reader.pages)} pages, {size_mb:.1f} MB')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f'FATAL: {e}', file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)
