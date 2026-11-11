"""Mini-proxy til Firefox-testen: CONNECT www.lectio.dk:443 -> lokal testserver.

Alle andre værter afvises (403), så testbrowseren ikke kan nå internettet.
Kør: python3 proxy.py <proxy-port> <testserver-port>
"""
import socket, sys, threading
from pathlib import Path

PROXY_PORT, TARGET_PORT = int(sys.argv[1]), int(sys.argv[2])
LOG = open(Path(__file__).parent / "proxy.log", "a", buffering=1)


def pipe(a, b):
    try:
        while (d := a.recv(65536)):
            b.sendall(d)
    except OSError:
        pass
    finally:
        for s in (a, b):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


def handle(c):
    try:
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = c.recv(4096)
            if not chunk:
                return c.close()
            head += chunk
        line = head.split(b"\r\n", 1)[0].decode("latin1")
        method, target = line.split(" ")[:2]
        if method == "CONNECT" and target == "www.lectio.dk:443":
            LOG.write(f"OK {target}\n")
            up = socket.create_connection(("127.0.0.1", TARGET_PORT))
            c.sendall(b"HTTP/1.1 200 Connection established\r\n\r\n")
            threading.Thread(target=pipe, args=(c, up), daemon=True).start()
            pipe(up, c)
        else:
            LOG.write(f"AFVIST {method} {target}\n")
            c.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
            c.close()
    except Exception as e:  # noqa: BLE001
        LOG.write(f"FEJL {e}\n")
        c.close()


srv = socket.create_server(("127.0.0.1", PROXY_PORT))
print("proxy", PROXY_PORT, flush=True)
while True:
    conn, _ = srv.accept()
    threading.Thread(target=handle, args=(conn,), daemon=True).start()
