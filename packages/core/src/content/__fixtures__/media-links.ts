// Media link corpus (RESEARCH Wave 0, D219, D279, D281). Test-only: never exported from a
// barrel. parseMediaLink is the whole security surface of "no raw embed HTML", so every
// accepted form, every pasted <iframe> and every hostile input lives here, and
// media-link.test.ts drives the parser from it. Adding a provider = add its rows here.
//
// The URL forms are RESEARCH A4 assumptions; HUMAN-CHECKS (P7 07-08) asks a person to open one
// embedUrl per provider in a browser.

export interface ValidLinkCase {
  input: string;
  provider: string;
  category: "video" | "audio" | "embed";
  id: string;
  embedUrl: string;
}

const YT = "dQw4w9WgXcQ";
const YT_EMBED = `https://www.youtube-nocookie.com/embed/${YT}`;
const LOOM = "0123456789abcdef0123456789abcdef";
const FB = "10153231379946729";
const FB_EMBED =
  "https://www.facebook.com/plugins/video.php?href=" +
  encodeURIComponent(`https://www.facebook.com/video.php?v=${FB}`);
const TWEET = "1460323737035677698";
const TIKTOK = "7106594312292453675";
const SPOTIFY = "4uLU6hMCjMI75M1A2tKUQC";
const SC = (path: string) =>
  "https://w.soundcloud.com/player/?url=" + encodeURIComponent(path);
const GCAL = "studio@group.calendar.google.com";
const GCAL_EMBED =
  "https://calendar.google.com/calendar/embed?src=" + encodeURIComponent(GCAL);

