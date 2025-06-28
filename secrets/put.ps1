Get-Content secrets.env | ForEach-Object {
  if ($_ -match '^([^=]+)=(.+)$') {
    $key = $matches[1].Trim()
    $value = $matches[2].Trim()
    $value | wrangler secret put $key
  }
}
