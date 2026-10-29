import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { casar, chave, chavesDe, indexar, slug } from "../src/nome.ts";

const cfg = JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8"));

// índice de um guia de mentira, com nomes como as fontes reais escrevem
const guia = indexar([
  { id: "São.Paulo/SP..Globo.br", nomes: ["São Paulo/SP  Globo"] },
  { id: "Globo SP_local", nomes: ["Globo SP_local"] },
  { id: "ESPN 2", nomes: ["ESPN 2"] },
  { id: "ESPN 3", nomes: ["ESPN 3"] },
  { id: "dpa-fast", nomes: ["dpa-fast"] },
  { id: "Sabor.&.Arte.br", nomes: ["Sabor & Arte"] },
  { id: "TV Cultura SP_local", nomes: ["TV Cultura SP_local"] },
  { id: "tv-cultura", nomes: ["tv-cultura"] },
]);
const casa = (nome: string) => casar(chavesDe(nome, cfg.apelidos), [guia])?.canal.id;

test("chave tira ponto, qualidade, acento, cidade e _local", () => {
  assert.equal(chave(".Globo HD"), "globo");
  assert.equal(chave("São Paulo/SP  Globo"), "globo");
  assert.equal(chave("Globo SP_local"), "globo sp");
  assert.equal(chave("REDEVIDA EDUCAÇÃO"), "redevida educacao");
  assert.equal(chave(".Rede TV! HD"), "rede tv");
  assert.equal(chave("Pokémon"), "pokemon");
});

test(".Globo HD casa com a Globo SP pelo apelido", () => {
  assert.deepEqual(chavesDe(".Globo HD", cfg.apelidos), ["globo sp", "globo"]);
  assert.equal(casa(".Globo HD"), "Globo SP_local");
});

test("o apelido vale mais que o nome: TV Cultura vai para a de SP, não para a da Pluto", () => {
  assert.equal(casa("TV CULTURA HD"), "TV Cultura SP_local");
  assert.equal(casa("TV Cultura"), "TV Cultura SP_local");
});

test("ESPN 2 não casa com ESPN 3", () => {
  assert.equal(casa("ESPN 2"), "ESPN 2");
  assert.equal(casa("ESPN 3"), "ESPN 3");
  assert.equal(casa("ESPN 4"), undefined);
  assert.equal(casa("ESPN"), undefined);
});

test("sem casamento por prefixo: Runtime não pega Runtime Ação", () => {
  const g = indexar([{ id: "runtime-acao", nomes: ["Runtime Ação"] }]);
  assert.equal(casar(chavesDe("Runtime", {}), [g]), undefined);
  assert.equal(casar(chavesDe("Runtime Ação", {}), [g])?.canal.id, "runtime-acao");
});

test("nomes da Pluto (slug) e com & casam", () => {
  assert.equal(casa("DPA Fast"), "dpa-fast");
  assert.equal(casa("Sabor & Arte"), "Sabor.&.Arte.br");
});

test("a primeira fonte ganha quando duas têm o canal", () => {
  const a = indexar([{ id: "a", nomes: ["Band"] }]), b = indexar([{ id: "b", nomes: ["BAND HD"] }]);
  assert.deepEqual(casar(["band"], [a, b]), { fonte: 0, canal: { id: "a", nomes: ["Band"] } });
});

test("slug estável e sem colisão entre os canais-alvo", () => {
  assert.equal(slug("That's ROCK"), "thats-rock");
  assert.equal(slug("Jojo’s Bizarre Adventure"), "jojos-bizarre-adventure");
  assert.equal(slug(".Globo HD"), "globo-hd");
  assert.notEqual(slug("RBI HD"), slug("RBI SD"));
  assert.equal(slug("Bloomberg TV+"), "bloomberg-tv-mais");
  const ids = Object.entries(cfg.canais as Record<string, { nome: string }[]>).flatMap(([f, l]) => l.map((c) => `${f}.${slug(c.nome)}`));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 181);
});
