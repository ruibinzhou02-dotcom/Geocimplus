#!/bin/bash
set -euo pipefail
release=/www/wwwroot/geocimplus/releases/20260906-175021
backup=/var/backups/geocim/20260906-175021
archive=/home/admin/geocim-analysis-20260906-175021.zip
test ! -e "$release"
test -f "$archive"
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
