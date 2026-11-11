"""HTTPS-testserver der efterligner www.lectio.dk for udvidelsens content script.

Kør: python3 server.py <fixturedir> <port>
Logger alle forespørgsler til requests.log.
"""
import io, ssl, sys
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from PIL import Image, ImageDraw

FIX = Path(sys.argv[1])
PORT = int(sys.argv[2])
HERE = Path(__file__).parent
LOG = open(HERE / "requests.log", "a", buffering=1)
BROKEN_FULLSIZE = {"1013"}  # fuld størrelse giver 404 -> udvidelsen skal falde tilbage til thumbnail
_cache = {}


def portrait(pid, large):
    key = (pid, large)
    if key not in _cache:
        w, h = (300, 400) if large else (36, 48)
        n = int(pid)
        color = ((n * 67) % 200 + 30, (n * 131) % 200 + 30, (n * 29) % 200 + 30)
        im = Image.new("RGB", (w, h), color)
        d = ImageDraw.Draw(im)
        d.ellipse([w * .3, h * .15, w * .7, h * .5], fill="white")
        d.text((w * .1, h * .8), pid, fill="black")
        buf = io.BytesIO()
        im.save(buf, "JPEG")
        _cache[key] = buf.getvalue()
    return _cache[key]


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        LOG.write(f"{self.headers.get('Host')} {self.path}\n")
        u = urlparse(self.path)
        q = parse_qs(u.query)
        p = u.path
        if p == "/lectio/76/subnav/members.aspx":
            variant = q.get("holdelementid", [""])[0]
            name = {"one": "members_one.html", "empty": "members_empty.html"}.get(variant, "members.html")
            return self.send(200, (FIX / name).read_bytes(), "text/html; charset=utf-8")
        if p == "/lectio/76/forside.aspx":  # matcher ikke manifestet -> ingen knap
            return self.send(200, (FIX / "members.html").read_bytes(), "text/html; charset=utf-8")
        if p == "/lectio/76/GetImage.aspx":
            pid = q.get("pictureid", ["0"])[0]
            large = q.get("fullsize", [""])[0] == "1"
            if large and pid in BROKEN_FULLSIZE:
                return self.send(404, b"not found", "text/plain")
            return self.send(200, portrait(pid, large), "image/jpeg")
        if p.startswith("/lectio/img/defaultfoto"):
            return self.send(200, portrait("0", "large" in p), "image/jpeg")
        return self.send(404, b"", "text/plain")

    def do_POST(self):
        LOG.write(f"POST {self.headers.get('Host')} {self.path}\n")
        self.send(200, b"", "text/plain")


srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(HERE / "cert.pem", HERE / "key.pem")
srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
print("listening", PORT, flush=True)
srv.serve_forever()
