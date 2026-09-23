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
test -x /usr/local/bin/caddy
install -d /etc/caddy
cat >/etc/caddy/Caddyfile <<'EOF'
n9signal.duckdns.org {
  encode zstd gzip

  handle /api/* {
    reverse_proxy 10.0.0.235:80
  }

  handle {
    root * /var/www/deposit-studio/current
    try_files {path} /index.html
    file_server
  }
}
EOF
cat >/etc/systemd/system/caddy.service <<'EOF'
[Unit]
Description=Caddy Web Server
After=network.target
[Service]
Type=simple
User=opc
Group=opc
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
AmbientCapabilities=CAP_NET_BIND_SERVICE
LimitNOFILE=1048576
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
chown -R opc:opc /var/www/deposit-studio
/usr/local/bin/caddy validate --config /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl disable --now deposit-studio-web 2>/dev/null || true
# The Always Free 1 GB web shape cannot safely run Oracle Linux's periodic
# metadata refresh: dnf can consume the whole VM (including swap) and leave
# the guest OS alive but unresponsive. Deployments install no packages here,
# so keep the automatic cache timer disabled and run dnf manually if needed.
systemctl disable --now dnf-makecache.timer 2>/dev/null || true
systemctl mask dnf-makecache.timer
cat >/etc/sysctl.d/99-auto-reboot-on-oom.conf <<'EOF'
# This web tier is stateless. Recover automatically if a future global OOM
# occurs instead of remaining unresponsive while OCI reports it as running.
vm.panic_on_oom = 1
kernel.panic = 10
EOF
sysctl --system >/dev/null
systemctl enable caddy
systemctl restart caddy
if command -v firewall-cmd >/dev/null; then
  firewall-cmd --permanent --add-service=http
  firewall-cmd --permanent --add-service=https
  firewall-cmd --reload
fi
for attempt in {1..20}; do
  if curl -kfsS --resolve n9signal.duckdns.org:443:127.0.0.1 https://n9signal.duckdns.org/ >/dev/null; then
    rm -f "$archive" /tmp/deploy-web.sh
    exit 0
  fi
  sleep 1
done
journalctl -u caddy --no-pager -n 80
exit 1
