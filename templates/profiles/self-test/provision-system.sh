#!/bin/sh
set -eu

install -d -o pi -g pi /home/agent/.pi/agent

sed -i 's#https://dl-cdn.alpinelinux.org#http://dl-cdn.alpinelinux.org#g' /etc/apk/repositories
apk update
apk add --no-cache ca-certificates curl gzip jq qemu-system-$(uname -m) qemu-img qemu-tools sudo tar
update-ca-certificates

VERSION="$(curl -fsSLk https://api.github.com/repos/lima-vm/lima/releases/latest | jq -r .tag_name)"
curl -fsSLk "https://github.com/lima-vm/lima/releases/download/${VERSION}/lima-${VERSION#v}-$(uname -s)-$(uname -m).tar.gz" | tar Cxzvm /usr/local
curl -fsSLk "https://github.com/lima-vm/lima/releases/download/${VERSION}/lima-additional-guestagents-${VERSION#v}-$(uname -s)-$(uname -m).tar.gz" | tar Cxzvm /usr/local
