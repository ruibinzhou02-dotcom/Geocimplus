#!/bin/bash
# Upload site.zip outside the web root first. Run as the existing admin user.
set -euo pipefail
version=${1:?version YYYYMMDD-HHMMSS required}
archive=${2:?archive path required}
digest=${3:?SHA256 required}
[[ "$version" =~ ^[0-9]{8}-[0-9]{6}$ ]]
[[ "$archive" =~ ^/home/admin/geocim-[a-zA-Z0-9_-]+\.zip$ ]]
[[ "$digest" =~ ^[a-fA-F0-9]{64}$ ]]
printf '%s  %s\n' "$digest" "$archive" | sha256sum -c -
release=/www/wwwroot/geocimplus/releases/$version
backup=/var/backups/geocim/$version
test ! -e "$release"
test ! -e /www/wwwroot/geocimplus/current-next
sudo mkdir -p "$backup" "$release"
readlink -f /www/wwwroot/geocimplus/current | sudo tee "$backup/previous-release.txt"
sudo cp -a /etc/nginx/conf.d/geocimplus.conf "$backup/"
sudo unzip -q "$archive" -d "$release"
sudo find "$release" -type d -exec chmod 755 {} +
sudo find "$release" -type f -exec chmod 644 {} +
sudo nginx -t
sudo ln -s "$release" /www/wwwroot/geocimplus/current-next
sudo mv -Tf /www/wwwroot/geocimplus/current-next /www/wwwroot/geocimplus/current
readlink -f /www/wwwroot/geocimplus/current
curl --fail --silent --resolve geocimplus.com:443:127.0.0.1 https://geocimplus.com/api/catalog
