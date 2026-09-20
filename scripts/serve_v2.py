"""Local-only V2 preview. Does not expose original folders, keys, or other project files."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit, unquote
import argparse

ROOT = Path(__file__).resolve().parents[1]
ALLOWED = {'catalog.json', 'dem.tif', 'lst.tif', 'basemap.tif', 'buildings.geojson', 'boundary.geojson', 'weather.epw'}

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        host=self.headers.get('Host','').split(':')[0]
        if host not in ('127.0.0.1','localhost'):
            self.send_error(403,'Local preview only')
            return
        super().do_GET()

    def translate_path(self, path):
        clean = unquote(urlsplit(path).path)
        if clean.startswith('/v2-data/'):
            name = clean[len('/v2-data/'):]
            return str(ROOT / 'data/v2/shatou' / name) if name in ALLOWED else str(ROOT / 'dist/__not_found__')
        parts = Path(clean.lstrip('/'))
        if '..' in parts.parts or ':' in clean or '\\' in clean:
            return str(ROOT / 'dist/__not_found__')
        return str(ROOT / 'dist' / parts)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args()
    print(f'GeoCIM V2: http://127.0.0.1:{args.port}/v2.html', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
