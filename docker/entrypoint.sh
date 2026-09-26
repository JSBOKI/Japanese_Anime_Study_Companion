#!/bin/sh
set -eu

mkdir -p "${DATA_DIR}/dict" "${DATA_DIR}/audio"

if [ ! -s "${DATA_DIR}/dict/jmdict-eng-common.json" ]; then
  echo "Copying dictionaries into ${DATA_DIR}/dict"
  cp -a /opt/yomu/dict-seed/. "${DATA_DIR}/dict/"
fi

exec "$@"
