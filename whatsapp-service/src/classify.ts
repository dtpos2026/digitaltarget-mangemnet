// Service line from message text — same keyword table as the portal's
// src/lib/chatClassifier.ts (keep them in sync).
const LINE_KEYWORDS: [string, RegExp][] = [
  ["Restaurant Software / DTPOS", /\b(restaurant (software|pos|system|app)|dtpos|table management|kitchen (display|order)|kot|dine[- ]?in|take ?away|cafe (software|pos))\b/gi],
  ["Travel Agency Software", /\b(travel (agency )?(software|system)|ticketing (software|system)|umrah|visa (software|system)|booking software)\b/gi],
  ["Retail POS", /\b(pos|point of sale|billing software|shop software|dukaan|dukan|store software|inventory|stock (software|management)|barcode)\b/gi],
  ["AI Software Development", /\b(ai (software|bot|tool|based|agent)|artificial intelligence|chat ?bot|chatgpt|gpt|whatsapp (bot|automation))\b/gi],
  ["Custom Software", /\b(software|erp|crm|automation|automate|management system|desktop (software|app)|windows software|hybrid software)\b/gi],
  ["Mobile Apps / App Development", /\b(mobile app|android app|ios app|app (banwani|banwana|banani|banana|develop\w*|chahiye)|application (banwani|banani|chahiye)|play ?store|app ?store)\b/gi],
  ["Web Development", /\b(website|web ?site|wordpress|shopify|landing page|domain|hosting|e-?commerce|online store|web app)\b/gi],
  ["Google Ads", /\b(google ads|google par ad|search ads|youtube ads|google ranking ads)\b/gi],
  ["Snapchat Ads", /\b(snap(chat)? ads?)\b/gi],
  ["Meta Ads (Facebook + Instagram)", /\b(facebook ads?|fb ads?|instagram ads?|insta ads?|meta ads?|ads?|advertis\w*|boost\w*|campaigns?|sponsored|leads chahiye)\b/gi],
  ["SEO", /\b(seo|google (ranking|first page)|search engine)\b/gi],
  ["Social Media Management", /\b(social media|page manage\w*|manage (my|hamara|mera) page|page handl\w*|followers|posting|smm|content calendar)\b/gi],
  ["Branding", /\b(branding|brand identity|brand guide|brand kit)\b/gi],
  ["Graphic Design", /\b(logo|designs?|poster|flyer|banner|menu card|visiting card|business card|brochure|thumbnail|post design)\b/gi],
  ["Video Editing", /\b(video edit\w*|editing|reels?|shorts|capcut|premiere|edit (karni|karwani|karwana))\b/gi],
  ["Video Production", /\b(shoot|video production|ad film|animation|promo video|videography)\b/gi],
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
