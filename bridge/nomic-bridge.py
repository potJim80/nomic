#!/usr/bin/env python3
"""The bridge between the game screen and Claude Code, the Judge.

Serves the game at http://localhost:8787/ and keeps two things:
  - the live state, which the screen POSTs after every change  (~/.config/nomic/state.json)
  - a queue of Judge commands, which judge.py POSTs and the screen polls

No dependencies. Run:  python3 bridge/nomic-bridge.py  [port]
"""
import json, os, sys, threading, time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOME = os.path.expanduser('~/.config/nomic')
os.makedirs(HOME, exist_ok=True)
STATE = os.path.join(HOME, 'state.json')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8787

lock = threading.Condition()
commands = []            # [{seq, action, at}]
judge_present = False
last_state_at = 0

def write_state(data):
    global last_state_at
    tmp = STATE + '.tmp'
    with open(tmp, 'w') as f: json.dump(data, f, indent=1)
    os.replace(tmp, STATE)
    last_state_at = time.time()

def read_state():
    try:
        with open(STATE) as f: return json.load(f)
    except Exception: return None

class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, fmt, *args):
        if '/bridge/' in (args[0] if args else ''): return
        super().log_message(fmt, *args)

    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-store')

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code); self.cors()
        self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def end_headers(self):
        if not self.path.startswith('/bridge/'): self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n) or b'{}')

    def do_GET(self):
        u = urlparse(self.path); q = parse_qs(u.query)
        if u.path == '/bridge/commands':
            # after=-1: just report where the queue is (a fresh screen ignores the backlog).
            # wait=N: hold the request up to N seconds until something new arrives (long-poll).
            after = int(q.get('after', ['0'])[0]); hold = min(float(q.get('wait', ['0'])[0]), 30)
            with lock:
                if after < 0: return self.send_json({'commands': [], 'judge': judge_present, 'seq': commands[-1]['seq'] if commands else 0})
                deadline = time.time() + hold
                while hold and not [c for c in commands if c['seq'] > after] and time.time() < deadline:
                    lock.wait(deadline - time.time())
                out = [c for c in commands if c['seq'] > after]
                return self.send_json({'commands': out, 'judge': judge_present, 'seq': commands[-1]['seq'] if commands else 0})
        if u.path == '/bridge/state':
            return self.send_json({'state': read_state(), 'at': last_state_at})
        if u.path == '/bridge/ping':
            return self.send_json({'ok': True, 'judge': judge_present, 'stateAt': last_state_at})
        return super().do_GET()

    def do_POST(self):
        global judge_present
        u = urlparse(self.path)
        try: data = self.body()
        except Exception: return self.send_json({'error': 'bad json'}, 400)
        if u.path == '/bridge/state':
            write_state(data); return self.send_json({'ok': True})
        if u.path == '/bridge/command':
            with lock:
                seq = (commands[-1]['seq'] + 1) if commands else 1
                commands.append({'seq': seq, 'action': data, 'at': time.time()})
                del commands[:-200]
                lock.notify_all()
            return self.send_json({'ok': True, 'seq': seq})
        if u.path == '/bridge/judge':
            judge_present = bool(data.get('present'))
            with lock:
                seq = (commands[-1]['seq'] + 1) if commands else 1
                commands.append({'seq': seq, 'action': {'type': 'judge', 'present': judge_present, 'name': data.get('name') or 'Claude'}, 'at': time.time()})
                lock.notify_all()
            return self.send_json({'ok': True})
        return self.send_json({'error': 'unknown'}, 404)

if __name__ == '__main__':
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), H)
    print(f'nomic bridge on http://localhost:{PORT}/  (state → {STATE})', flush=True)
    try: srv.serve_forever()
    except KeyboardInterrupt: pass
