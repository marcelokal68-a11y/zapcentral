export function getClerkProxyUrl(): string {
  return import.meta.env.VITE_CLERK_PROXY_URL ?? "";
}
