#!/bin/sh
set -eu

# A new IaC service starts before its private credentials can be injected.
if [ -z "${EBAY_CLIENT_ID:-}" ] || [ -z "${EBAY_CLIENT_SECRET:-}" ]; then
  echo 'Waiting for eBay application credentials' >&2
  while [ -z "${EBAY_CLIENT_ID:-}" ] || [ -z "${EBAY_CLIENT_SECRET:-}" ]; do
    sleep 10
  done
fi

# Validate names only. Never put credentials into arguments or startup logs.
node --input-type=module -e '
for (const name of ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"]) {
  const value = process.env[name];
  if (!value || value !== value.trim()) {
    console.error(`${name} is missing or has surrounding whitespace`);
    process.exit(1);
  }
}
if (process.env.EBAY_API_ENV !== "production" || process.env.EBAY_TOKEN_TYPE !== "application") {
  console.error("This deployment requires production application-token mode");
  process.exit(1);
}
'
exec "$@"
