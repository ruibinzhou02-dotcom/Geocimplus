#!/usr/bin/env bash
set -euo pipefail
release="${1:?release id}"; archive="${2:?archive path}"
[[ "$release" =~ ^[0-9]{8}-[0-9]{6}-v22$ ]] || exit 2
base=/www/wwwroot/geocimplus
servicebase=/opt/geocim-v2
backup=/var/backups/geocim/$release
mkdir -p "$backup" "$servicebase/releases/$release" "$base/releases/$release"
test ! -e "$backup/ready"
oldsite=$(readlink -f "$base/current")
oldservice=$(readlink -f "$servicebase/current" 2>/dev/null || true)
printf '%s\n' "$oldsite" > "$backup/previous-site.txt"
printf '%s\n' "$oldservice" > "$backup/previous-service.txt"
cp -a /etc/nginx/conf.d/geocimplus.conf "$backup/nginx.conf"
if test -f /etc/systemd/system/geocim-v2.service; then cp -a /etc/systemd/system/geocim-v2.service "$backup/service.unit"; fi
touch "$backup/ready"
rollback() {
 cp -a "$backup/nginx.conf" /etc/nginx/conf.d/geocimplus.conf
 ln -sfn "$oldsite" "$base/current-rollback"; mv -Tf "$base/current-rollback" "$base/current"
 if test -f "$backup/service.unit"; then cp -a "$backup/service.unit" /etc/systemd/system/geocim-v2.service; fi
 if test -n "$oldservice" && test -d "$oldservice"; then ln -sfn "$oldservice" "$servicebase/current"; systemctl daemon-reload; systemctl restart geocim-v2; else systemctl disable --now geocim-v2.service || true; fi
 nginx -t && systemctl reload nginx
}
trap 'rollback' ERR
tar -xzf "$archive" -C "$servicebase/releases/$release"
runtime="$servicebase/runtime/node-v24.21.0-linux-x64"
if ! test -x "$runtime/bin/node"; then
 mkdir -p "$servicebase/runtime" "$backup/runtime-download"
 cd "$backup/runtime-download"
 curl --retry 2 --max-time 180 -fsSLO https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz
 curl --retry 2 --max-time 30 -fsSLO https://nodejs.org/dist/v24.21.0/SHASUMS256.txt
 awk '$2=="node-v24.21.0-linux-x64.tar.xz"{print}' SHASUMS256.txt > node.sha256
 test -s node.sha256; sha256sum --check node.sha256
 tar -xJf node-v24.21.0-linux-x64.tar.xz -C "$servicebase/runtime"
fi
"$runtime/bin/node" --version
cp -a "$oldsite/." "$base/releases/$release/"
cp -a "$servicebase/releases/$release/web/." "$base/releases/$release/"
mkdir -p "$base/releases/$release/v2-data"
cp -a "$servicebase/releases/$release/data/." "$base/releases/$release/v2-data/"
chmod -R a+rX "$servicebase/releases/$release" "$base/releases/$release"
ln -sfn "$servicebase/releases/$release" "$servicebase/current"
cat > /etc/systemd/system/geocim-v2.service <<EOF
[Unit]
Description=GeoCIM fixed-example computation
After=network.target
[Service]
Type=simple
DynamicUser=yes
WorkingDirectory=$servicebase/current
ExecStart=$runtime/bin/node $servicebase/current/cloud-server.mjs
Environment=PORT=8790
Environment=GEOCIM_DATA=$servicebase/current/data
Environment=NODE_ENV=production
Restart=on-failure
RestartSec=3
TimeoutStopSec=5
MemoryMax=384M
CPUQuota=80%
TasksMax=64
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
RestrictSUIDSGID=yes
UMask=0077
[Install]
WantedBy=multi-user.target
EOF
python3 - <<'PY'
from pathlib import Path
p=Path('/etc/nginx/conf.d/geocimplus.conf')
s=p.read_text()
start='# GEOCIM V22 BEGIN'
end='# GEOCIM V22 END'
if start in s:
 a=s.index(start);b=s.index(end,a)+len(end);s=s[:a]+s[b:]
anchor='    location /api/'
if anchor not in s:
 import re
 m=re.search(r'\s*location /api/',s)
 if not m: raise RuntimeError('Expected existing API location not found; config preserved')
 pos=m.start()
else: pos=s.index(anchor)
block='''
    # GEOCIM V22 BEGIN
    location ^~ /cloud-v2/ {
        client_max_body_size 64k;
        proxy_pass http://127.0.0.1:8790;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Host $host;
        proxy_read_timeout 55s;
        proxy_send_timeout 15s;
        proxy_buffering off;
    }
    location = / { try_files /index.html =404; add_header Cache-Control "no-cache"; }
    location = /v1.html { add_header Cache-Control "no-cache"; }
    location = /v2.html { add_header Cache-Control "no-cache"; }
    location ^~ /v2-data/ { try_files $uri =404; add_header Cache-Control "public, max-age=300"; }
    # GEOCIM V22 END
'''
s=s[:pos]+block+s[pos:];p.write_text(s)
PY
systemctl daemon-reload
systemctl enable --now geocim-v2.service
systemctl restart geocim-v2.service
for i in 1 2 3 4 5; do if curl --max-time 3 -fsS http://127.0.0.1:8790/cloud-v2/health; then break; fi; sleep 1; done
curl --max-time 3 -fsS http://127.0.0.1:8790/cloud-v2/health
nginx -t
ln -sfn "$base/releases/$release" "$base/current-next"; mv -Tf "$base/current-next" "$base/current"
systemctl reload nginx
curl --max-time 15 -fsS https://geocimplus.com/cloud-v2/health
trap - ERR
printf '\nRelease: %s\nBackup: %s\n' "$release" "$backup"
systemctl show geocim-v2 -p ActiveState -p MemoryCurrent -p MemoryMax
free -m
