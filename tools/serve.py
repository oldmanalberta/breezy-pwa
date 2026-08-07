"""Local dev server for Breezy.

Python's stock `http.server` sends no cache-control headers, so browsers apply
heuristic caching and happily serve a stale ES module after you've edited it —
which shows up as a baffling "does not provide an export named ..." error even
though the file on disk is correct. This sends no-store on everything and adds
the couple of MIME types the stock server gets wrong.

    python tools/serve.py [port]
"""

import functools
import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8712


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "application/javascript",
        ".mjs": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # keep the console readable; only surface failures
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    handler = functools.partial(Handler, directory=ROOT)
    with Server(("", PORT), handler) as httpd:
        print(f"Breezy dev server on http://localhost:{PORT}  (no-store, serving {ROOT})")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")
