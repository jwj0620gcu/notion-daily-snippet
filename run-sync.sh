#!/bin/zsh

cd /Users/jungwonjun/notion-daily-sync || exit 1

/usr/local/bin/node sync-notion-to-snippet.mjs >> /Users/jungwonjun/notion-daily-sync/sync.log 2>&1