export const VALID_LINKS: readonly ValidLinkCase[] = [
  // YouTube: every input form builds the youtube-nocookie URL (D279).
  ...[
    `https://www.youtube.com/watch?v=${YT}`,
    `https://youtube.com/watch?v=${YT}&t=30s`,
    `http://www.youtube.com/watch?feature=share&v=${YT}`,
    `https://m.youtube.com/watch?v=${YT}`,
    `https://music.youtube.com/watch?v=${YT}&list=RD`,
    `https://youtu.be/${YT}`,
    `https://youtu.be/${YT}?si=AbCdEf123`,
    `https://www.youtube.com/shorts/${YT}`,
    `https://www.youtube.com/live/${YT}?feature=share`,
    `https://www.youtube.com/embed/${YT}`,
    `https://www.youtube.com/v/${YT}`,
    `https://www.youtube-nocookie.com/embed/${YT}`,
    `https://youtube-nocookie.com/embed/${YT}?rel=0`,
    `  https://www.youtube.com/watch?v=${YT}  `,
    `youtu.be/${YT}`,
    `www.youtube.com/watch?v=${YT}`,
  ].map((input) => ({
    input,
    provider: "youtube",
    category: "video" as const,
    id: YT,
    embedUrl: YT_EMBED,
  })),
  // Vimeo: always dnt=1 (D279); unlisted hash kept.
  {
    input: "https://vimeo.com/76979871",
    provider: "vimeo",
    category: "video",
    id: "76979871",
    embedUrl: "https://player.vimeo.com/video/76979871?dnt=1",
  },
  {
    input: "https://www.vimeo.com/76979871?share=copy",
    provider: "vimeo",
    category: "video",
    id: "76979871",
    embedUrl: "https://player.vimeo.com/video/76979871?dnt=1",
  },
  {
    input: "https://player.vimeo.com/video/76979871?autoplay=1",
    provider: "vimeo",
    category: "video",
    id: "76979871",
    embedUrl: "https://player.vimeo.com/video/76979871?dnt=1",
  },
  {
    input: "https://vimeo.com/123456789/abcdef1234",
    provider: "vimeo",
    category: "video",
    id: "123456789:abcdef1234",
    embedUrl: "https://player.vimeo.com/video/123456789?dnt=1&h=abcdef1234",
  },
  {
    input: "https://player.vimeo.com/video/123456789?h=abcdef1234&badge=0",
    provider: "vimeo",
    category: "video",
    id: "123456789:abcdef1234",
    embedUrl: "https://player.vimeo.com/video/123456789?dnt=1&h=abcdef1234",
  },
  // Wistia
  {
    input: "https://acme.wistia.com/medias/a1b2c3d4e5",
    provider: "wistia",
    category: "video",
    id: "a1b2c3d4e5",
    embedUrl: "https://fast.wistia.net/embed/iframe/a1b2c3d4e5",
  },
  {
    input: "https://fast.wistia.net/embed/iframe/a1b2c3d4e5?videoFoam=true",
    provider: "wistia",
    category: "video",
    id: "a1b2c3d4e5",
    embedUrl: "https://fast.wistia.net/embed/iframe/a1b2c3d4e5",
  },
  {
    input: "https://acme-studio.wi.st/medias/a1b2c3d4e5",
    provider: "wistia",
    category: "video",
    id: "a1b2c3d4e5",
    embedUrl: "https://fast.wistia.net/embed/iframe/a1b2c3d4e5",
  },
  // Loom
  {
    input: `https://www.loom.com/share/${LOOM}`,
    provider: "loom",
    category: "video",
    id: LOOM,
    embedUrl: `https://www.loom.com/embed/${LOOM}`,
  },
  {
    input: `https://loom.com/embed/${LOOM}?sid=abc`,
    provider: "loom",
    category: "video",
    id: LOOM,
    embedUrl: `https://www.loom.com/embed/${LOOM}`,
  },
  // Facebook
  ...[
    `https://www.facebook.com/acmestudio/videos/${FB}/`,
    `https://m.facebook.com/watch/?v=${FB}`,
    `https://facebook.com/video.php?v=${FB}`,
    `https://web.facebook.com/reel/${FB}`,
    `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(
      `https://www.facebook.com/acmestudio/videos/${FB}/`,
    )}&show_text=0&width=560`,
  ].map((input) => ({
    input,
    provider: "facebook",
    category: "video" as const,
    id: FB,
    embedUrl: FB_EMBED,
  })),
  // Instagram
  {
    input: "https://www.instagram.com/p/CxYz123AbC/",
    provider: "instagram",
    category: "video",
    id: "p/CxYz123AbC",
    embedUrl: "https://www.instagram.com/p/CxYz123AbC/embed",
  },
  {
    input: "https://instagram.com/reel/C1a2B3c4D5e/?igsh=xyz",
    provider: "instagram",
    category: "video",
    id: "reel/C1a2B3c4D5e",
    embedUrl: "https://www.instagram.com/reel/C1a2B3c4D5e/embed",
  },
  {
    input: "https://www.instagram.com/tv/B_tv-code1/embed",
    provider: "instagram",
    category: "video",
    id: "tv/B_tv-code1",
    embedUrl: "https://www.instagram.com/tv/B_tv-code1/embed",
  },
  // X / Twitter (dnt=true)
  ...[
    `https://x.com/acme/status/${TWEET}`,
    `https://twitter.com/acme/status/${TWEET}?s=20`,
    `https://mobile.twitter.com/acme/status/${TWEET}`,
    `https://platform.twitter.com/embed/Tweet.html?id=${TWEET}`,
  ].map((input) => ({
    input,
    provider: "x",
    category: "video" as const,
    id: TWEET,
    embedUrl: `https://platform.twitter.com/embed/Tweet.html?id=${TWEET}&dnt=true`,
  })),
  // TikTok
  ...[
    `https://www.tiktok.com/@acme.studio/video/${TIKTOK}`,
    `https://tiktok.com/embed/v2/${TIKTOK}`,
    `https://www.tiktok.com/embed/${TIKTOK}`,
  ].map((input) => ({
    input,
    provider: "tiktok",
    category: "video" as const,
    id: TIKTOK,
    embedUrl: `https://www.tiktok.com/embed/v2/${TIKTOK}`,
  })),
  // Spotify
  ...[
    `https://open.spotify.com/track/${SPOTIFY}`,
    `https://open.spotify.com/intl-de/track/${SPOTIFY}?si=abc`,
    `https://open.spotify.com/embed/track/${SPOTIFY}`,
    `spotify:track:${SPOTIFY}`,
  ].map((input) => ({
    input,
    provider: "spotify",
    category: "audio" as const,
    id: `track/${SPOTIFY}`,
    embedUrl: `https://open.spotify.com/embed/track/${SPOTIFY}`,
  })),
  {
    input: `https://open.spotify.com/episode/${SPOTIFY}`,
    provider: "spotify",
    category: "audio",
    id: `episode/${SPOTIFY}`,
    embedUrl: `https://open.spotify.com/embed/episode/${SPOTIFY}`,
  },
  // SoundCloud
  {
    input: "https://soundcloud.com/forss/flickermood",
    provider: "soundcloud",
    category: "audio",
    id: "forss/flickermood",
    embedUrl: SC("https://soundcloud.com/forss/flickermood"),
  },
  {
    input: "https://m.soundcloud.com/forss/sets/soulhack",
    provider: "soundcloud",
    category: "audio",
    id: "forss/sets/soulhack",
    embedUrl: SC("https://soundcloud.com/forss/sets/soulhack"),
  },
  {
    input:
      "https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/293&color=%23ff5500",
    provider: "soundcloud",
    category: "audio",
    id: "tracks/293",
    embedUrl: SC("https://api.soundcloud.com/tracks/293"),
  },
  // Apple Podcasts
  {
    input: "https://podcasts.apple.com/us/podcast/the-daily/id1200361736",
    provider: "apple-podcasts",
    category: "audio",
    id: "us/the-daily/1200361736",
    embedUrl:
      "https://embed.podcasts.apple.com/us/podcast/the-daily/id1200361736",
  },
  {
    input:
      "https://podcasts.apple.com/gb/podcast/the-daily/id1200361736?i=1000600000000",
    provider: "apple-podcasts",
    category: "audio",
    id: "gb/the-daily/1200361736/1000600000000",
    embedUrl:
      "https://embed.podcasts.apple.com/gb/podcast/the-daily/id1200361736?i=1000600000000",
  },
  // Calendly (embed)
  {
    input: "https://calendly.com/acme-studio",
    provider: "calendly",
    category: "embed",
    id: "acme-studio",
    embedUrl:
      "https://calendly.com/acme-studio?embed_type=Inline&hide_gdpr_banner=1",
  },
  {
    input: "https://www.calendly.com/acme-studio/30min?month=2026-10",
    provider: "calendly",
    category: "embed",
    id: "acme-studio/30min",
    embedUrl:
      "https://calendly.com/acme-studio/30min?embed_type=Inline&hide_gdpr_banner=1",
  },
  // Google Calendar (public)
  ...[
    `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(GCAL)}&ctz=America%2FChicago`,
    `https://calendar.google.com/calendar/u/0?cid=${btoa(GCAL)}`,
    `https://calendar.google.com/calendar/ical/${encodeURIComponent(GCAL)}/public/basic.ics`,
  ].map((input) => ({
    input,
    provider: "google-calendar",
    category: "embed" as const,
    id: GCAL,
    embedUrl: GCAL_EMBED,
  })),
];

