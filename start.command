#!/bin/zsh
cd "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.jsが見つかりません。スタートガイドの『最初の準備』を確認してください。"
  read "?Enterキーで閉じます"
  exit 1
fi
open "http://127.0.0.1:4173"
node server.js
