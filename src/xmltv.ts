// Ler, escrever e validar XMLTV, sempre por stream.
import sax from "sax";
import type { Readable } from "node:stream";

export interface Programa { inicio: number; fim: number; titulo: string; desc?: string; categoria?: string }
export interface CanalGuia { id: string; nomes: string[]; icone?: string }
export interface CanalSaida { id: string; nome: string; icone: string; programas: Programa[] }

const HORA = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?(?:\s*([+-])(\d\d):?(\d\d))?$/;

/** "-0300" -> -180 (minutos). */
export function lerFuso(fuso: string): number {
  const m = /^([+-])(\d\d):?(\d\d)$/.exec(fuso);
  if (!m) throw new Error(`fuso inválido: ${fuso}`);
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** "20261029000000 -0300" -> ms desde 1970 (UTC). Sem fuso, vale UTC, como diz o XMLTV. */
export function lerHora(s: string): number {
  const m = HORA.exec(s.trim());
  if (!m) return NaN;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  return m[7] ? utc - lerFuso(m[7] + m[8] + m[9]) * 60000 : utc;
}

export function escreverHora(ms: number, fusoMin: number): string {
  const d = new Date(ms + fusoMin * 60000);
  const p = (n: number) => String(n).padStart(2, "0");
  const a = Math.abs(fusoMin);
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}` +
    `${p(d.getUTCMinutes())}${p(d.getUTCSeconds())} ${fusoMin < 0 ? "-" : "+"}${p(Math.floor(a / 60))}${p(a % 60)}`;
}

/**
 * Lê um XMLTV por stream. Só guarda programas dos canais para os quais `quer(canal)` diz sim
 * e que cruzam a janela [de, ate). O resto é descartado na hora, então o arquivo pode ser grande.
 */
export function lerXmltv(entrada: Readable, quer: (c: CanalGuia) => boolean, de: number, ate: number) {
  const canais: CanalGuia[] = [];
  const programas = new Map<string, Programa[]>();
  const parser = sax.createStream(true, { trim: false });
  let canal: CanalGuia | undefined, prog: (Programa & { canal: string }) | undefined;
  let texto = "";
  parser.on("opentag", (t) => {
    const a = t.attributes as Record<string, string>;
    texto = "";
    if (t.name === "channel") canal = { id: a.id ?? "", nomes: [] };
    else if (t.name === "icon" && canal && a.src) canal.icone ??= a.src;
    else if (t.name === "programme") {
      const inicio = lerHora(a.start ?? ""), fim = lerHora(a.stop ?? "");
      const c = a.channel ?? "";
      prog = programas.has(c) && fim > de && inicio < ate && fim > inicio ? { canal: c, inicio, fim, titulo: "" } : undefined;
    }
  });
  parser.on("text", (s) => { texto += s; });
  parser.on("cdata", (s) => { texto += s; });
  parser.on("closetag", (nome) => {
    const s = texto.trim();
    if (canal && nome === "display-name" && s) canal.nomes.push(s);
    else if (nome === "channel" && canal) {
      canais.push(canal);
      if (quer(canal)) programas.set(canal.id, []);
      canal = undefined;
    } else if (prog && nome === "title") prog.titulo ||= s;
    else if (prog && nome === "desc") prog.desc ||= s;
    else if (prog && nome === "category") prog.categoria ||= s;
    else if (prog && nome === "programme") {
      const { canal: c, ...p } = prog;
      if (p.titulo) programas.get(c)!.push(p);
      prog = undefined;
    }
    texto = "";
  });
  return new Promise<{ canais: CanalGuia[]; programas: Map<string, Programa[]> }>((ok, erro) => {
    // fonte de terceiros: um erro pontual (entidade desconhecida etc.) não derruba a leitura
    parser.on("error", () => { const p = (parser as any)._parser; p.error = null; p.resume(); });
    entrada.on("error", erro);
    parser.on("end", () => ok({ canais, programas }));
    entrada.pipe(parser);
  });
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** O XMLTV de saída, em pedaços (para ir direto ao gzip). Canais primeiro, como pede o DTD. */
export function* escreverXmltv(canais: CanalSaida[], fusoMin: number, gerador: string): Generator<string> {
  yield `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE tv SYSTEM "xmltv.dtd">\n<tv generator-info-name="${esc(gerador)}">\n`;
  for (const c of canais)
    yield `<channel id="${esc(c.id)}"><display-name lang="pt">${esc(c.nome)}</display-name><icon src="${esc(c.icone)}"/></channel>\n`;
  for (const c of canais)
    for (const p of c.programas) {
      yield `<programme start="${escreverHora(p.inicio, fusoMin)}" stop="${escreverHora(p.fim, fusoMin)}" channel="${esc(c.id)}">` +
        `<title lang="pt">${esc(p.titulo)}</title>` +
        (p.desc ? `<desc lang="pt">${esc(p.desc)}</desc>` : "") +
        (p.categoria ? `<category lang="pt">${esc(p.categoria)}</category>` : "") + `</programme>\n`;
    }
  yield "</tv>\n";
}

/**
 * Confere o XMLTV contra as regras do DTD que importam para quem lê, mais as do nosso feed:
 * raiz <tv>; <channel id> único com display-name e <icon src>; canais antes dos programas;
 * <programme> com start/stop válidos (stop > start), canal declarado e <title>. Devolve os erros.
 */
export function validarXmltv(entrada: Readable): Promise<string[]> {
  const erros: string[] = [];
  const ids = new Set<string>();
  const parser = sax.createStream(true);
  const pilha: string[] = [];
  let viuPrograma = false, nomes = 0, icone = false, titulo = false, atual = "";
  parser.on("opentag", (t) => {
    const a = t.attributes as Record<string, string>;
    const pai = pilha.at(-1);
    pilha.push(t.name);
    if (pilha.length === 1 && t.name !== "tv") erros.push(`raiz <${t.name}>, esperado <tv>`);
    if (t.name === "channel") {
      atual = a.id ?? ""; nomes = 0; icone = false;
      if (!atual) erros.push("<channel> sem id");
      else if (ids.has(atual)) erros.push(`<channel id="${atual}"> repetido`);
      if (viuPrograma) erros.push(`<channel id="${atual}"> depois de <programme>`);
      ids.add(atual);
    } else if (t.name === "display-name" && pai === "channel") nomes++;
    else if (t.name === "icon" && pai === "channel") icone = !!a.src;
    else if (t.name === "programme") {
      viuPrograma = true; titulo = false;
      atual = `${a.channel} ${a.start}`;
      const ini = lerHora(a.start ?? ""), fim = lerHora(a.stop ?? "");
      if (Number.isNaN(ini)) erros.push(`<programme ${atual}>: start inválido`);
      if (Number.isNaN(fim) || !(fim > ini)) erros.push(`<programme ${atual}>: stop inválido ou antes do start`);
      if (!ids.has(a.channel ?? "")) erros.push(`<programme ${atual}>: canal não declarado`);
    } else if (t.name === "title" && pai === "programme") titulo = true;
  });
  parser.on("closetag", (nome) => {
    pilha.pop();
    if (nome === "channel" && !nomes) erros.push(`<channel id="${atual}"> sem display-name`);
    if (nome === "channel" && !icone) erros.push(`<channel id="${atual}"> sem <icon src>`);
    if (nome === "programme" && !titulo) erros.push(`<programme ${atual}> sem <title>`);
  });
  return new Promise((ok) => {
    parser.on("error", (e) => { erros.push(`XML mal formado: ${e.message.split("\n")[0]}`); ok(erros); });
    parser.on("end", () => ok(erros));
    entrada.pipe(parser);
  });
}
