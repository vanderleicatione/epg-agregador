# epg-agregador

Gera, a cada 6 h no GitHub Actions, um guia XMLTV pequeno com logo PNG para os canais da antena e da TCL Channel+ da TV, e publica no GitHub Pages.

- Feed: https://vanderleicatione.github.io/epg-agregador/guia.xml.gz
- Cobertura da última execução: https://vanderleicatione.github.io/epg-agregador/relatorio.md
- Canais, apelidos e fontes: [`config.json`](config.json). Formato do feed: seção "Agregador" do `plano-canais.md`.

```
npm ci && npm test && npm run gerar   # saída em public/
```
