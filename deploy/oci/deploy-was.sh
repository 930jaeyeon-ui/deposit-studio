#!/usr/bin/env bash
set -Eeuo pipefail
: "${RELEASE_ID:?RELEASE_ID is required}"
: "${WEB_ORIGIN:?WEB_ORIGIN is required}"

archive="/tmp/deposit-studio-api-${RELEASE_ID}.tar.gz"
release_dir="/opt/deposit-studio/releases/${RELEASE_ID}"
active_file="/opt/deposit-studio/active-slot"
nginx_config="/etc/nginx/conf.d/deposit-studio-api.conf"
nginx_backup="$(mktemp /tmp/deposit-studio-nginx.XXXXXX)"
switched=0
new_slot=""

cleanup() { rm -f "$nginx_backup"; }
rollback() {
  status=$?
  if [ "$switched" -eq 1 ] && [ -s "$nginx_backup" ]; then
    cp "$nginx_backup" "$nginx_config"
    nginx -t && systemctl reload nginx || true
  fi
  if [ -n "$new_slot" ]; then systemctl stop "deposit-studio-api@${new_slot}.service" || true; fi
  cleanup
  exit "$status"
}
trap rollback ERR
trap cleanup EXIT

test -f "$archive"
test -f /tmp/deposit-studio-api.env
if [ -f "$nginx_config" ]; then cp "$nginx_config" "$nginx_backup"; fi

install -m 600 -o root -g root /tmp/deposit-studio-api.env /etc/deposit-studio-api.env
install -d -o opc -g opc /opt/deposit-studio/releases /opt/deposit-studio/backups /opt/deposit-studio/slots /srv/deposit-studio-data
rm -rf "$release_dir"
install -d -o opc -g opc "$release_dir"
tar -xzf "$archive" -C "$release_dir"
chown -R opc:opc "$release_dir"
sudo -u opc bash -lc "cd '$release_dir' && npm ci --omit=dev"

# Keep a consistent pre-migration snapshot. Never restore it automatically:
# doing so could erase writes accepted by the still-running old process.
if [ -e /srv/deposit-studio-data/deposit-studio.db ] && [ -d /opt/deposit-studio/current/node_modules/@libsql ]; then
  backup="/opt/deposit-studio/backups/deposit-studio-${RELEASE_ID}.db"
  sudo -u opc bash -lc "cd /opt/deposit-studio/current && TURSO_DATABASE_URL='file:/srv/deposit-studio-data/deposit-studio.db' BACKUP_FILE='$backup' node --input-type=module -e \"import { createClient } from '@libsql/client'; const db=createClient({url:process.env.TURSO_DATABASE_URL}); const target=process.env.BACKUP_FILE.replaceAll(\\\"'\\\",\\\"''\\\"); await db.execute(\\\"VACUUM INTO '\\\" + target + \\\"'\\\"); await db.close();\""
  find /opt/deposit-studio/backups -type f -name 'deposit-studio-*.db' -printf '%T@ %p\n' | sort -nr | tail -n +6 | cut -d' ' -f2- | xargs -r rm -f
fi

active_slot="$(cat "$active_file" 2>/dev/null || printf legacy)"
case "$active_slot" in
  blue) new_slot=green; new_port=3002 ;;
  green) new_slot=blue; new_port=3001 ;;
  legacy) new_slot=green; new_port=3002 ;;
  *) echo "Unknown active slot: $active_slot" >&2; exit 1 ;;
esac

# Starting a second Node process while the old slot is live needs headroom.
# Abort before touching the active slot when the 1 GB VM is already pressured.
mem_available_kb="$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo)"
swap_free_kb="$(awk '/^SwapFree:/ { print $2 }' /proc/meminfo)"
if [ "${mem_available_kb:-0}" -lt 256000 ]; then
  echo "Insufficient memory for zero-downtime deployment: MemAvailable=${mem_available_kb:-0}kB (required: 256000kB)" >&2
  exit 1
fi
if [ "${swap_free_kb:-0}" -lt 1048576 ]; then
  echo "Insufficient swap for zero-downtime deployment: SwapFree=${swap_free_kb:-0}kB (required: 1048576kB)" >&2
  exit 1
fi

ln -sfn "$release_dir" "/opt/deposit-studio/slots/${new_slot}-next"
mv -Tf "/opt/deposit-studio/slots/${new_slot}-next" "/opt/deposit-studio/slots/${new_slot}"

