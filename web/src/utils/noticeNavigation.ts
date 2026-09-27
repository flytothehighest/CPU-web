export function navigateNoticeTarget(target: string, navigation: {
  assign: (url: string) => unknown;
  push: (url: string) => unknown;
}) {
  // VoiceHub is a separate Nuxt application behind the same origin, not a main-site SPA route.
  if (/^\/voicehub(?:[/?#]|$)/u.test(target)) return navigation.assign(target);
  return navigation.push(target);
}
