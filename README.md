# epg-agregador

Gera, a cada 6 h no GitHub Actions, um guia XMLTV pequeno com logo PNG para os canais da antena e da TCL Channel+ da TV e para a lista mestra inteira do Canais+, e publica no GitHub Pages.

- Feed: https://vanderleicatione.github.io/epg-agregador/guia.xml.gz
- Cobertura da última execução: https://vanderleicatione.github.io/epg-agregador/relatorio.md
- Canais, apelidos e fontes: [`config.json`](config.json). Formato do feed: seção "Agregador" do `plano-canais.md`.
- Lista mestra do Canais+: [`lista_mestra.json`](lista_mestra.json), cópia gravada por `canais-plus/tools/gerar_lista_mestra.mjs` (id do feed `opentv.<id>`; os apelidos também vão como `display-name`). Canais sem guia ganham sugestões no relatório, só para aprovar.

```
npm ci && npm test && npm run gerar   # saída em public/
```
