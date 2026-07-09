#!/usr/bin/env python3
"""
server.py — 朱笔校对台本地服务
"""

import http.server, json, os, sys, subprocess, shutil
from pathlib import Path
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get('PORT', 8321))
BASE = Path(__file__).parent
DATA = BASE / 'data'
DATA.mkdir(exist_ok=True)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE), **kwargs)

    def do_GET(self):
        if self.path == '/api/status':
            self.send_json(200, {'ok': True, 'dir': str(DATA.resolve())})
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/upload-pdf'):
            self.handle_upload()
        elif self.path == '/api/save':
            self.handle_save()
        else:
            self.send_error(404)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def handle_upload(self):
        name = parse_qs(urlparse(self.path).query).get('name', ['file.pdf'])[0]
        name = Path(name).name
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        path = DATA / name
        with open(path, 'wb') as f:
            f.write(body)
        self.send_json(200, {'ok': True, 'name': name, 'size': len(body)})

    def handle_save(self):
        length = int(self.headers.get('Content-Length', 0))
        try:
            req = json.loads(self.rfile.read(length))
        except Exception:
            self.send_json(400, {'error': 'Invalid JSON'}); return

        name = Path(req.get('name', '')).name
        pages = req.get('pages', {})
        if not name or not pages:
            self.send_json(400, {'error': 'Missing data'}); return

        pdf_path = DATA / name
        if not pdf_path.exists():
            self.send_json(404, {'error': 'PDF not found'}); return

        base = Path(name).stem

        json_path = DATA / f'{base}_pages.json'
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(pages, f, ensure_ascii=False, indent=2)

        out_path = DATA / f'{base}_embedded.pdf'
        embed = BASE / 'embed_text.py'
        try:
            r = subprocess.run(
                [sys.executable, str(embed), str(pdf_path), str(json_path), str(out_path)],
                capture_output=True, text=True, timeout=300, cwd=str(BASE)
            )
            if r.returncode != 0:
                self.send_json(500, {'error': r.stderr or 'Embed failed', 'log': r.stdout})
                return
        except subprocess.TimeoutExpired:
            self.send_json(500, {'error': 'Timeout'}); return

        shutil.copy2(out_path, pdf_path)
        if out_path.exists():
            out_path.unlink()

        self.send_json(200, {'ok': True, 'url': f'/data/{name}', 'log': r.stdout})

    def send_json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        sys.stderr.write(f"[zhubi] {args[0]}\n")


if __name__ == '__main__':
    print(f'[zhubi] http://0.0.0.0:{PORT}')
    print(f'[zhubi] data: {DATA.resolve()}')
    httpd = http.server.HTTPServer(('0.0.0.0', PORT), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\n[zhubi] stopped')
