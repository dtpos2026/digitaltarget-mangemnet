// Branded PNG cards drawn on a canvas: the quotation / sales card an assistant
// sends a customer, and a single-product card for sharing. Everything drawn is
// local (data-URL logos and photos, a QR code made in the browser), so the
// canvas is never tainted and the PNG can be saved or sent on WhatsApp.
import QRCode from "qrcode";

export interface CardBrand { companyName: string; logo?: string; phone?: string; website?: string; footer?: string; address?: string; accent?: string }
export interface CardPerson { name: string; designation?: string; phone?: string; email?: string; photo?: string }
export interface CardItem { name: string; icon?: string; logo?: string; detail?: string; qty: number; unitPrice: number }
export interface QuoteCardInput {
  title?: string;
  number: string;
  date: string;
  validTill?: string;
  businessName?: string;
  customer: { name: string; business?: string; phone?: string; city?: string };
  items: CardItem[];
  subtotal: number;
  discount: number;
  total: number;
  features: string[];
  featuresTitle?: string;
  demoUrl?: string;
  notes?: string;
  brand: CardBrand;
  person: CardPerson;
}

const W = 1080;
const PAD = 64;
const FONT = `"Segoe UI", "Inter", "Helvetica Neue", Arial, sans-serif`;
const rs = (n: number) => `Rs ${Math.round(Number(n) || 0).toLocaleString("en-PK")}`;

const loadImg = (src?: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    if (!src) { resolve(null); return; }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Wrapped text; returns the y after the last line. */
function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines = 99): number {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  let line = "";
  let n = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      n++;
      if (n >= maxLines) { ctx.fillText(`${line}…`, x, y); return y + lineH; }
      ctx.fillText(line, x, y);
      y += lineH;
      line = words[i];
    } else line = test;
  }
  if (line) { ctx.fillText(line, x, y); y += lineH; }
  return y;
}

/** Digital Target mark (four triangles), drawn so it is sharp at any size. */
function brandMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  const u = size / 2;
  ctx.fillStyle = color;
  for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    ctx.beginPath();
    ctx.moveTo(x + ox * u, y + oy * u);
    ctx.lineTo(x + (ox + 1) * u, y + oy * u);
    ctx.lineTo(x + (ox + 1) * u, y + (oy + 1) * u);
    ctx.closePath();
    ctx.fill();
  }
}

function initials(name: string) {
  return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

async function drawHeader(ctx: CanvasRenderingContext2D, brand: CardBrand, right: { title: string; lines: string[] }, accent: string) {
  const g = ctx.createLinearGradient(0, 0, W, 230);
  g.addColorStop(0, "#2A0650");
  g.addColorStop(1, accent);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, 230);
  // logo tile
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, PAD, 52, 126, 126, 26);
  ctx.fill();
  const logo = await loadImg(brand.logo);
  if (logo) {
    const k = Math.min(100 / logo.width, 100 / logo.height);
    ctx.drawImage(logo, PAD + 63 - (logo.width * k) / 2, 115 - (logo.height * k) / 2, logo.width * k, logo.height * k);
  } else brandMark(ctx, PAD + 23, 75, 80, "#3D096D");
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 44px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(brand.companyName.toUpperCase().slice(0, 26), PAD + 150, 112);
  ctx.font = `400 23px ${FONT}`;
  ctx.fillStyle = "rgba(255,255,255,.85)";
  ctx.fillText([brand.website, brand.phone].filter(Boolean).join("   •   ").slice(0, 60), PAD + 150, 150);
  // title on the right
  ctx.textAlign = "right";
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 34px ${FONT}`;
  ctx.fillText(right.title, W - PAD, 92);
  ctx.font = `500 21px ${FONT}`;
  ctx.fillStyle = "rgba(255,255,255,.9)";
  right.lines.forEach((l, i) => ctx.fillText(l, W - PAD, 128 + i * 30));
  ctx.textAlign = "left";
}

async function drawPerson(ctx: CanvasRenderingContext2D, p: CardPerson, y: number, accent: string): Promise<number> {
  ctx.fillStyle = "#F5F0FC";
  roundRect(ctx, PAD, y, W - PAD * 2, 150, 24);
  ctx.fill();
  const cx = PAD + 85, cy = y + 75, r = 52;
  const photo = await loadImg(p.photo);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (photo) {
    const k = Math.max((r * 2) / photo.width, (r * 2) / photo.height);
    ctx.drawImage(photo, cx - (photo.width * k) / 2, cy - (photo.height * k) / 2, photo.width * k, photo.height * k);
  } else {
    ctx.fillStyle = accent;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = "#fff";
    ctx.font = `700 40px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(initials(p.name), cx, cy + 14);
    ctx.textAlign = "left";
  }
  ctx.restore();
  ctx.fillStyle = "#6b5b85";
  ctx.font = `600 19px ${FONT}`;
  ctx.fillText("AAP KE SALES CONSULTANT", PAD + 160, y + 46);
  ctx.fillStyle = "#1f1235";
  ctx.font = `800 32px ${FONT}`;
  ctx.fillText(p.name.slice(0, 32), PAD + 160, y + 86);
  ctx.font = `500 22px ${FONT}`;
  ctx.fillStyle = "#4b3b63";
  ctx.fillText([p.designation, p.phone ? `📞 ${p.phone}` : "", p.email].filter(Boolean).join("   •   ").slice(0, 70), PAD + 160, y + 122);
  return y + 150;
}

