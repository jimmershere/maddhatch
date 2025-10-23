#!/bin/bash
#
#
# Try a clean purge first
sudo dpkg --purge zfs-dkms || true

# If it still complains, force-remove the DKMS package
sudo dpkg --remove --force-all zfs-dkms

# Repair any half-configured packages
sudo apt-get --fix-broken install -y
sudo apt update

