const REMOTE_WEB_STATIC_PREFIX = "/cpu-web-media/web-static/assets/dual-origin-v2/";

export function resolvePdfWorkerUrl(bundledWorkerUrl: string, pageOrigin: string) {
  const worker = new URL(bundledWorkerUrl, pageOrigin);
  // A service chunk loaded from object storage resolves its worker beside the
  // chunk. Keep that origin: the application server only redirects manifest
  // entries at /assets/, not the object-storage path itself.
  if (worker.pathname.startsWith(REMOTE_WEB_STATIC_PREFIX)) return worker.toString();
  const page = new URL(pageOrigin);
  return new URL(`${worker.pathname}${worker.search}${worker.hash}`, page.origin).toString();
}
