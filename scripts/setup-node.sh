#!/usr/bin/env bash
set -e
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm install 20
nvm alias default 20
nvm use 20
echo "NODE: $(node --version)"
echo "NPM: $(npm --version)"
