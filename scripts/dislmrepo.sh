#!/bin/bash
#
#
# Make a holding folder and move the offending repo files
sudo mkdir -p /etc/apt/sources.list.disabled

for f in /etc/apt/sources.list.d/*pgdg*.list \
         /etc/apt/sources.list.d/*rabbitmq*.list \
         /etc/apt/sources.list.d/*erlang*.list; do
  [ -e "$f" ] && sudo mv "$f" /etc/apt/sources.list.disabled/
done

# Update
sudo apt update

