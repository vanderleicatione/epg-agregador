// Gera public/guia.xml.gz, public/logos/*.png e public/relatorio.md a partir do config.json.
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { casar, chavesCanal, chavesDe, indexar, slug } from "./nome.ts";
import { lerFuso, lerXmltv, escreverXmltv, validarXmltv, type CanalGuia, type CanalSaida, type Programa } from "./xmltv.ts";
import { baixarPng, logoDeTexto, logosClaro, logosIptvOrg, type FontesLogo } from "./logos.ts";

interface Alvo { numero: string; nome: string; guiaNoTif?: boolean; logo?: string }
interface Config {
  urlBase: string; fuso: string; janela: { diasAntes: number; diasDepois: number };
  guias: string[]; logos: FontesLogo; apelidos: Record<string, string[]>;
  canais: Record<string, Alvo[]>;
}

const SAIDA = "public";
const DIA = 86_400_000;

async function baixarGuia(url: string, quer: (c: CanalGuia) => boolean, de: number, ate: number) {
  const r = await fetch(url, { headers: { "User-Agent": "epg-agregador" }, signal: AbortSignal.timeout(300_000) });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  let corpo: Readable = Readable.fromWeb(r.body as any);
  if (url.endsWith(".gz")) corpo = corpo.pipe(createGunzip());
  return lerXmltv(corpo, quer, de, ate);
}

async function main() {
  const cfg: Config = JSON.parse(await readFile("config.json", "utf8"));
  const fuso = lerFuso(cfg.fuso);
  const hoje = Math.floor((Date.now() + fuso * 60000) / DIA) * DIA - fuso * 60000; // 00:00 de hoje no fuso
  const de = hoje - cfg.janela.diasAntes * DIA, ate = hoje + (cfg.janela.diasDepois + 1) * DIA;

  const alvos = Object.entries(cfg.canais).flatMap(([fonte, l]) =>
    l.map((c) => ({ ...c, fonte, id: `${fonte}.${slug(c.nome)}`, chaves: chavesDe(c.nome, cfg.apelidos) })));
  const repetido = alvos.find((a, i) => alvos.findIndex((b) => b.id === a.id) !== i);
  if (repetido) throw new Error(`id repetido: ${repetido.id}`);
  const procuradas = new Set(alvos.flatMap((a) => a.chaves));

  // guias e índices de logo em paralelo; uma fonte fora do ar só reduz a cobertura (vai para o relatório)
  const falhas: string[] = [];
  const nota = <T>(nome: string, p: Promise<T>, vazio: T) => p.catch((e) => { falhas.push(`${nome}: ${e.message}`); return vazio; });
  const [guias, claro, iptv] = await Promise.all([
    Promise.all(cfg.guias.map((u) => nota(u, baixarGuia(u, (c) => chavesCanal(c).some((k) => procuradas.has(k)), de, ate),
      { canais: [], programas: new Map<string, Programa[]>() }))),
    nota("logos Claro", logosClaro(cfg.logos.claro), new Map<string, string>()),
    nota("logos iptv-org", logosIptvOrg(cfg.logos.iptvOrg), new Map<string, string>()),
  ]);

  // por fonte de guia: chave -> canais com programas na janela (o primeiro canal com a chave ganha)
  const indices = guias.map((g) => indexar(g.canais, (c) => !!g.programas.get(c.id)?.length));
  const icones = indexar(guias.flatMap((g) => g.canais), (c) => !!c.icone);

  await rm(SAIDA, { recursive: true, force: true });
  await mkdir(`${SAIDA}/logos`, { recursive: true });

  const saida: CanalSaida[] = [];
  const linhas: { id: string; fonte: string; numero: string; nome: string; guia: string; logo: string; guiaNoTif: boolean }[] = [];
  // 8 canais por vez, para não disparar 181 downloads de uma vez nos CDNs das logos
  let proximo = 0;
  await Promise.all(Array.from({ length: 8 }, async () => { while (proximo < alvos.length) await gerarCanal(alvos[proximo++]); }));
  async function gerarCanal(a: (typeof alvos)[number]) {
    const achou = casar(a.chaves, indices);
    const programas = achou ? guias[achou.fonte].programas.get(achou.canal.id)! : [];
    const guia = achou ? `${new URL(cfg.guias[achou.fonte]).pathname.split("/").pop()}: ${achou.canal.id}` : "";
    const candidatos: [string, string | undefined][] = [
      ["config", a.logo],
      ...a.chaves.flatMap((k): [string, string | undefined][] => [["Claro", claro.get(k)], ["iptv-org", iptv.get(k)], ["XMLTV", icones.get(k)?.icone]]),
    ];
    let png: Buffer | undefined, logo = "texto (gerada)";
    const erros: string[] = [];
    procura: for (const [fonte, url] of candidatos) {
      if (!url) continue;
      for (const _ of [1, 2]) // uma nova tentativa antes de passar para a próxima fonte
        try { png = await baixarPng(url); logo = `${fonte}: ${url}`; break procura; } catch (e) { erros.push(`${fonte}: ${(e as Error).message}`); }
    }
    if (!png && erros.length) logo += ` — falhou: ${[...new Set(erros)].join("; ")}`;
    await writeFile(`${SAIDA}/logos/${a.id}.png`, png ?? await logoDeTexto(a.nome));
    programas.sort((x, y) => x.inicio - y.inicio);
    saida.push({ id: a.id, nome: a.nome, icone: `${cfg.urlBase}logos/${a.id}.png`, programas });
    linhas.push({ id: a.id, fonte: a.fonte, numero: a.numero, nome: a.nome, guia, logo, guiaNoTif: !!a.guiaNoTif });
  }
  const ordem = new Map(alvos.map((a, i) => [a.id, i]));
  saida.sort((x, y) => ordem.get(x.id)! - ordem.get(y.id)!);
  linhas.sort((x, y) => ordem.get(x.id)! - ordem.get(y.id)!);

  const arquivo = `${SAIDA}/guia.xml.gz`;
  await pipeline(Readable.from(escreverXmltv(saida, fuso, "epg-agregador")), createGzip({ level: 9 }), createWriteStream(arquivo));
  const erros = await validarXmltv(createReadStream(arquivo).pipe(createGunzip()));
  if (erros.length) throw new Error(`XMLTV inválido:\n${erros.slice(0, 20).join("\n")}`);

  await writeFile(`${SAIDA}/relatorio.md`, relatorio(linhas, falhas, (await stat(arquivo)).size, de, ate, saida));
  const semGuia = linhas.filter((l) => !l.guia && !l.guiaNoTif).length, semLogo = linhas.filter((l) => l.logo.startsWith("texto")).length;
  console.log(`${linhas.length} canais; sem guia (TIF também não tem): ${semGuia}; logo gerada por texto: ${semLogo}; falhas: ${falhas.length}`);
}

