# Dev News

Agregador leve de notícias de tecnologia: desenvolvimento, segurança da informação e tecnologia em geral. É um site estático (PWA) feito para abrir rápido no celular e ser instalado na tela inicial.

## Recursos

- Lista de notícias em cards com **foto, título e resumo** de algumas linhas.
- **Card clicável**: abre a notícia original em nova aba, no navegador.
- **Subtítulo em português** abaixo do título das notícias em inglês (tradução offline).
- Filtros por categoria (Dev, Segurança, Tecnologia e **Baixada Santista**) e idioma (PT, EN), e busca por texto.
- Tema claro ou escuro automático, conforme o celular.
- Notícias já abertas ficam esmaecidas.
- Funciona offline com a última lista carregada.
- Sem framework e sem servidor: HTML, CSS e JavaScript puros, hospedados de graça no GitHub Pages.

## Fontes

| Categoria | Fontes |
|---|---|
| Tecnologia (Brasil) | Tecnoblog, Canaltech, Olhar Digital, TecMundo, g1 Tecnologia\*, UOL Tilt\* |
| Segurança | CERT.br, BleepingComputer, Krebs on Security, The Hacker News, Dark Reading, Schneier on Security, CISA Alerts, Project Zero |
| Desenvolvimento | Hacker News, Lobsters, InfoQ, GitHub Blog, DEV Community, Pragmatic Engineer |
| Tecnologia (EN) | Ars Technica, The Verge, TechCrunch, The Register, MIT Technology Review |

**Baixada Santista** (aba própria, em laranja): g1 Santos e Região, Santa Portal, Jornal da Orla e duas buscas do Google Notícias (tecnologia e inovação na região), que cobrem A Tribuna, Diário do Litoral, THMais, Portogente e outros. Só entram notícias com termo de tecnologia no **título** (hacker, ciber, inovação, startup, IA, internet...). Os portais A Tribuna e Diário do Litoral bloqueiam leitores automáticos, por isso aparecem apenas via Google Notícias. As notícias do Google Notícias não trazem foto nem resumo.

\* Fontes generalistas: passam por um filtro de palavras-chave para manter só o que é de tecnologia.

## Como funciona

```
sources.json ──> scripts/fetch.mjs ──> public/news.json ──> public/ (site)
                       │
                       └─> scripts/translate.py (títulos EN -> PT)
```

1. `scripts/fetch.mjs` lê os feeds RSS/Atom de `sources.json`, em paralelo. Uma fonte fora do ar não derruba as outras.
2. Normaliza cada item (título, link, fonte, categoria, data, resumo e imagem), remove duplicados e mantém os 200 mais recentes dos últimos 10 dias.
3. O resumo vem do feed, sem HTML e cortado em cerca de 280 caracteres.
4. A imagem vem do feed. Quando falta, o coletor tenta o `og:image` da página da notícia. Só a URL é guardada; a imagem carrega sob demanda no celular.
5. `scripts/translate.py` traduz os títulos em inglês com o modelo offline Argos (via `ctranslate2`, sem torch). As traduções ficam em cache em `.cache/`, então cada coleta traduz só os títulos novos.
6. O resultado vai para `public/news.json`, que o site lê.

## Estrutura

```
sources.json              lista de feeds (editar aqui para mudar as fontes)
filters.json              termos bloqueados (propagandas e ofertas)
scripts/fetch.mjs         coletor de feeds
scripts/translate.py      tradução EN -> PT offline
public/
  index.html, app.js, style.css    site
  sw.js, manifest.webmanifest      PWA (offline e instalação)
  icon.svg, icon-*.png, apple-touch-icon.png   logo e ícones (gerados por scripts/make-icons.py)
  news.json                        gerado, não vai para o git
.github/workflows/update.yml       atualiza e publica a cada 2 horas
```

## Requisitos

- Node.js 18 ou superior (testado no 24).
- Python 3.9 ou superior, só para a tradução. Sem ele o site funciona, apenas sem os subtítulos.

## Uso local

Instale as dependências de tradução (uma vez):

```bash
pip install --target .pydeps ctranslate2 sentencepiece
```

Gere as notícias e sirva o site:

```bash
node scripts/fetch.mjs
python3 -m http.server 8080 -d public
```

