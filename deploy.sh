#!/bin/bash
set -e

REMOTE_HOST="kwane@34.143.232.6"
REMOTE_DIR="~/9router"
SSH_KEY="~/.ssh/kwane.pem"

echo "🔨 Building..."
bun run build

echo "📦 Compressing .next/..."
tar -czf .next.tar.gz .next/

echo "🚀 Deploying to remote..."
scp -i $SSH_KEY .next.tar.gz $REMOTE_HOST:/tmp/

ssh -i $SSH_KEY $REMOTE_HOST << 'ENDSSH'
cd ~/9router
tar -xzf /tmp/.next.tar.gz
rm /tmp/.next.tar.gz
pm2 reload ecosystem.config.cjs --update-env
ENDSSH

echo "🧹 Cleaning up..."
rm .next.tar.gz

echo "✅ Deploy complete!"
