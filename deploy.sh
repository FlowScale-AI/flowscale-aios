#!/bin/bash
set -euo pipefail

# ── FlowScale AIOS — EC2 t3.small deploy script ──
# Usage: ./deploy.sh <ec2-host> [ssh-key]
#   e.g. ./deploy.sh ubuntu@3.14.159.26 ~/.ssh/my-key.pem

HOST="${1:?Usage: ./deploy.sh <user@host> [ssh-key-path]}"
KEY="${2:-}"
SSH_OPTS="-o StrictHostKeyChecking=no"
[ -n "$KEY" ] && SSH_OPTS="$SSH_OPTS -i $KEY"

echo "▸ Setting up EC2 instance at $HOST"

ssh $SSH_OPTS "$HOST" bash -s <<'REMOTE'
set -euo pipefail

# Install Docker if missing
if ! command -v docker &>/dev/null; then
  echo "▸ Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
  echo "▸ Docker installed. You may need to re-login for group changes."
fi

# Install docker compose plugin if missing
if ! docker compose version &>/dev/null; then
  sudo apt-get update && sudo apt-get install -y docker-compose-plugin
fi

# Set up swap (important for 2GB RAM)
if [ ! -f /swapfile ]; then
  echo "▸ Creating 2GB swap..."
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

# Create app directory
mkdir -p ~/flowscale
REMOTE

echo "▸ Syncing project files..."
rsync -az --delete \
  --exclude node_modules \
  --exclude .next \
  --exclude .git \
  --exclude apps/desktop \
  --exclude example-apps \
  -e "ssh $SSH_OPTS" \
  ./ "$HOST:~/flowscale/"

echo "▸ Building and starting on EC2..."
ssh $SSH_OPTS "$HOST" bash -s <<'REMOTE'
cd ~/flowscale
sudo docker compose down || true
sudo docker compose up -d --build
echo "▸ Waiting for server..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:80 >/dev/null 2>&1; then
    echo "✓ FlowScale is live on port 80"
    exit 0
  fi
  sleep 2
done
echo "✗ Server didn't start in 60s — check: sudo docker compose logs"
exit 1
REMOTE
