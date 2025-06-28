while IFS='=' read -r key value; do
  if [ -n "$key" ] && [ -n "$value" ]; then
    echo "$value" | wrangler secret put "$key"
  fi
done < secrets.env
