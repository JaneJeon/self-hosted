#!/bin/sh

curl "http://typesense:8108/operations/snapshot?snapshot_path=/backup" -X POST \
    -H "Content-Type: application/json" \
    -H "X-TYPESENSE-API-KEY: ${TYPESENSE_API_KEY}"
