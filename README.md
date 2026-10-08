# Eleição Limpa - Brasil

Aplicacao full stack para consultar candidaturas e sinais de cassacao a partir de dados oficiais do TSE.

## O que ja esta implementado

- API Node.js + Express com SQLite local (`better-sqlite3`)
- Sincronizacao de dados oficiais do TSE via ZIP + CSV (`/api/sync`)
- Consulta de candidatos com filtros de nome, UF, ano e alerta de risco (`/api/candidates`)
- Detalhe do candidato com motivos de cassacao vinculados
- Cruzamento municipal de votacao do TSE com indicadores do IBGE, sem upload de arquivos
- Cruzamento presidencial em nivel Brasil com agregacao segura por codigo IBGE
- Mapa municipal, grafico de dispersao, agrupamento por quintis e tira-duvidas opcional
- Frontend Angular com telas de consulta, cruzamento, sincronizacao e tutorial (manual de uso na aba "Tutorial")
- Aviso de boas-vindas na primeira visita, com atalho direto para o tutorial (fechavel pelo X, clique fora ou Esc)

## Estrutura

- `server`: API e persistencia SQLite
- `client`: frontend Angular
- `package.json` (raiz): scripts para rodar API e frontend juntos

## Requisitos

- Node.js 18+ (recomendado Node 22 LTS; `better-sqlite3` requer uma versao compativel com os binarios nativos disponiveis)
- npm 9+

## Instalar dependencias

No diretorio raiz:

```bash
npm install
```

Se for a primeira execucao em uma maquina nova, instale tambem os modulos do backend:

```bash
npm install --prefix server
```

## Rodar em desenvolvimento

```bash
npm run dev
```

Servicos esperados:

- API: `http://localhost:3000`
- Frontend: `http://localhost:4200`

## Endpoints principais da API

- `GET /api/health` - status da API
- `GET /api/stats` - totais no banco local
- `GET /api/candidates?nome=&uf=SP&ano=2022&cargo=Prefeito&partido=PT&apenasRisco=&limit=&offset=` - busca de candidatos (parâmetro de busca: `q` — `nome` é aceito como alias para compatibilidade)
- `GET /api/candidates/options` - cargos e partidos disponiveis para os filtros da consulta
- `GET /api/candidates/:sqCandidato?uf=SP&ano=2022` - detalhe + cassacoes
- `GET /api/crossings/options?ano=2022&uf=BRASIL` - cargos, turnos e partidos disponiveis
- `GET /api/crossings/candidates?ano=2024&uf=SP&cargo=Prefeito&turno=1&busca=Silva` - busca de candidatos sob demanda (ate 100 opcoes)
- `GET /api/crossings?ano=2022&uf=SP&cargo=PRESIDENTE&turno=1&candidato=...&indicador=populacao` - cruzamento TSE x IBGE
- `GET /api/crossings/party?ano=2022&uf=BRASIL&cargo=Presidente&turno=1&partido=PT&indicador=populacao` - cruzamento agregado por partido
- `GET /api/crossings/map/BRASIL` - malha municipal nacional do IBGE
- `GET /api/assistant/status` - disponibilidade do tira-duvidas
- `POST /api/assistant` - pergunta sobre a aplicacao, fontes e metodologia
- `POST /api/sync` - importa dados do TSE

O cruzamento baixa no servidor o pacote oficial de votacao do TSE e consulta a API de Agregados do IBGE. A leitura dos CSVs do TSE e interna: nenhum arquivo precisa ser selecionado ou enviado pelo navegador. Eleicoes disponiveis: 2016, 2018, 2020, 2022, 2024 e 2026. A opcao `BRASIL` consulta o CSV nacional e agrega votos por codigo IBGE municipal, restrita a Presidente (agregar os 27 CSVs por UF estourava memoria/tempo); para anos sem cargo presidencial no pacote, a API informa a indisponibilidade. Os demais cargos estaduais/federais podem ser analisados por UF.

Cada cruzamento retorna de uma vez a cesta municipal de fatores, para que a troca de indicador e a comparacao sejam feitas no navegador sem novas consultas ao IBGE:

- **Demografia:** populacao e densidade (SIDRA 4714), idade mediana, indice de envelhecimento e razao de sexo (9515), percentual da populacao em area urbana (9923), Censo 2022.
- **Economia:** PIB municipal (SIDRA 5938) no ultimo periodo disponivel e PIB per capita calculado com a populacao do Censo 2022.
- **Educacao:** alfabetizacao de pessoas com 15 anos ou mais (SIDRA 10091) e percentual de pessoas com 18 anos ou mais com superior completo (10061), Censo 2022.
- **Infraestrutura:** percentuais de domicilios ocupados com abastecimento de agua pela rede geral (SIDRA 6803), esgotamento por rede/fossa ligada a rede (6805) e lixo coletado (6892), Censo 2022.