function drawFooter(ctx: CanvasRenderingContext2D, brand: CardBrand, y: number, accent: string, note?: string): number {
  ctx.fillStyle = accent;
  ctx.fillRect(0, y, W, 6);
  ctx.fillStyle = "#2A0650";
  ctx.fillRect(0, y + 6, W, 96);
  ctx.fillStyle = "#ffffff";
  ctx.font = `600 21px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText((brand.footer || [brand.companyName, brand.phone, brand.website].filter(Boolean).join(" | ")).slice(0, 90), W / 2, y + 50);
  if (note) {
    ctx.font = `400 17px ${FONT}`;
    ctx.fillStyle = "rgba(255,255,255,.75)";
    ctx.fillText(note.slice(0, 110), W / 2, y + 80);
  }
  ctx.textAlign = "left";
  return y + 102;
}

/** Draw on a tall scratch canvas, then crop to the height used. */
async function compose(draw: (ctx: CanvasRenderingContext2D) => Promise<number>): Promise<string> {
  const big = document.createElement("canvas");
  big.width = W;
  big.height = 3200;
  const ctx = big.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, big.height);
  const h = Math.ceil(await draw(ctx));
  const out = document.createElement("canvas");
  out.width = W;
  out.height = h;
  out.getContext("2d")!.drawImage(big, 0, 0);
  return out.toDataURL("image/png");
}

export async function renderQuoteCard(q: QuoteCardInput): Promise<string> {
  const accent = q.brand.accent || "#5B21B6";
  const qr = q.demoUrl ? await QRCode.toDataURL(q.demoUrl, { margin: 1, width: 220 }).catch(() => "") : "";
  const items = await Promise.all(q.items.map(async (it) => ({ it, img: await loadImg(it.logo) })));
  return compose(async (ctx) => {
    await drawHeader(ctx, q.brand, { title: q.title || "QUOTATION", lines: [q.number, q.date, q.validTill ? `Valid till ${q.validTill}` : ""].filter(Boolean) }, accent);
    let y = 280;
    // customer
    ctx.fillStyle = "#6b5b85";
    ctx.font = `600 19px ${FONT}`;
    ctx.fillText(q.businessName ? `PREPARED FOR  •  ${q.businessName.toUpperCase()}` : "PREPARED FOR", PAD, y);
    ctx.fillStyle = "#1f1235";
    ctx.font = `800 40px ${FONT}`;
    ctx.fillText(q.customer.name.slice(0, 34), PAD, y + 48);
    ctx.font = `500 23px ${FONT}`;
    ctx.fillStyle = "#4b3b63";
    ctx.fillText([q.customer.business, q.customer.city, q.customer.phone].filter(Boolean).join("   •   ").slice(0, 80), PAD, y + 86);
    y += 128;

    // items
    ctx.fillStyle = "#2A0650";
    roundRect(ctx, PAD, y, W - PAD * 2, 58, 14);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `700 21px ${FONT}`;
    ctx.fillText("PRODUCT / SERVICE", PAD + 24, y + 37);
    ctx.textAlign = "right";
    ctx.fillText("QTY", W - PAD - 250, y + 37);
    ctx.fillText("AMOUNT", W - PAD - 24, y + 37);
    ctx.textAlign = "left";
    y += 58;
    items.forEach(({ it, img }, i) => {
      const h = it.detail ? 96 : 76;
      ctx.fillStyle = i % 2 ? "#ffffff" : "#FAF7FE";
      ctx.fillRect(PAD, y, W - PAD * 2, h);
      const ix = PAD + 24, iy = y + (h - 48) / 2;
      if (img) {
        const k = Math.min(48 / img.width, 48 / img.height);
        ctx.drawImage(img, ix + 24 - (img.width * k) / 2, iy + 24 - (img.height * k) / 2, img.width * k, img.height * k);
      } else if (it.icon) {
        ctx.font = `36px ${FONT}`;
        ctx.fillText(it.icon, ix + 4, iy + 38);
      }
      ctx.fillStyle = "#1f1235";
      ctx.font = `700 25px ${FONT}`;
      ctx.fillText(it.name.slice(0, 42), PAD + 92, y + (it.detail ? 40 : 46));
      if (it.detail) {
        ctx.font = `400 19px ${FONT}`;
        ctx.fillStyle = "#6b5b85";
        ctx.fillText(it.detail.slice(0, 60), PAD + 92, y + 72);
      }
      ctx.textAlign = "right";
      ctx.fillStyle = "#1f1235";
      ctx.font = `600 24px ${FONT}`;
      ctx.fillText(String(it.qty), W - PAD - 250, y + h / 2 + 8);
      ctx.font = `700 25px ${FONT}`;
      ctx.fillText(rs(it.unitPrice * it.qty), W - PAD - 24, y + h / 2 + 8);
      ctx.textAlign = "left";
      y += h;
    });
    ctx.strokeStyle = "#E7DDF7";
    ctx.lineWidth = 2;
    ctx.strokeRect(PAD, y - items.reduce((s, { it }) => s + (it.detail ? 96 : 76), 0) - 58, W - PAD * 2, items.reduce((s, { it }) => s + (it.detail ? 96 : 76), 0) + 58);
    y += 26;

    // totals
    const tx = W - PAD - 420;
    ctx.font = `500 23px ${FONT}`;
    ctx.fillStyle = "#4b3b63";
    ctx.fillText("Subtotal", tx, y + 26);
    ctx.textAlign = "right";
    ctx.fillText(rs(q.subtotal), W - PAD - 24, y + 26);
    ctx.textAlign = "left";
    if (q.discount > 0) {
      y += 38;
      ctx.fillStyle = "#15803d";
      ctx.fillText("Discount", tx, y + 26);
      ctx.textAlign = "right";
      ctx.fillText(`− ${rs(q.discount)}`, W - PAD - 24, y + 26);
      ctx.textAlign = "left";
    }
    y += 50;
    const tg = ctx.createLinearGradient(tx - 24, 0, W - PAD, 0);
    tg.addColorStop(0, accent);
    tg.addColorStop(1, "#3D096D");
    ctx.fillStyle = tg;
    roundRect(ctx, tx - 24, y, W - PAD - tx + 24, 84, 18);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `700 24px ${FONT}`;
    ctx.fillText("TOTAL", tx, y + 52);
    ctx.textAlign = "right";
    ctx.font = `800 38px ${FONT}`;
    ctx.fillText(rs(q.total), W - PAD - 24, y + 56);
    ctx.textAlign = "left";
    y += 120;

    // features + demo QR
    const feats = q.features.filter(Boolean).slice(0, 8);
    if (feats.length || qr) {
      const top = y;
      ctx.fillStyle = "#1f1235";
      ctx.font = `800 26px ${FONT}`;
      ctx.fillText(q.featuresTitle || "Kya milega", PAD, y + 10);
      y += 48;
      const colW = qr ? (W - PAD * 2 - 260) / 2 : (W - PAD * 2) / 2;
      ctx.font = `500 22px ${FONT}`;
      feats.forEach((f, i) => {
        const cx = PAD + (i % 2) * colW, cy = y + Math.floor(i / 2) * 44;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(cx + 12, cy - 8, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx + 6, cy - 8);
        ctx.lineTo(cx + 11, cy - 3);
        ctx.lineTo(cx + 19, cy - 13);
        ctx.stroke();
        ctx.fillStyle = "#2b1d40";
        ctx.fillText(f.length > 34 ? `${f.slice(0, 33)}…` : f, cx + 34, cy);
      });
      y += Math.ceil(feats.length / 2) * 44;
      if (qr) {
        const img = await loadImg(qr);
        if (img) {
          ctx.drawImage(img, W - PAD - 200, top, 200, 200);
          ctx.fillStyle = "#6b5b85";
          ctx.font = `600 18px ${FONT}`;
          ctx.textAlign = "center";
          ctx.fillText("Scan karein — DEMO", W - PAD - 100, top + 226);
          ctx.textAlign = "left";
        }
        y = Math.max(y, top + 246);
      }
      y += 20;
    }
    if (q.notes) {
      ctx.fillStyle = "#4b3b63";
      ctx.font = `italic 400 21px ${FONT}`;
      y = wrap(ctx, q.notes, PAD, y + 10, W - PAD * 2, 30, 4) + 10;
    }
    y = await drawPerson(ctx, q.person, y + 10, accent);
    return drawFooter(ctx, q.brand, y + 40, accent, "Prices in PKR. Quotation is valid till the date shown.");
  });
}

export interface ProductCardInput {
  name: string; icon?: string; logo?: string; tagline?: string; description?: string; features: string[];
  price: string; demoUrl?: string; businessName?: string; brand: CardBrand; person?: CardPerson;
}

export async function renderProductCard(p: ProductCardInput): Promise<string> {
  const accent = p.brand.accent || "#5B21B6";
  const qr = p.demoUrl ? await QRCode.toDataURL(p.demoUrl, { margin: 1, width: 220 }).catch(() => "") : "";
  const logo = await loadImg(p.logo);
  return compose(async (ctx) => {
    await drawHeader(ctx, p.brand, { title: (p.businessName || "PRODUCT").toUpperCase().slice(0, 22), lines: [] }, accent);
    let y = 290;
    if (logo) {
      const k = Math.min(140 / logo.width, 140 / logo.height);
      ctx.drawImage(logo, PAD, y - 20, logo.width * k, logo.height * k);
    } else if (p.icon) {
      ctx.font = `110px ${FONT}`;
      ctx.fillText(p.icon, PAD, y + 100);
    }
    ctx.fillStyle = "#1f1235";
    ctx.font = `800 52px ${FONT}`;
    y = wrap(ctx, p.name, PAD + 175, y + 40, W - PAD * 2 - 175, 60, 2);
    if (p.tagline) {
      ctx.font = `500 26px ${FONT}`;
      ctx.fillStyle = accent;
      y = wrap(ctx, p.tagline, PAD + 175, y + 4, W - PAD * 2 - 175, 34, 2);
    }
    y = Math.max(y, 450) + 20;
    if (p.description) {
      ctx.fillStyle = "#4b3b63";
      ctx.font = `400 24px ${FONT}`;
      y = wrap(ctx, p.description, PAD, y, W - PAD * 2, 36, 5) + 10;
    }
    const top = y;
    ctx.font = `500 24px ${FONT}`;
    p.features.filter(Boolean).slice(0, 8).forEach((f) => {
      ctx.fillStyle = accent;
      ctx.fillText("✔", PAD, y + 4);
      ctx.fillStyle = "#2b1d40";
      ctx.fillText(f.length > (qr ? 44 : 64) ? `${f.slice(0, qr ? 43 : 63)}…` : f, PAD + 40, y + 4);
      y += 46;
    });
    if (qr) {
      const img = await loadImg(qr);
      if (img) {
        ctx.drawImage(img, W - PAD - 220, top - 20, 220, 220);
        ctx.fillStyle = "#6b5b85";
        ctx.font = `600 18px ${FONT}`;
        ctx.textAlign = "center";
        ctx.fillText("Scan — DEMO", W - PAD - 110, top + 228);
        ctx.textAlign = "left";
      }
      y = Math.max(y, top + 250);
    }
    y += 20;
    const g = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
    g.addColorStop(0, accent);
    g.addColorStop(1, "#3D096D");
    ctx.fillStyle = g;
    roundRect(ctx, PAD, y, W - PAD * 2, 96, 22);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `600 24px ${FONT}`;
    ctx.fillText("PRICE", PAD + 30, y + 58);
    ctx.textAlign = "right";
    ctx.font = `800 34px ${FONT}`;
    ctx.fillText(p.price, W - PAD - 30, y + 60);
    ctx.textAlign = "left";
    y += 130;
    if (p.person) y = (await drawPerson(ctx, p.person, y, accent)) + 30;
    return drawFooter(ctx, p.brand, y + 10, accent);
  });
}

/** data URL → Blob (download / Web Share). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(head)?.[1] || "image/png";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
