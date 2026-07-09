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


def shutil_copy(src, dst):
    while True:
        chunk = src.read(65536)
        if not chunk:
            break
        dst.write(chunk)


class Handler(http.server.SimpleHTTPRequestHandler):

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE), **kwargs)

    def do_GET(self):
        if self.path == '/api/status':
            self.send_json(200, {'ok': True, 'dir': str(DATA.resolve())})
        elif self.path == '/api/files':
            self.handle_file_list()
        elif self.path.startswith('/api/progress'):
            self.handle_progress()
        elif self.path.startswith('/data/') and '.pdf' in self.path.lower():
            from urllib.parse import unquote
            fname = unquote(self.path.split('/data/')[1].split('?')[0])
            fpath = DATA / fname
            if fpath.exists():
                self.send_response(200)
                self.send_header('Content-Type', 'application/pdf')
                self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
                self.send_header('Pragma', 'no-cache')
                self.send_header('Expires', '0')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Length', str(fpath.stat().st_size))
                self.end_headers()
                with open(fpath, 'rb') as f:
                    shutil_copy(f, self.wfile)
            else:
                self.send_error(404, 'File not found')
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

    def handle_file_list(self):
        files = []
        try:
            for f in sorted(DATA.iterdir()):
                if f.suffix.lower() == '.pdf' and f.is_file():
                    stat = f.stat()
                    files.append({'name': f.name, 'size': round(stat.st_size / 1048576, 1), 'mtime': int(stat.st_mtime)})
        except Exception as e:
            self.send_json(500, {'error': str(e)}); return
        self.send_json(200, {'files': files, 'dir': str(DATA.resolve())})

    def handle_progress(self):
        progs = list(DATA.glob('*_progress.json'))
        if not progs:
            self.send_json(200, {'done': 0, 'total': 0, 'finished': True}); return
        prog = max(progs, key=lambda p: p.stat().st_mtime)
        try:
            with open(prog, 'r') as f:
                data = json.load(f)
            self.send_json(200, data)
        except Exception:
            self.send_json(200, {'done': 0, 'total': 0, 'finished': True})

    def handle_upload(self):
        name = parse_qs(urlparse(self.path).query).get('name', ['file.pdf'])[0]
        name = Path(name).name
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        path = DATA / name
        with open(path, 'wb') as f:
            f.write(body)
        print(f'[zhubi] Upload: {name} ({length} bytes)')
        self.send_json(200, {'ok': True, 'name': name, 'size': len(body)})

    def handle_save(self):
        length = int(self.headers.get('Content-Length', 0))
        try:
            req = json.loads(self.rfile.read(length))
        except Exception:
            self.send_json(400, {'error': 'Invalid JSON'}); return

        name = Path(req.get('name', '')).name
        pages = req.get('pages', {})
        layouts = req.get('layouts', {})

        print(f'[zhubi] Save: name="{name}", pages={len(pages)}, layouts={len(layouts)}')

        if not name or not pages:
            self.send_json(400, {'error': 'Missing data'}); return

        pdf_path = DATA / name
        if not pdf_path.exists():
            self.send_json(404, {'error': f'PDF not found: {name}'}); return

        base = Path(name).stem

        # 保存含布局的 JSON
        embed_data = {'pages': pages, 'layouts': layouts}
        json_path = DATA / f'{base}_embed.json'
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(embed_data, f, ensure_ascii=False)

        # 进度文件
        progress_path = DATA / f'{base}_progress.json'
        with open(progress_path, 'w') as f:
            json.dump({'done': 0, 'total': len(pages), 'finished': False}, f)

        print(f'[zhubi] Embedding: {len(pages)} pages -> {name}')

        out_path = DATA / f'{base}_embedded.pdf'
        embed = BASE / 'embed_text.py'
        cmd = [sys.executable, str(embed), str(pdf_path), str(json_path), str(out_path), '--progress', str(progress_path)]

        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=600, cwd=str(BASE))
            if r.stdout:
                for line in r.stdout.strip().split('\n'):
                    print(f'[zhubi]   {line}')
            if r.stderr:
                for line in r.stderr.strip().split('\n')[-3:]:
                    print(f'[zhubi]   ERR: {line}')
            if r.returncode != 0:
                error = r.stderr.strip() or r.stdout.strip() or 'Unknown error'
                self.send_json(500, {'error': error}); return
        except subprocess.TimeoutExpired:
            self.send_json(500, {'error': 'Timeout (600s)'}); return
        except Exception as e:
            self.send_json(500, {'error': str(e)}); return

        if not out_path.exists():
            self.send_json(500, {'error': 'Output not created'}); return

        shutil.copy2(out_path, pdf_path)
        out_path.unlink()
        if json_path.exists(): json_path.unlink()
        if progress_path.exists(): progress_path.unlink()

        size_mb = pdf_path.stat().st_size / 1048576
        print(f'[zhubi] Done: {name} ({size_mb:.1f} MB)')
        self.send_json(200, {'ok': True, 'url': f'/data/{name}'})

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
    pdfs = list(DATA.glob('*.pdf'))
    if pdfs:
        print(f'[zhubi] Found {len(pdfs)} PDF(s):')
        for p in sorted(pdfs):
            print(f'[zhubi]   {p.name} ({p.stat().st_size / 1048576:.1f} MB)')
    httpd = http.server.HTTPServer(('0.0.0.0', PORT), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\n[zhubi] stopped')
