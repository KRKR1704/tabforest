#!/usr/bin/env bash
# Sets the App Service configuration for both lanes. Names only: every value comes from the
# environment of whoever runs this (or from GitHub secrets), never from this file.
#   Needs: az logged in; APP, RG; and the variables listed in REQUIRED exported.
set -euo pipefail

APP="${APP:-tabforest}"
RG="${RG:?set RG to the resource group}"

REQUIRED=(DATABASE_URL ENTRA_CLIENT_ID ENTRA_API_AUDIENCE ALLOWED_EXTENSION_ORIGIN
          APPLICATIONINSIGHTS_CONNECTION_STRING AZURE_OPENAI_ENDPOINT AZURE_OPENAI_API_KEY
          AZURE_OPENAI_CHAT_DEPLOYMENT AZURE_OPENAI_EMBED_DEPLOYMENT)
for name in "${REQUIRED[@]}"; do
  [ -n "${!name:-}" ] || { echo "missing $name" >&2; exit 1; }
done

settings=(AUTH_MODE=prod FALLBACK_LOGIN=false ENTRA_TENANT=common FORWARDED_ALLOW_IPS='*'
          SCM_DO_BUILD_DURING_DEPLOYMENT=true)
for name in "${REQUIRED[@]}"; do settings+=("$name=${!name}"); done

az webapp config appsettings set -n "$APP" -g "$RG" --settings "${settings[@]}" -o none
az webapp config set -n "$APP" -g "$RG" --min-tls-version 1.2 --ftps-state Disabled \
  --startup-file "python -m uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000 --proxy-headers" -o none
az webapp update -n "$APP" -g "$RG" --https-only true -o none
echo "configured $APP (values not printed)"
