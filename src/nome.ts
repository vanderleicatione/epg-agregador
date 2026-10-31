// Chave de casamento de nomes de canal, na linha de chave_guia() do tivimate/atualizar.py.
// Só casa por igualdade da chave (sem prefixo/aproximação): melhor ficar sem guia que mostrar o guia errado.

const QUALIDADE = /\b(fhd|hd|sd|4k|uhd|h ?264|hd264|720p|1080p)\b/g;

export function chave(nome: string): string {
  let n = nome.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
  n = n.replace(/^[^/]+\/[a-z]{2}\s+/, ""); // "São Paulo/SP  Globo" (epgshare BR1)
  n = n.replace(/_local|\(.*?\)|ᴴᴰ|³/g, " ").replace(/&/g, " e ").replace(QUALIDADE, " ");
  return n.replace(/[^a-z0-9+]+/g, " ").trim();
}

/** Parte estável do id do canal no feed: "That's ROCK" -> "thats-rock". Mantém HD/SD ("RBI HD" ≠ "RBI SD"). */
export function slug(nome: string): string {
  const n = nome.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/['’]/g, "");
  return n.replace(/\+/g, " mais ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Chaves a procurar para um canal, na ordem: apelidos primeiro, depois o próprio nome. */
export function chavesDe(nome: string, apelidos: Record<string, string[]>): string[] {
  const k = chave(nome);
  const ap = Object.entries(apelidos).find(([n]) => chave(n) === k)?.[1] ?? [];
  return [...new Set([...ap.map(chave), k])].filter(Boolean);
}

/** Chaves de um canal de guia: cada display-name e o id ("dpa-fast" da Pluto vira "dpa fast"). */
export const chavesCanal = (c: { id: string; nomes: string[] }) => [...c.nomes, c.id].map(chave);

/** chave -> canal, para os canais que `usar` aceita; com a mesma chave, o primeiro canal ganha. */
export function indexar<C extends { id: string; nomes: string[] }>(canais: C[], usar: (c: C) => boolean = () => true): Map<string, C> {
  const m = new Map<string, C>();
  for (const c of canais) if (usar(c)) for (const k of chavesCanal(c)) if (!m.has(k)) m.set(k, c);
  return m;
}

/** Primeiro canal que casa: a ordem das chaves (apelidos antes do nome) vale mais que a ordem das fontes. */
export function casar<C>(chaves: string[], indices: Map<string, C>[]): { fonte: number; canal: C } | undefined {
  for (const k of chaves)
    for (const [fonte, idx] of indices.entries()) {
      const canal = idx.get(k);
      if (canal) return { fonte, canal };
    }
}

function distancia(a: string, b: string): number {
  let ant = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(ant[j] + 1, cur[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    ant = cur;
  }
  return ant[b.length];
}

/** Até 3 chaves dos guias parecidas com `k` (distância até 1/3 do tamanho, mesmos números), para o relatório. Nunca usadas para casar. */
export function sugestoes(k: string, indices: Map<string, unknown>[]): string[] {
  const limite = Math.floor(k.length / 3);
  if (!limite) return [];
  const num = (x: string) => x.replace(/\D/g, ""); // ESPN 4 nunca sugere ESPN 2
  const todas = new Set(indices.flatMap((i) => [...i.keys()]).filter((c) => num(c) === num(k)));
  return [...todas].map((c) => [c, distancia(k, c)] as const).filter(([, d]) => d <= limite)
    .sort((x, y) => x[1] - y[1]).slice(0, 3).map(([c]) => c);
}
