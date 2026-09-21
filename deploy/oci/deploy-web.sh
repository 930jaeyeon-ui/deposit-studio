#!/usr/bin/env bash
set -Eeuo pipefail
: "${RELEASE_ID:?RELEASE_ID is required}"

archive="/tmp/deposit-studio-web-${RELEASE_ID}.tar.gz"
release_dir="/var/www/deposit-studio/releases/${RELEASE_ID}"
test -f "$archive"
if ! command -v nginx >/dev/null; then
  dnf --disablerepo=ol9_oci_included,ol9_ksplice install -y nginx curl
fi
install -d /etc/nginx/conf.d
install -d /var/www/deposit-studio/releases "$release_dir"
tar -xzf "$archive" -C "$release_dir"
ln -sfn "$release_dir/dist" /var/www/deposit-studio/current-next
mv -Tf /var/www/deposit-studio/current-next /var/www/deposit-studio/current
cat >/etc/nginx/conf.d/deposit-studio-web.conf <<'EOF'
server {
  listen 80 default_server;
  server_name _;
  root /var/www/deposit-studio/current;
  index index.html;
  location / { try_files $uri $uri/ /index.html; }
}
EOF
command -v restorecon >/dev/null && restorecon -RF /var/www/deposit-studio/current || true
nginx -t
systemctl enable --now nginx
systemctl reload nginx
if command -v firewall-cmd >/dev/null; then
  firewall-cmd --permanent --add-service=http
  firewall-cmd --reload
fi
curl -fsS http://127.0.0.1/ >/dev/null
rm -f "$archive" /tmp/deploy-web.sh
