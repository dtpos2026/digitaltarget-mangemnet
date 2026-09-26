// Service line from message text — same keyword table as the portal's
// src/lib/chatClassifier.ts (keep them in sync).
const LINE_KEYWORDS: [string, RegExp][] = [
  ["AI Software Development", /\b(software|apps?|application|pos|crm|erp|system|automation|automate|chat ?bot|bot|ai|artificial intelligence|billing|inventory)\b/gi],
  ["Web Development", /\b(website|web ?site|wordpress|shopify|landing page|domain|hosting|e-?commerce|online store)\b/gi],
  ["Digital Marketing", /\b(ads?|advertis\w*|boost|campaigns?|marketing|google ads|facebook ads|meta ads|seo|leads chahiye|sales)\b/gi],
  ["Social Media Management", /\b(social media|page manage|manage (my|hamara|mera) page|instagram|tiktok|followers|posting|content|smm)\b/gi],
  ["Graphic Design", /\b(logo|designs?|poster|flyer|banner|menu card|visiting card|brochure|thumbnail)\b/gi],
  ["Video Production", /\b(videos?|reels?|editing|shoot|youtube|animation|promo)\b/gi],
  ["Branding", /\b(branding|brand identity|brand guide)\b/gi],
];

export function detectServiceLine(text: string): string {
  let line = "";
  let best = 0;
  for (const [name, re] of LINE_KEYWORDS) {
    const hits = (text.match(re) || []).length;
    if (hits > best) { best = hits; line = name; }
  }
  return line;
}