cat >/etc/systemd/system/deposit-studio-api@.service <<EOF
[Unit]
Description=Deposit Studio API (%i)
After=network.target srv-deposit\\x2dstudio\\x2ddata.mount
[Service]
Type=simple
User=opc
WorkingDirectory=/opt/deposit-studio/slots/%i/apps/api
Environment=HOST=127.0.0.1
Environment=NODE_ENV=production
Environment=WEB_ORIGIN=${WEB_ORIGIN}
Environment=TURSO_DATABASE_URL=file:/srv/deposit-studio-data/deposit-studio.db
Environment=NODE_OPTIONS=--max-old-space-size=384
EnvironmentFile=/etc/deposit-studio-api.env
EnvironmentFile=/etc/deposit-studio-api-%i.env
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=3
KillSignal=SIGTERM
TimeoutStopSec=35
MemoryHigh=450M
MemoryMax=550M
OOMPolicy=stop
[Install]
WantedBy=multi-user.target
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
After=nginx.service

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'for attempt in 1 2 3; do /usr/bin/curl -fsS --max-time 5 http://127.0.0.1/api/health >/dev/null && exit 0; sleep 5; done; slot=$(/usr/bin/cat /opt/deposit-studio/active-slot); /usr/bin/systemctl restart "deposit-studio-api@${slot}.service" nginx; exit 1'
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
systemctl disable --now dnf-makecache.timer 2>/dev/null || true
systemctl mask dnf-makecache.timer
cat >"/etc/deposit-studio-api-${new_slot}.env" <<EOF
PORT=${new_port}
START_EXTERNAL_CONNECTIONS=false
EOF
chmod 600 "/etc/deposit-studio-api-${new_slot}.env"

systemctl daemon-reload
systemctl enable nginx
systemctl enable --now deposit-studio-healthcheck.timer
systemctl enable "deposit-studio-api@${new_slot}.service"
systemctl restart "deposit-studio-api@${new_slot}.service"
for attempt in {1..30}; do
  if curl -fsS --max-time 3 "http://127.0.0.1:${new_port}/api/health" >/dev/null; then break; fi
  if [ "$attempt" -eq 30 ]; then
    journalctl -u "deposit-studio-api@${new_slot}.service" --no-pager -n 100
    exit 1
  fi
  sleep 1
done

cat >"${nginx_config}.new" <<EOF
server {
  listen 80 default_server;
  server_name _;
  location / {
    proxy_pass http://127.0.0.1:${new_port};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
  }
}
EOF
mv -f "${nginx_config}.new" "$nginx_config"
switched=1
nginx -t
systemctl reload nginx
curl -fsS --max-time 5 http://127.0.0.1/api/health >/dev/null

# Start the new singleton listeners while rollback is still possible. The old
# listeners overlap only for the few commands needed to commit the slot state.
systemctl kill -s SIGUSR2 "deposit-studio-api@${new_slot}.service"
cat >"/etc/deposit-studio-api-${new_slot}.env" <<EOF
PORT=${new_port}
START_EXTERNAL_CONNECTIONS=true
EOF
chmod 600 "/etc/deposit-studio-api-${new_slot}.env"
printf '%s\n' "$new_slot" >"${active_file}.new"
mv -f "${active_file}.new" "$active_file"
ln -sfn "$release_dir" /opt/deposit-studio/current-next
mv -Tf /opt/deposit-studio/current-next /opt/deposit-studio/current
switched=0
# From here the new slot is committed. A cleanup failure must never stop the
# process Nginx is already serving.
trap - ERR

if [ "$active_slot" = legacy ]; then
  systemctl stop deposit-studio-api.service || true
else
  systemctl stop "deposit-studio-api@${active_slot}.service" || true
fi

if [ "$active_slot" = legacy ]; then
  systemctl disable deposit-studio-api.service 2>/dev/null || true
else
  systemctl disable "deposit-studio-api@${active_slot}.service" 2>/dev/null || true
fi
if command -v firewall-cmd >/dev/null; then
  firewall-cmd --permanent --remove-service=http 2>/dev/null || true
  firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="10.0.0.0/24" service name="http" accept'
  firewall-cmd --reload
fi
rm -f "$archive" /tmp/deploy-was.sh /tmp/deposit-studio-api.env
