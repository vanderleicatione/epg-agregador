// Índices de logo (nome -> URL) e conversão para PNG.
import sharp from "sharp";
import { chave } from "./nome.ts";

export interface FontesLogo {
  claro: { grades: string; imagens: string };
  iptvOrg: { canais: string; logos: string };
}

const UA = { "User-Agent": "epg-agregador (+https://github.com/vanderleicatione)" };

async function json(url: string): Promise<any> {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

/** Chave -> logo SVG, juntando todas as grades da Claro (de-para-grade.json lista os grupos). */
export async function logosClaro(f: FontesLogo["claro"]): Promise<Map<string, string>> {
  const grupos = new Set<string>((await json(f.grades + "de-para-grade.json")).map((g: any) => g.group));
  const mapa = new Map<string, string>();
  for (const g of grupos) {
    const grade = await json(`${f.grades}${g}.json`).catch(() => ({}));
    for (const lista of Object.values(grade))
      for (const c of Array.isArray(lista) ? lista : [])
        // claro.svg é a logo genérica que a Claro põe quando não tem a do canal
        if (c?.nome && c.imagem && !/\/claro\.svg$/i.test(c.imagem.trim()) && !mapa.has(chave(c.nome))) mapa.set(chave(c.nome), f.imagens + String(c.imagem).trim().toLowerCase());
  }
  return mapa;
}

/** Chave (nome e nomes alternativos) -> logo do iptv-org. Canal do Brasil ganha de canal de fora com o mesmo nome. */
export async function logosIptvOrg(f: FontesLogo["iptvOrg"]): Promise<Map<string, string>> {
  const [canais, logos] = await Promise.all([json(f.canais), json(f.logos)]);
  const logoDe = new Map<string, string>();
  for (const l of logos as any[]) if (l.in_use !== false && !l.feed && !logoDe.has(l.channel)) logoDe.set(l.channel, l.url);
  const mapa = new Map<string, { url: string; br: boolean }>();
  for (const c of canais as any[]) {
    const url = logoDe.get(c.id);
    if (!url || c.closed) continue;
    const br = c.country === "BR";
    for (const n of [c.name, ...(c.alt_names ?? [])]) {
      const k = chave(n), velho = mapa.get(k);
      if (!velho || (br && !velho.br)) mapa.set(k, { url, br });
    }
  }
  return new Map([...mapa].map(([k, v]) => [k, v.url]));
}

const LARGURA = 320, ALTURA = 180;

/** Qualquer imagem (PNG, JPEG, WebP, SVG) -> PNG de até 320×180, fundo transparente. */
export async function paraPng(img: Buffer): Promise<Buffer> {
  return sharp(img, { density: 300 }).resize(LARGURA, ALTURA, { fit: "inside", withoutEnlargement: true }).png({ palette: true }).toBuffer();
}

export async function baixarPng(url: string): Promise<Buffer> {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return paraPng(Buffer.from(await r.arrayBuffer()));
}

/** Último recurso: o nome do canal escrito em branco, para nenhum canal ficar sem logo. */
export function logoDeTexto(nome: string): Promise<Buffer> {
  const t = nome.replace(/^\./, "").trim().replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const tam = Math.min(44, Math.floor(560 / t.length)); // ~0,57 em por letra: cabe em 320 px
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LARGURA}" height="${ALTURA}">` +
    `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="${tam}" fill="#fff">${t}</text></svg>`;
  return sharp(Buffer.from(svg)).png({ palette: true }).toBuffer();
}
