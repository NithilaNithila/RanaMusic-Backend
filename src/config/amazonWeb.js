// Unofficial Amazon Music "web scraper" provider. Talks to the public
// music.amazon.com config.json (device + csrf) and Amazon's internal skill
// endpoints (eu.mesk.skill.music.a2z.com / na|eu|fe.web.skill.music.a2z.com)
// anonymously - no login cookies are required for catalog search + metadata.
// Disable globally with AMZN_WEB_ENABLED=false.
module.exports = {
  enabled: process.env.AMZN_WEB_ENABLED !== "false",
  // Which region buys the first shot for by-id album/playlist lookups
  // (domain hint). Falls back to all regions regardless.
  regionHint: process.env.AMZN_WEB_REGION_HINT || "music.amazon.com",
  timeouts: {
    config: 5000, // config.json (per-domain fetch)
    skill: 8000, // skill API POST
    durationBatch: 2000, // secondary album calls used to resolve durations
  },
};