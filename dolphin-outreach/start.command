#!/bin/bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Установи Node.js 22+ с https://nodejs.org"; read; exit 1; }
(sleep 1; open http://localhost:4747) &
node src/server.js