Abra `http://localhost:8080`. No celular, use o IP do computador na mesma rede Wi-Fi.
Na primeira tradução, o modelo (cerca de 64 MB) é baixado automaticamente para `.cache/`.

Se mudar o código do site e a versão antiga continuar aparecendo, force a atualização com Ctrl+Shift+R (o service worker guarda arquivos em cache) ou aumente o número da versão em `public/sw.js`.

## Publicar no GitHub Pages

1. Crie um repositório **público** no GitHub (o Pages gratuito exige isso) e envie o código na branch `main`:

   ```bash
   git init -b main
   git add . && git commit -m "Primeira versão do Dev News"
   git remote add origin git@github.com:SEU-USUARIO/dev-news.git
   git push -u origin main
   ```

2. Em **Settings > Pages**, escolha **GitHub Actions** em "Source".
3. O push dispara o workflow `.github/workflows/update.yml`. Acompanhe na aba **Actions**. O site fica em `https://SEU-USUARIO.github.io/dev-news/`.
4. No celular, abra o link e use **Adicionar à tela inicial**.

O workflow roda a cada 2 horas, gera o `news.json` e publica o site. A primeira execução demora mais (instala as dependências e baixa o modelo); as seguintes usam o cache.

Observações:

- O GitHub desativa workflows agendados depois de 60 dias sem atividade no repositório. Se as notícias pararem de atualizar, reative o workflow na aba Actions ou faça um commit.
- O horário do `cron` pode atrasar alguns minutos em horários de pico.

## Personalização

**Adicionar ou remover fontes:** edite `sources.json`. Cada fonte tem:

```json
{ "name": "Tecnoblog", "url": "https://tecnoblog.net/feed/", "category": "geral", "lang": "pt" }
```

- `category`: `dev`, `seguranca`, `geral` (aparece como "Tecnologia" no site) ou `baixada`.
- `lang`: `pt` ou `en`. Só os títulos em `en` são traduzidos.
- `filter` (opcional): expressão regular; só entram itens cujo título ou resumo combinem. Use `"filterOn": "title"` para olhar só o título. Também aceita um padrão nomeado de `filters.json`, como `"@tech"`.
- `region` (opcional): expressão regular (ou `"@regiao"`) que o título também precisa ter.
- `exclude` (opcional): descarta itens cujo título combine.
- `googleNews` (opcional): marque `true` para feeds do Google Notícias (o veículo vem do próprio feed).

Para ampliar a seção regional (outras cidades, outros assuntos), edite `patterns.regiao` e `patterns.tech` em `filters.json`, ou adicione uma busca do Google Notícias em `sources.json`.

**Bloquear propagandas e ofertas:** edite `filters.json`. São listas de expressões regulares (sem diferenciar maiúsculas de minúsculas):

- `blockTitle`: se o **título** combinar, a notícia é descartada (ex.: `mercado ?livre`, `black friday`, `% off`, `cupom`).
- `blockUrl`: se o **endereço** combinar, a notícia é descartada (ex.: `/ofertas/`).

Por padrão ficam de fora lojas e promoções (Mercado Livre, Magalu, Shopee, Prime Day, Black Friday, 11.11), descontos, cupons e guias de compra ("Melhor TV em 2026: 8 modelos para comprar"). Como o filtro olha só o título, uma notícia séria que cite uma loja (por exemplo, um vazamento no Mercado Livre) também seria bloqueada: para liberar, remova o termo da lista. A coleta mostra quantos itens foram bloqueados.

**Ajustes do coletor:** no topo de `scripts/fetch.mjs`, `MAX_ITEMS` (total de notícias), `PER_SOURCE` (por fonte) e `MAX_AGE_DAYS` (idade máxima).

**Frequência:** troque o `cron` em `.github/workflows/update.yml`.

## Limitações

- A tradução usa um modelo pequeno e offline: é boa para entender o assunto, mas pode errar nomes e expressões técnicas.
- Alguns feeds não trazem imagem ou resumo (o Hacker News, por exemplo, só traz o título); nesses casos o card mostra um bloco colorido com a inicial da fonte, ou só o título.
- O site não copia o conteúdo das notícias: mostra apenas título, trecho e link para o original.
