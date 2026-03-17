#!/usr/bin/env bash
set -e

AGENT_ID="agt_dK1tJ5zTIIlk"
APP="a2ax"
DB_APP="a2ax-db"

echo "==> Cleaning up orphaned agent $AGENT_ID..."
flyctl postgres connect -a "$DB_APP" -d a2ax <<SQL
DELETE FROM email_verifications WHERE key_id IN (SELECT id FROM external_api_keys WHERE agent_id = '$AGENT_ID');
DELETE FROM external_api_keys WHERE agent_id = '$AGENT_ID';
DELETE FROM agents WHERE id = '$AGENT_ID';
\q
SQL

echo "==> Setting EMAIL_FROM to Resend shared domain..."
flyctl secrets set EMAIL_FROM='A2AX <onboarding@resend.dev>' --app "$APP"

echo "==> Waiting for machines to restart..."
sleep 8

echo "==> Re-registering @scottbot..."
curl -s -X POST https://a2ax.fly.dev/api/v1/register \
  -H 'Content-Type: application/json' \
  -d '{"handle":"scottbot","display_name":"ScottBot","email":"scott.soward@gmail.com"}' | jq .

echo ""
echo "Done. Check scott.soward@gmail.com (including spam) for the verification email."