Os fatores sao buscados em paralelo e armazenados em cache no servidor. As comparacoes exibidas sao bivariadas (um fator por vez), nao controlam os demais fatores e nao constituem um modelo multivariado. A cesta representa indicadores municipais para os quais ha series comparaveis disponiveis nas fontes descritas; nao significa que todos os determinantes socioeconomicos estejam cobertos. Renda e ocupacao nao estao incluidos nesta versao, e indicadores de cor ou raca nao sao apresentados porque uma serie municipal com definicao e periodo compativeis ainda nao foi validada. A interface apresenta cobertura por fator e periodo de referencia.

Este e um projeto independente, sem vinculo institucional com o TSE. As referencias a dados oficiais indicam as fontes consultadas, nao uma afiliacao ou endosso.

O percentual do candidato e calculado sobre a soma dos votos nominais registrados no arquivo do municipio/cargo/turno, nao sobre o total oficial de votos validos. A analise por partido soma os votos dos candidatos da mesma sigla em cada municipio antes de calcular o percentual sobre esse mesmo denominador; nao representa coligacoes. O PIB usa o periodo mais recente retornado pela API do IBGE, que pode ser diferente do ano da eleicao; o PIB per capita divide esse valor pela populacao do Censo 2022. Correlacao municipal nao implica causalidade nem permite inferir comportamento individual, perfil de eleitores ou preferencia de voto. As correlacoes e os p-valores exibidos sao exploratorios: o teste convencional pressupoe observacoes independentes, uma hipotese que pode nao valer entre municipios espacialmente proximos; interprete tamanho do efeito, cobertura e contexto, nao apenas o p-valor.

Exemplo de sincronizacao:

```bash
curl -X POST "http://localhost:3000/api/sync" \
  -H "Content-Type: application/json" \
  -d '{"ano":2022,"uf":"SP"}'
```

## Variaveis de ambiente (backend)

- `PORT` (padrao `3000`)
- `SQLITE_PATH` (opcional, caminho customizado do banco)
- `CORS_ORIGINS` (padrao `http://localhost:4200`)
- `GEMINI_API_KEY` (opcional, habilita o tira-duvidas; mantenha a chave somente no servidor)
- `GEMINI_MODEL` (opcional, padrao `gemini-2.5-flash`)
- `SYNC_TOKEN` (opcional) — exige `Authorization: Bearer <token>` ou header `x-sync-token` nas requisições `POST /api/sync`; sem a variável, a rota continua aberta (compatibilidade com ambientes locais)

O tira-duvidas recusa perguntas fora do escopo eleitoral e da aplicacao, limita perguntas a 500 caracteres e a oito requisicoes por IP, por processo, a cada 15 minutos. No nivel gratuito da API Gemini, as perguntas podem ser usadas pelo Google para melhorar os produtos; a interface informa essa condicao antes do envio. Nao envie dados pessoais. Sem `GEMINI_API_KEY`, os demais recursos continuam disponiveis e o assistente fica desativado.

Exemplo de pergunta:

```bash
curl -X POST "http://localhost:3000/api/assistant" \\
  -H "Content-Type: application/json" \\
  -d '{"question":"Como interpretar a correlacao?","context":{"uf":"SP","indicador":"Populacao residente"}}'
```

## Solucao de problemas

### Erro do `better-sqlite3` por versao de Node

O backend usa SQLite nativo. Node 26 nao e compativel com a versao atual de `better-sqlite3`; use Node 22 LTS. Se aparecer erro de modulo nativo compilado para outra versao do Node, rode:

```bash
npm rebuild better-sqlite3 --prefix server
```

## Build de producao do frontend

```bash
npm run build --prefix client
```

## Comportamento padrão do Cruzamento

- **Cargo e turno só ficam vazios no primeiro paint.** Enquanto o catálogo do TSE não chega, os selects mostram o placeholder `"Buscando cargos do TSE…"` / `"Buscando turnos do TSE…"` (diretamente no campo, sem externar um badge). Assim que o catálogo responder, os valores já vêm preenchidos e a lista é filtrada por um único clique.
- **Carga sem trava:** o estado de carregamento do catálogo reflete nas placeholders de cargo e turno, para nunca se perder o contexto de onde o usuário está.
- **Lista de espera do candidato (sem preenchimento automático):** com cargo/turno setados e sem resultado, o formulário mostra um bloco de estado:
  - **Modo candidato** — remete ao usuário para escolher um candidato; ao lado, na horizontal, aparecem os **3 candidatos mais votados** como botões de um clique (`{{ nome }} · {{ votos }} votos`). O resultado só renderiza o alvo do candidato depois da escolha (ou de um deep-link que expresse explicitamente `candidato=<sqCandidato>`).
  - **Modo partido** — indica que cargo/turno já estão pré-preenchidos e peça para escolher a sigla; se o cargo/turno não tiver partido, avisa `Nenhum partido disponível para este cargo/turno`.
  - Se um dos filtros não tiver registros, avisa `Nenhum candidato disponível para este cargo/turno`.
- **Deep-link para abrir um contexto específico:**

  ```text
  ?ano=2026&uf=SP&indicador=populacao&modo=partido&partido=PT&vis=map&escala=log
  ```

  O deep-link define o alvo remetente (cargo/turno/partido) e o formulário os preconta. O candidato só é carregado pela seleção no formulário (ou pelo deep-link `candidato=<sqCandidato>`).
