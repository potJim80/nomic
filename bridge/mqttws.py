"""A minimal MQTT 3.1.1 client over TLS websockets, standard library only.

Enough for the Nomic table: connect, subscribe, publish (QoS 0/1, retain), receive, ping.
Used by judge.py and bot.py so Claude Code can sit at a game running anywhere.
"""
import base64, json, os, socket, ssl, struct, time
from urllib.parse import urlparse

class MQTT:
    def __init__(self, url, client_id=None, keepalive=30, will=None, timeout=10):
        u = urlparse(url)
        self.host, self.port, self.path = u.hostname, u.port or 443, u.path or '/'
        self.client_id = client_id or 'nomic-py-' + base64.b32encode(os.urandom(5)).decode().lower()
        self.keepalive, self.will, self.timeout = keepalive, will, timeout
        self.buf = b''; self.pid = 0; self.last_send = 0; self.sock = None

    # ---- websocket layer ----
    def _ws_connect(self):
        raw = socket.create_connection((self.host, self.port), timeout=self.timeout)
        ctx = ssl.create_default_context()
        self.sock = ctx.wrap_socket(raw, server_hostname=self.host)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (f'GET {self.path} HTTP/1.1\r\nHost: {self.host}:{self.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
               f'Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: mqtt\r\n\r\n')
        self.sock.sendall(req.encode())
        resp = b''
        while b'\r\n\r\n' not in resp:
            chunk = self.sock.recv(4096)
            if not chunk: raise ConnectionError('websocket handshake failed')
            resp += chunk
        head, _, rest = resp.partition(b'\r\n\r\n')
        if b' 101 ' not in head.split(b'\r\n')[0]: raise ConnectionError('websocket refused: ' + head.split(b"\r\n")[0].decode(errors='replace'))
        self.buf = rest

    def _ws_send(self, payload):
        mask = os.urandom(4)
        n = len(payload)
        hdr = bytes([0x82]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack('>H', n) if n < 65536 else bytes([0x80 | 127]) + struct.pack('>Q', n))
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(hdr + mask + masked)
        self.last_send = time.time()

    def _ws_recv_frame(self):
        """Returns one websocket frame's payload (binary/text), handling ping and close."""
        def need(n):
            while len(self.buf) < n:
                chunk = self.sock.recv(65536)
                if not chunk: raise ConnectionError('socket closed')
                self.buf += chunk
        while True:
            need(2)
            b0, b1 = self.buf[0], self.buf[1]
            op, n = b0 & 0x0f, b1 & 0x7f
            off = 2
            if n == 126: need(4); n = struct.unpack('>H', self.buf[2:4])[0]; off = 4
            elif n == 127: need(10); n = struct.unpack('>Q', self.buf[2:10])[0]; off = 10
            need(off + n)
            payload = self.buf[off:off + n]; self.buf = self.buf[off + n:]
            if op == 0x9: self._ws_send_ctl(0xA, payload); continue     # ping → pong
            if op == 0x8: raise ConnectionError('websocket closed by server')
            if op in (0x0, 0x1, 0x2): return payload
    def _ws_send_ctl(self, op, payload=b''):
        mask = os.urandom(4)
        self.sock.sendall(bytes([0x80 | op, 0x80 | len(payload)]) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    # ---- mqtt layer ----
    @staticmethod
    def _str(s): b = s.encode(); return struct.pack('>H', len(b)) + b
    @staticmethod
    def _packet(kind, body):
        rl = b''; n = len(body)
        while True:
            d, n = n % 128, n // 128
            rl += bytes([d | (0x80 if n else 0)])
            if not n: break
        return bytes([kind]) + rl + body

    def connect(self):
        self._ws_connect()
        flags = 0x02 | (0x04 | ((self.will.get('qos', 0) & 3) << 3) | (0x20 if self.will.get('retain') else 0) if self.will else 0)
        body = self._str('MQTT') + bytes([4, flags]) + struct.pack('>H', self.keepalive) + self._str(self.client_id)
        if self.will:
            payload = self.will['payload'] if isinstance(self.will['payload'], bytes) else json.dumps(self.will['payload']).encode()
            body += self._str(self.will['topic']) + struct.pack('>H', len(payload)) + payload
        self._ws_send(self._packet(0x10, body))
        kind, data = self._recv_packet()
        if kind != 0x20 or data[1] != 0: raise ConnectionError(f'mqtt connect refused ({data[1] if len(data) > 1 else "?"})')
        self.mqtt_buf = b''
        return self

    def _recv_packet(self):
        """One MQTT packet (kind, payload); MQTT packets can straddle websocket frames."""
        if not hasattr(self, 'mqtt_buf'): self.mqtt_buf = b''
        while True:
            # try to parse one packet from mqtt_buf
            b = self.mqtt_buf
            if len(b) >= 2:
                n = 0; mult = 1; i = 1; ok = False
                while i < len(b) and i < 5:
                    n += (b[i] & 0x7f) * mult; mult *= 128
                    if not (b[i] & 0x80): ok = True; i += 1; break
                    i += 1
                if ok and len(b) >= i + n:
                    kind, data = b[0], b[i:i + n]
                    self.mqtt_buf = b[i + n:]
                    return kind, data
            self.mqtt_buf += self._ws_recv_frame()

    def subscribe(self, topic, qos=0):
        self.pid = self.pid % 65535 + 1
        self._ws_send(self._packet(0x82, struct.pack('>H', self.pid) + self._str(topic) + bytes([qos])))

    def publish(self, topic, payload, qos=0, retain=False):
        if not isinstance(payload, (bytes, bytearray)): payload = payload.encode() if isinstance(payload, str) else json.dumps(payload).encode()
        body = self._str(topic)
        if qos: self.pid = self.pid % 65535 + 1; body += struct.pack('>H', self.pid)
        self._ws_send(self._packet(0x30 | (qos << 1) | (1 if retain else 0), body + payload))

    def ping(self): self._ws_send(self._packet(0xC0, b''))

    def messages(self, timeout=None):
        """Yields (topic, payload_bytes) until timeout seconds pass with nothing new."""
        end = time.time() + timeout if timeout else None
        while True:
            if time.time() - self.last_send > self.keepalive * 0.6: self.ping()
            remaining = (end - time.time()) if end else None
            if remaining is not None and remaining <= 0: return
            self.sock.settimeout(min(remaining, 5) if remaining is not None else 5)
            try: kind, data = self._recv_packet()
            except (socket.timeout, TimeoutError): continue
            t = kind & 0xF0
            if t == 0x30:
                qos = (kind >> 1) & 3
                tl = struct.unpack('>H', data[:2])[0]; topic = data[2:2 + tl].decode(); off = 2 + tl
                if qos: pid = struct.unpack('>H', data[off:off + 2])[0]; off += 2; self._ws_send(self._packet(0x40, struct.pack('>H', pid)))
                yield topic, data[off:]
            # SUBACK 0x90, PUBACK 0x40, PINGRESP 0xD0: nothing to do

    def close(self):
        try: self._ws_send(self._packet(0xE0, b'')); self.sock.close()
        except Exception: pass
