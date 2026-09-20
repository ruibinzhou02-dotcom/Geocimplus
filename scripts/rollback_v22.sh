#!/usr/bin/env bash
set -euo pipefail
release="${1:?deployment id to roll back}"
[[ "$release" =~ ^[0-9]{8}-[0-9]{6}-v22$ ]] || exit 2
backup=/var/backups/geocim/$release
test -f "$backup/ready"
oldsite=$(cat "$backup/previous-site.txt")
oldservice=$(cat "$backup/previous-service.txt")
[[ "$oldsite" == /www/wwwroot/geocimplus/releases/* ]] && test -d "$oldsite"
cp -a "$backup/nginx.conf" /etc/nginx/conf.d/geocimplus.conf
nginx -t
ln -sfn "$oldsite" /www/wwwroot/geocimplus/current-rollback
mv -Tf /www/wwwroot/geocimplus/current-rollback /www/wwwroot/geocimplus/current
if test -n "$oldservice"; then
 [[ "$oldservice" == /opt/geocim-v2/releases/* ]] && test -d "$oldservice"
 cp -a "$backup/service.unit" /etc/systemd/system/geocim-v2.service
 ln -sfn "$oldservice" /opt/geocim-v2/current
 systemctl daemon-reload
 systemctl restart geocim-v2
else
 systemctl disable --now geocim-v2.service
fi
systemctl reload nginx
printf 'Restored %s\n' "$oldsite"
