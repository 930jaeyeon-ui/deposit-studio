#!/usr/bin/env bash
set -Eeuo pipefail
: "${RELEASE_ID:?RELEASE_ID is required}"
: "${WEB_ORIGIN:?WEB_ORIGIN is required}"

archive="/tmp/deposit-studio-api-${RELEASE_ID}.tar.gz"
release_dir="/opt/deposit-studio/releases/${RELEASE_ID}"
test -f "$archive"
install -d -o opc -g opc /opt/deposit-studio/releases /srv/deposit-studio-data
rm -rf "$release_dir"
install -d -o opc -g opc "$release_dir"
tar -xzf "$archive" -C "$release_dir"
chown -R opc:opc "$release_dir"
sudo -u opc bash -lc "cd '$release_dir' && npm ci --omit=dev"
ln -sfn "$release_dir" /opt/deposit-studio/current-next
mv -Tf /opt/deposit-studio/current-next /opt/deposit-studio/current

cat >/etc/systemd/system/deposit-studio-api.service <<EOF
[Unit]
Description=Deposit Studio API
After=network.target srv-deposit\\x2dstudio\\x2ddata.mount
[Service]
Type=simple
User=opc
WorkingDirectory=/opt/deposit-studio/current/apps/api
Environment=HOST=127.0.0.1
Environment=PORT=3001
Environment=NODE_ENV=production
Environment=WEB_ORIGIN=${WEB_ORIGIN}
Environment=TURSO_DATABASE_URL=file:/srv/deposit-studio-data/deposit-studio.db
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
cat >/etc/nginx/conf.d/deposit-studio-api.conf <<'EOF'
server {
  listen 80 default_server;
  server_name _;
  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
  }
}
EOF
nginx -t
systemctl daemon-reload
systemctl enable deposit-studio-api nginx
systemctl restart deposit-studio-api
systemctl reload nginx
for attempt in {1..20}; do
  if curl -fsS http://127.0.0.1/api/health >/dev/null; then
    rm -f "$archive" /tmp/deploy-was.sh
    exit 0
  fi
  sleep 1
done
journalctl -u deposit-studio-api --no-pager -n 80
exit 1
