#!/bin/bash
#
#
#
podman-compose down
sudo chown -R jimmer config/certs && git pull origin main; rc=$?; sleep 5
if [[ "$rc" -ne "0" ]]; then
	echo "git pull FAILED"
	exit 1
fi
podman-compose build && podman-compose up

