// Public runtime configuration shared by the native publishing workflows.
export function mobileApiOrigin(value = 'https://rephase.surtani.org') {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password)
    throw new Error('API_ORIGIN must be an exact HTTPS origin without a trailing slash.');
  return value;
}
