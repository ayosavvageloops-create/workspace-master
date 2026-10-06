#!/bin/bash
# Двойной клик в Finder — запускает Beat Hub и открывает его в браузере.
cd "$(dirname "$0")" && exec python3 hub.py