/** Pasted embed code: each must give the same result as `url`. */
export const IFRAME_PASTES: readonly { html: string; url: string }[] = [
  {
    html: `<iframe width="560" height="315" src="https://www.youtube.com/embed/${YT}?si=x&amp;start=10" title="YouTube video player" frameborder="0" allowfullscreen></iframe>`,
    url: `https://www.youtube.com/embed/${YT}`,
  },
  {
    html: `<IFRAME src='https://player.vimeo.com/video/76979871?h=abcdef1234&amp;badge=0' allow="autoplay"></IFRAME>`,
    url: "https://player.vimeo.com/video/76979871?h=abcdef1234",
  },
  {
    html: `<div><iframe src="//fast.wistia.net/embed/iframe/a1b2c3d4e5" allowtransparency="true"></iframe></div>`,
    url: "https://fast.wistia.net/embed/iframe/a1b2c3d4e5",
  },
  {
    html: `<iframe style="border-radius:12px" src="https://open.spotify.com/embed/track/${SPOTIFY}?utm_source=generator&#38;theme=0" width="100%" height="152"></iframe>`,
    url: `https://open.spotify.com/track/${SPOTIFY}`,
  },
  {
    html: `<iframe width="100%" height="166" scrolling="no" frameborder="no" src="https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/293&amp;color=%23ff5500"></iframe>`,
    url: "https://api.soundcloud.com/tracks/293",
  },
  {
    html: `<iframe allow="autoplay *" height="175" src="https://embed.podcasts.apple.com/us/podcast/the-daily/id1200361736"></iframe>`,
    url: "https://podcasts.apple.com/us/podcast/the-daily/id1200361736",
  },
  {
    html: `<iframe src="https://calendar.google.com/calendar/embed?src=${encodeURIComponent(GCAL)}&amp;ctz=America%2FChicago" style="border: 0" width="800" height="600"></iframe>`,
    url: `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(GCAL)}`,
  },
  {
    html: `<iframe data-src="https://evil.net/x" src="https://www.loom.com/embed/${LOOM}" allowfullscreen></iframe>`,
    url: `https://www.loom.com/share/${LOOM}`,
  },
];

