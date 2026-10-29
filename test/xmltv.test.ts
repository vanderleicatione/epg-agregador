import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { escreverHora, escreverXmltv, lerFuso, lerHora, lerXmltv, validarXmltv, type CanalSaida } from "../src/xmltv.ts";

const ler = (s: string) => Readable.from([s]);
const H = (s: string) => lerHora(s);

test("horário: lê qualquer fuso e escreve em UTC-3", () => {
  const fuso = lerFuso("-0300");
  assert.equal(fuso, -180);
  assert.equal(escreverHora(H("20261029120000 +0000"), fuso), "20261029090000 -0300");
  assert.equal(escreverHora(H("20261029120000 +0100"), fuso), "20261029080000 -0300");
  assert.equal(escreverHora(H("20261029010000 +0000"), fuso), "20261028220000 -0300"); // vira o dia
  assert.equal(escreverHora(H("20261029090000 -0300"), fuso), "20261029090000 -0300");
  assert.equal(H("20261029120000"), Date.UTC(2026, 9, 29, 12)); // sem fuso = UTC
  assert.ok(Number.isNaN(H("29/10/2026")));
});

const FONTE = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="globo"><display-name lang="pt">Globo SP</display-name><icon src="https://x/globo.png"/></channel>
  <channel id="outro"><display-name>Outro</display-name></channel>
  <programme start="20261029090000 -0300" stop="20261029100000 -0300" channel="globo">
    <title>Bom Dia &amp; Cia</title><desc><![CDATA[Notícias <ao vivo>]]></desc><category>Jornal</category>
  </programme>
  <programme start="20261101090000 -0300" stop="20261101100000 -0300" channel="globo"><title>Fora da janela</title></programme>
  <programme start="20261029090000 -0300" stop="20261029100000 -0300" channel="outro"><title>Não pedido</title></programme>
  <programme start="20261029110000 -0300" stop="20261029120000 -0300" channel="globo"><title>Entidade &nbsp; desconhecida</title></programme>
</tv>`;

test("parser: guarda só canais pedidos e programas da janela; aceita CDATA e entidade estranha", async () => {
  const de = H("20261029000000 -0300"), ate = H("20261030000000 -0300");
  const r = await lerXmltv(ler(FONTE), (c) => c.nomes.includes("Globo SP"), de, ate);
  assert.deepEqual(r.canais.map((c) => c.id), ["globo", "outro"]);
  assert.equal(r.canais[0].icone, "https://x/globo.png");
  assert.equal(r.programas.has("outro"), false);
  const p = r.programas.get("globo")!;
  assert.equal(p.length, 2);
  assert.deepEqual(p[0], { inicio: H("20261029090000 -0300"), fim: H("20261029100000 -0300"), titulo: "Bom Dia & Cia", desc: "Notícias <ao vivo>", categoria: "Jornal" });
});

const canal = (o: Partial<CanalSaida> = {}): CanalSaida => ({
  id: "antena.globo-hd", nome: ".Globo HD", icone: "https://exemplo/logos/antena.globo-hd.png",
  programas: [{ inicio: H("20261029120000 +0000"), fim: H("20261029130000 +0000"), titulo: `A & B <"C">`, desc: "d", categoria: "c" }], ...o,
});

test("o XMLTV gerado passa no validador e volta igual pelo parser", async () => {
  const xml = [...escreverXmltv([canal(), canal({ id: "cplus.x", nome: "That's ROCK", programas: [] })], -180, "teste")].join("");
  assert.deepEqual(await validarXmltv(ler(xml)), []);
  assert.match(xml, /start="20261029090000 -0300"/);
  const r = await lerXmltv(ler(xml), () => true, 0, Infinity);
  assert.deepEqual(r.canais[0], { id: "antena.globo-hd", nomes: [".Globo HD"], icone: "https://exemplo/logos/antena.globo-hd.png" });
  assert.equal(r.programas.get("antena.globo-hd")![0].titulo, `A & B <"C">`);
});

test("o validador pega os erros de esquema", async () => {
  const erros = async (xml: string) => (await validarXmltv(ler(xml))).join("\n");
  assert.match(await erros(`<canais/>`), /raiz <canais>/);
  assert.match(await erros(`<tv><channel id="a"><display-name>A</display-name></channel></tv>`), /sem <icon src>/);
  assert.match(await erros(`<tv><channel id="a"><icon src="x"/></channel></tv>`), /sem display-name/);
  const ch = `<channel id="a"><display-name>A</display-name><icon src="x"/></channel>`;
  assert.match(await erros(`<tv>${ch}${ch}</tv>`), /repetido/);
  assert.match(await erros(`<tv>${ch}<programme start="20261029090000 -0300" stop="20261029100000 -0300" channel="b"><title>t</title></programme></tv>`), /não declarado/);
  assert.match(await erros(`<tv>${ch}<programme start="20261029090000 -0300" stop="20261029080000 -0300" channel="a"><title>t</title></programme></tv>`), /stop inválido/);
  assert.match(await erros(`<tv>${ch}<programme start="ontem" stop="20261029080000 -0300" channel="a"><title>t</title></programme></tv>`), /start inválido/);
  assert.match(await erros(`<tv>${ch}<programme start="20261029090000 -0300" stop="20261029100000 -0300" channel="a"></programme></tv>`), /sem <title>/);
  assert.match(await erros(`<tv>${ch}<programme start="20261029090000 -0300" stop="20261029100000 -0300" channel="a"><title>t</title></programme><channel id="c"><display-name>C</display-name><icon src="x"/></channel></tv>`), /depois de <programme>/);
  assert.match(await erros(`<tv><channel id="a">`), /mal formado/);
});
