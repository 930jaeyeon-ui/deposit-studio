#!/usr/bin/env bash
set -Eeuo pipefail
: "${RELEASE_ID:?RELEASE_ID is required}"

archive="/tmp/deposit-studio-web-${RELEASE_ID}.tar.gz"
release_dir="/var/www/deposit-studio/releases/${RELEASE_ID}"
test -f "$archive"
install -d /var/www/deposit-studio/releases "$release_dir"
tar -xzf "$archive" -C "$release_dir"
ln -sfn "$release_dir/dist" /var/www/deposit-studio/current-next
mv -Tf /var/www/deposit-studio/current-next /var/www/deposit-studio/current
cat >/usr/local/bin/deposit-studio-web.py <<'PY'
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path('/var/www/deposit-studio/current')

class SpaHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def send_head(self):
        path = ROOT / self.translate_path(self.path).removeprefix(str(ROOT)).lstrip('/')
        if self.path.split('?', 1)[0] != '/' and not path.exists():
            self.path = '/index.html'
        return super().send_head()

ThreadingHTTPServer(('0.0.0.0', 80), SpaHandler).serve_forever()
PY
cat >/etc/systemd/system/deposit-studio-web.service <<'EOF'
[Unit]
Description=Deposit Studio Web
After=network.target
[Service]
Type=simple
User=opc
WorkingDirectory=/var/www/deposit-studio/current
ExecStart=/usr/bin/python3 /usr/local/bin/deposit-studio-web.py
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
chown -R opc:opc /var/www/deposit-studio
systemctl daemon-reload
systemctl enable deposit-studio-web
systemctl restart deposit-studio-web
if command -v firewall-cmd >/dev/null; then
  firewall-cmd --permanent --add-service=http
  firewall-cmd --reload
fi
for attempt in {1..20}; do
  if curl -fsS http://127.0.0.1/ >/dev/null; then
    rm -f "$archive" /tmp/deploy-web.sh
    exit 0
  fi
  sleep 1
done
journalctl -u deposit-studio-web --no-pager -n 80
exit 1