/** Every one must be refused ({ ok: false }). */
export const HOSTILE_LINKS: readonly { input: unknown; why: string }[] = [
  { input: "javascript:alert(1)", why: "javascript scheme" },
  { input: "JaVaScRiPt:alert(1)", why: "mixed-case javascript scheme" },
  { input: "java\tscript:alert(1)", why: "tab inside the scheme" },
  { input: "javascript\n:alert(1)", why: "newline inside the scheme" },
  {
    input: "data:text/html,<script>alert(1)</script>",
    why: "data URL",
  },
  { input: "vbscript:msgbox(1)", why: "vbscript scheme" },
  { input: "file:///etc/passwd", why: "file scheme" },
  { input: "ftp://youtube.com/watch?v=dQw4w9WgXcQ", why: "ftp scheme" },
  {
    input: "https://youtube.com.evil.net/watch?v=dQw4w9WgXcQ",
    why: "allowed host as a subdomain of an evil host",
  },
  {
    input: "https://evilyoutube.com/watch?v=dQw4w9WgXcQ",
    why: "suffix lookalike host",
  },
  {
    input: "https://youtube.com@evil.net/watch?v=dQw4w9WgXcQ",
    why: "allowed host as userinfo",
  },
  {
    input: "https://evil.net\\@youtube.com/watch?v=dQw4w9WgXcQ",
    why: "backslash userinfo trick",
  },
  {
    input: "https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ",
    why: "userinfo on an allowed host",
  },
  {
    input: "https://youtube.com:8443/watch?v=dQw4w9WgXcQ",
    why: "non-default port",
  },
  {
    input: "https://xn--yutube-wqf.com/watch?v=dQw4w9WgXcQ",
    why: "punycode lookalike host",
  },
  {
    input: "https://yоutube.com/watch?v=dQw4w9WgXcQ",
    why: "Cyrillic o lookalike (IDN)",
  },
  {
    input: "https://www.youtube.com.:443/watch?v=dQw4w9WgXcQ",
    why: "trailing-dot host",
  },
  {
    input: "https://www.youtube.com/watch?v=dQw4w9WgXc",
    why: "YouTube id of 10 chars",
  },
  {
    input: "https://www.youtube.com/watch?v=dQw4w9WgXcQQ",
    why: "YouTube id of 12 chars",
  },
  {
    input: "https://www.youtube.com/watch?v=dQw4w9/gXcQ",
    why: "id with a slash",
  },
  {
    input: "https://www.youtube.com/watch?v=..%2F..%2Fx",
    why: "id with .. and %2F",
  },
  {
    input: 'https://www.youtube.com/watch?v=dQw4w9"XcQ',
    why: "id with a quote",
  },
  {
    input: "https://www.youtube.com/embed/..%2FdQw4w9WgXcQ",
    why: "encoded traversal in the path id",
  },
  {
    input: "https://vimeo.com/76979871/zzzzzz",
    why: "Vimeo hash not hex",
  },
  {
    input: "https://evil.wistia.com.evil.net/medias/a1b2c3d4e5",
    why: "Wistia suffix on an evil host",
  },
  {
    input: "https://a.b.wistia.com/medias/a1b2c3d4e5",
    why: "Wistia with two subdomain labels",
  },
  {
    input: '<iframe src="https://evil.net/embed/dQw4w9WgXcQ"></iframe>',
    why: "iframe on a non-allowed host",
  },
  {
    input: '<iframe src="javascript:alert(1)"></iframe>',
    why: "iframe with a javascript src",
  },
  {
    input: "<iframe src=https://www.youtube.com/embed/dQw4w9WgXcQ></iframe>",
    why: "iframe with an unquoted src",
  },
  {
    input: "<script>alert(1)</script>",
    why: "script tag",
  },
  {
    input:
      '<script>x</script><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">x</a>',
    why: "HTML that is not an iframe",
  },
  {
    input: `https://www.youtube.com/watch?v=dQw4w9WgXcQ&x=${"a".repeat(5000)}`,
    why: "5000+ char input",
  },
  { input: "x".repeat(5000), why: "5000-char junk" },
  {
    input:
      "https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fevil.net%2Fvideos%2F123",
    why: "Facebook plugin wrapping a non-Facebook href",
  },
  {
    input:
      "https://www.facebook.com/plugins/video.php?href=" +
      encodeURIComponent(
        "https://www.facebook.com/plugins/video.php?href=" +
          encodeURIComponent("https://www.facebook.com/video.php?v=123"),
      ),
    why: "nested Facebook plugin (recursion beyond one level)",
  },
  {
    input:
      "https://w.soundcloud.com/player/?url=https%3A%2F%2Fevil.net%2Fforss%2Fx",
    why: "SoundCloud player wrapping a non-SoundCloud url",
  },
  {
    input: "https://open.spotify.com/track/short",
    why: "Spotify id of the wrong length",
  },
  { input: "spotify:track:../../x", why: "Spotify URI with traversal" },
  {
    input: "https://calendar.google.com/calendar/embed?src=not-an-email",
    why: "Google Calendar id without @",
  },
  {
    input: "https://calendar.google.com/calendar/u/0?cid=%%%",
    why: "Google Calendar cid that is not base64",
  },
  {
    input: "https://calendly.com/acme/30min/extra/deep",
    why: "Calendly path too deep",
  },
  { input: "https://example.com/video.mp4", why: "plain non-provider URL" },
  { input: "not a link", why: "prose" },
  { input: 42, why: "number" },
  { input: { url: "https://youtu.be/dQw4w9WgXcQ" }, why: "object" },
  { input: null, why: "null" },
  { input: undefined, why: "undefined" },
  { input: "", why: "empty string" },
  { input: "   ", why: "whitespace only" },
];
