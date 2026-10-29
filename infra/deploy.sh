#!/bin/zsh
# Creates (or updates) the AWS side of the pipeline and writes its addresses into .env.
# Asks for secrets with hidden input so they don't land in your shell history.
set -euo pipefail
cd "$(dirname "$0")/.."
STACK=video-studio

source_env() { [[ -f .env ]] && grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }
set_env() {
  touch .env
  if grep -qE "^$1=" .env; then sed -i '' "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}

BUCKET=$(source_env S3_BUCKET)
if [[ -z "$BUCKET" ]]; then
  read "BUCKET?S3 bucket name (lowercase, globally unique, e.g. lamo-video-studio): "
fi
OWNER=$(source_env WHATSAPP_TO)
if [[ -z "$OWNER" ]]; then
  read "OWNER?Your WhatsApp number, international format without + (e.g. 46701234567): "
fi
read -s "SECRET?Meta app secret (Meta app > App settings > Basic > App secret): "; echo
VERIFY=$(source_env WHATSAPP_VERIFY_TOKEN)
[[ -z "$VERIFY" ]] && VERIFY=$(openssl rand -hex 16)

echo "Deploying stack '$STACK' to $(aws configure get region)..."
aws cloudformation deploy \
  --stack-name "$STACK" \
  --template-file infra/template.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides BucketName="$BUCKET" OwnerWhatsAppNumber="$OWNER" WhatsAppVerifyToken="$VERIFY" WhatsAppAppSecret="$SECRET"

output() { aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
set_env AWS_REGION "$(aws configure get region)"
set_env S3_BUCKET "$(output BucketName)"
set_env JOBS_QUEUE_URL "$(output JobsQueueUrl)"
set_env WHATSAPP_TO "$OWNER"
set_env WHATSAPP_VERIFY_TOKEN "$VERIFY"
set_env TIKTOK_REDIRECT_URI "$(output OAuthRedirectUrl)"

echo
echo "Done. Saved the bucket, queue and redirect URL to .env."
echo
echo "Now set the WhatsApp webhook in Meta (WhatsApp > Configuration > Webhook):"
echo "  Callback URL:  $(output WebhookUrl)"
echo "  Verify token:  WHATSAPP_VERIFY_TOKEN in your .env"
echo "  Then subscribe to the 'messages' field."
