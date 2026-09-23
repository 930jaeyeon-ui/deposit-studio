#!/usr/bin/env bash
set -Eeuo pipefail
: "${RELEASE_ID:?RELEASE_ID is required}"
: "${WEB_ORIGIN:?WEB_ORIGIN is required}"

archive="/tmp/deposit-studio-api-${RELEASE_ID}.tar.gz"
release_dir="/opt/deposit-studio/releases/${RELEASE_ID}"
test -f "$archive"
test -f /tmp/deposit-studio-api.env
install -m 600 -o root -g root /tmp/deposit-studio-api.env /etc/deposit-studio-api.env
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
EnvironmentFile=/etc/deposit-studio-api.env
Environment=NODE_OPTIONS=--max-old-space-size=384
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=3
MemoryHigh=450M
MemoryMax=550M
OOMPolicy=stop
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
install -d /etc/systemd/system/nginx.service.d
cat >/etc/systemd/system/nginx.service.d/restart.conf <<'EOF'
[Service]
Restart=on-failure
RestartSec=3s
EOF
cat >/etc/systemd/system/deposit-studio-healthcheck.service <<'EOF'
[Unit]
Description=Deposit Studio API local health check
After=deposit-studio-api.service nginx.service

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'for attempt in 1 2 3; do /usr/bin/curl -fsS --max-time 5 http://127.0.0.1/api/health >/dev/null && exit 0; sleep 5; done; /usr/bin/systemctl restart deposit-studio-api nginx; exit 1'
EOF
cat >/etc/systemd/system/deposit-studio-healthcheck.timer <<'EOF'
[Unit]
Description=Check Deposit Studio API every minute

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=10s
Unit=deposit-studio-healthcheck.service

[Install]
WantedBy=timers.target
EOF
cat >/etc/sysctl.d/99-auto-reboot-on-oom.conf <<'EOF'
# Recover the VM if a global OOM escapes the API service memory cgroup.
vm.panic_on_oom = 1
kernel.panic = 10
EOF
sysctl --system >/dev/null
nginx -t
systemctl daemon-reload
# Avoid periodic repository metadata refreshes on the 1 GB Always Free shape.
# dnf-makecache can consume nearly all RAM and swap even when application load
# is idle; packages are installed explicitly during deployment instead.
systemctl disable --now dnf-makecache.timer 2>/dev/null || true
systemctl mask dnf-makecache.timer
systemctl enable deposit-studio-api nginx
systemctl enable --now deposit-studio-healthcheck.timer
systemctl restart deposit-studio-api
systemctl reload nginx
if command -v firewall-cmd >/dev/null; then
  firewall-cmd --permanent --remove-service=http 2>/dev/null || true
  firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="10.0.0.0/24" service name="http" accept'
  firewall-cmd --reload
fi
for attempt in {1..20}; do
  if curl -fsS http://127.0.0.1/api/health >/dev/null; then
    rm -f "$archive" /tmp/deploy-was.sh /tmp/deposit-studio-api.env
    exit 0
  fi
  sleep 1
done
journalctl -u deposit-studio-api --no-pager -n 80
exit 1
