# Reddit Post Templates

## Posting Strategy

**TIER 1 - Post here first (most welcoming):**
- r/SideProject — Designed for project launches, self-promotion welcomed
- r/coolgithubprojects — Audience of developers interested in tools
- r/Firefox / r/Chrome — Direct user audience

**TIER 2 - Good secondary options:**
- r/OpenSource — Open-source community
- r/selfhosted — Self-hosting enthusiasts (follow 90/10 rule: participate first)
- r/GitHub — Developer audience

**AVOID:**
- r/webdev — Strictly prohibits commercial content
- r/torrents, r/seedboxes — Unclear policies, risky

**Posting tips:**
- Disclose you're the creator in first comment
- Focus on technical aspects, not marketing
- Show working product, not landing pages
- Don't duplicate posts across communities

---

## Post Template

**Built a browser extension to route magnet links and torrents to your download services**

I got tired of manually copying magnet links and torrents around, or having everything go to my default handler when I actually wanted it on my NAS. So I built [Download Nexus](https://github.com/craigpen/download-nexus) — an extension that adds a button next to magnet links and torrents on any page, letting you send them directly to whichever download service you have running (qBittorrent, Transmission, Deluge, JDownloader 2, or Synology NAS).

**What it does:**
- Adds a button next to magnet links and torrent files on any page — click it to send to your service
- If you have multiple services configured, pick the one you want to send to
- Manage downloads from the popup — pause, resume, delete without leaving your browser
- No tracking, no analytics, everything stays local — all communication is between your browser and your service only
- You keep your existing magnet handler; this just gives you alternatives
- Takes a couple minutes to set up — add your service details and you're done

**Available on:**
- [Chrome Web Store](https://chromewebstore.google.com/detail/download-nexus/flhoeeffbkghmdagepajoojinjddnnjl)
- [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/download-nexus/)

It's open source and donation-supported. I'm happy to add support for other services or hear feedback on what's missing.