function relatorio(linhas: { fonte: string; numero: string; nome: string; guia: string; logo: string; guiaNoTif: boolean }[],
  falhas: string[], bytes: number, de: number, ate: number, saida: CanalSaida[]): string {
  const tab = (l: typeof linhas) => l.length ? "| Fonte | Número | Nome |\n|---|---|---|\n" + l.map((x) => `| ${x.fonte} | ${x.numero} | ${x.nome} |`).join("\n") : "Nenhum.";
  const semGuia = linhas.filter((l) => !l.guia && !l.guiaNoTif);
  const semGuiaTif = linhas.filter((l) => !l.guia && l.guiaNoTif);
  const semLogo = linhas.filter((l) => l.logo.startsWith("texto"));
  const progs = saida.reduce((n, c) => n + c.programas.length, 0);
  return `# Relatório do guia

Gerado em ${new Date().toISOString()}. Janela: ${new Date(de).toISOString()} a ${new Date(ate).toISOString()}.
Feed: \`guia.xml.gz\`, ${(bytes / 1024).toFixed(0)} KB, ${linhas.length} canais, ${progs} programas.

| | Canais |
|---|---|
| Com guia no feed | ${linhas.length - semGuia.length - semGuiaTif.length} |
| Sem guia no feed, mas o TIF da TV tem | ${semGuiaTif.length} |
| **Sem guia em lugar nenhum** | **${semGuia.length}** |
| Com logo de uma fonte | ${linhas.length - semLogo.length} |
| **Logo gerada com o nome (nenhuma fonte tinha)** | **${semLogo.length}** |

## Fontes que falharam nesta execução

${falhas.length ? falhas.map((f) => `- ${f}`).join("\n") : "Nenhuma."}

## Sem guia em lugar nenhum

${tab(semGuia)}

## Logo gerada com o nome

${tab(semLogo)}

<details><summary>Todos os canais: de onde veio o guia e a logo</summary>

| Fonte | Número | Nome | Guia | Logo |
|---|---|---|---|---|
${linhas.map((l) => `| ${l.fonte} | ${l.numero} | ${l.nome} | ${l.guia || (l.guiaNoTif ? "— (TIF)" : "**—**")} | ${l.logo} |`).join("\n")}

</details>
`;
}

main().catch((e) => { console.error(e); process.exit(1); });
