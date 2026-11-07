# Inkacre

**Páginas, blocos e bancos de dados que ficam no seu próprio computador — e nos quais o seu agente de IA pode
trabalhar.**

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · Português (Brasil)

![Página de introdução](docs/screenshots/page.png)

O Inkacre é um espaço de trabalho local, para uma só pessoa, no estilo conhecido de blocos e bancos de dados. Tudo fica guardado em um único
arquivo SQLite na sua máquina: sem conta, sem nuvem e sem telemetria. A interface web, um servidor MCP embutido para
agentes de IA e o motor de comandos compartilham esse arquivo, então um agente edita as mesmas páginas que você — e
cada alteração, sua ou do agente, fica registrada e pode ser desfeita.

## O que a maioria dos apps de notas não faz

- **Volte no tempo** — abra todo o espaço de trabalho como estava em qualquer momento anterior, somente leitura e em
  uma aba própria, e traga uma página de volta ao presente ou tire uma cópia.
- **Pesquise dentro dos arquivos** — a pesquisa também encontra palavras em arquivos PDF, Word, Excel, PowerPoint,
  HWPX, OpenDocument e de texto anexados, e mostra o arquivo e a linha.
- **Um mapa de links** — cada página como um ponto, com os links, menções e relações entre elas; abra em torno de uma
  página para ver com o que ela se liga.
- **Capture de qualquer lugar** — adicione uma linha, uma tarefa ou uma linha de banco de dados pelo Atalhos, Raycast,
  um script ou o terminal sem abrir o app; arquivos deixados em uma pasta de entrada chegam à mesma página.
- **Backups automáticos** — a cada hora, dia ou semana quando algo mudou, em outro disco se quiser; qualquer backup
  pode ser verificado ou aberto como um novo espaço.
- **Um espelho em Markdown** — todo o espaço de trabalho como arquivos Markdown e CSV em uma pasta para o Obsidian, um
  editor, o Spotlight ou o git, atualizada alguns segundos após cada alteração (em um sentido).
- **Os agentes trabalham como você** — Claude, Codex ou qualquer cliente MCP usa os mesmos comandos tipados da
  interface, e suas alterações ficam registradas e podem ser desfeitas como as suas.

| Pesquisa dentro de um PDF anexado | O mapa de links | A máquina do tempo |
| --- | --- | --- |
| ![Pesquisa que encontra palavras dentro de um PDF](docs/screenshots/search.png) | ![Mapa de links](docs/screenshots/graph.png) | ![Uma página na máquina do tempo](docs/screenshots/time-machine.png) |

## E tudo o que você espera de um app de notas

- **Escreva** — blocos aninhados, menu de barra, atalhos de Markdown, menções e lembretes, backlinks, comentários,
  histórico de páginas e 51 modelos para começar.
- **Organize** — bancos de dados com 23 tipos de propriedade, relações, rollups e fórmulas; filtros, ordenações e
  grupos; visualizações de tabela, quadro, lista, galeria, calendário, linha do tempo, feed, gráfico, mapa, formulário
  e painel.
- **Seus dados são seus** — backups e restauração em uma nova pasta; importe Markdown, texto, HTML, Word (.docx), CSV,
  TSV, Excel (.xlsx, .xls), OpenDocument (.ods), EPUB, OPML, PDF e arquivos ZIP de até 5 GB (inclusive exportações de outros apps de notas); exporte para Markdown e CSV, HTML, PDF (com subpáginas, um PDF por página) e um pacote JSON sem perdas.
- **Vários espaços de trabalho** — separe, por exemplo, anotações pessoais e estudos em espaços diferentes no mesmo
  computador e alterne entre eles; cada um guarda os próprios dados.
- **No seu idioma** — English, 한국어, 日本語, 简体中文, 繁體中文, Español, Français, Deutsch, Português (Brasil).

## Por que existe

- **Um espaço pessoal separado do trabalho.** Mantenha suas anotações e projetos fora da conta da empresa — sem trocar
  de conta, sem sair da sessão e sem plano pago para recursos que só você usa.
- **Feito para agentes de IA.** Deixe um agente como o Claude ler, organizar e atualizar seus documentos via MCP, com
  cada alteração registrada e reversível.
- **Funciona sem uma conta na nuvem.** O Inkacre guarda o espaço de trabalho no seu computador. Recursos opcionais,
  como a busca de lugares e as prévias de favoritos, acessam serviços externos quando você os usa. Os clientes de IA
  que você conectar seguem suas próprias políticas de dados.

![Visualização em quadro](docs/screenshots/board.png)

## Início rápido

### Empacotar o aplicativo

Execute `node scripts/package.mjs` nesta pasta para gerar o pacote para o seu computador. Os arquivos em `dist/` incluem o ambiente de execução do Node.js.

| Sistema | Arquivo | Depois |
| --- | --- | --- |
| macOS (Apple silicon) | `Inkacre-…-macos-arm64.dmg` | Abra-o, arraste o **Inkacre** para Aplicativos e abra-o por lá. |
| Windows (x64) | `Inkacre-…-windows-x64.zip` | Descompacte e abra o **Inkacre.exe** na pasta `Inkacre`. |
| Linux (x64) | `Inkacre-…-linux-x64.tar.gz` | Extraia e execute `./inkacre` na pasta `inkacre`. |

Ao abrir o Inkacre, ele começa em segundo plano e abre no navegador em **http://127.0.0.1:4141**; abri-lo de novo enquanto
está rodando só abre o navegador. Para fechá-lo, escolha **Sair do Inkacre** no fim do menu do espaço de trabalho (o
nome do espaço, no canto inferior esquerdo). Seu espaço de trabalho fica na pasta de dados de apps do sistema
([Seus dados](#seus-dados)), então uma versão nova só substitui o app e mantém tudo.

Os downloads ainda não são assinados com um certificado de desenvolvedor da Apple ou da Microsoft, então na primeira vez:

- O **macOS** bloqueia a abertura. Abra **Ajustes do Sistema › Privacidade e Segurança** e escolha **Abrir Mesmo
  Assim** ao lado da mensagem sobre o Inkacre.
- O **Windows** pode mostrar "O Windows protegeu o computador". Escolha **Mais informações › Executar assim mesmo**.

Em um Mac com Intel, rode a partir do código-fonte como abaixo.

### A partir do código-fonte

Você precisa do [Node.js](https://nodejs.org) 22.16 ou mais recente (recomendado: 24).

```sh
npm ci
npm start
```

O app abre em **http://127.0.0.1:4141**. Na primeira execução, uma tela de boas-vindas pergunta o idioma e se você quer
começar com um guia curto e exemplos ou com um espaço de trabalho vazio.

![Tela de boas-vindas](docs/screenshots/welcome.png)

Para usá-lo como comando de qualquer lugar, instale-o globalmente a partir da pasta:

```sh
npm install -g .
inkacre            # o mesmo que npm start
inkacre --help
```

| Opção | O que faz |
| --- | --- |
| `--port <número>` | Porta em que escuta (padrão 4141, ou `LOCAL_WORKSPACE_PORT`) |
| `--data <pasta>` | Onde o espaço de trabalho é guardado (ou `LOCAL_WORKSPACE_DATA`) |
| `--lang <código>` | Idioma pré-selecionado na tela da primeira execução: `en`, `ko`, `ja`, `zh-CN`, `zh-TW`, `es`, `fr`, `de`, `pt-BR` |
| `--no-open` | Não abre o navegador |

Iniciá-lo de novo enquanto ele está em execução apenas abre o app que já está rodando.

### Docker

```sh
docker build -t inkacre .
docker run -d --name inkacre -p 127.0.0.1:4141:4141 -v inkacre-data:/data inkacre
```

Ao atualizar uma instalação existente no Docker, reutilize o volume de dados.

Publique a porta somente em `127.0.0.1` — veja [Segurança](#segurança).

### Atualizar

Se você executa o aplicativo a partir do código-fonte, rode `npm ci` na pasta da nova versão.

Depois reinicie o app. A interface já vem compilada em `web/app/`, então a atualização não precisa de etapa de build.

## Seus dados

Por padrão, o Inkacre usa o diretório de dados de aplicativos do sistema operacional. Para escolher outra pasta, use `--data <pasta>` ou defina `LOCAL_WORKSPACE_DATA`. Continue usando a mesma pasta ao atualizar.

A pasta contém `workspace.sqlite` e `blobs/` (anexos); os outros espaços de trabalho que você criar ficam
dentro dela, em `workspaces/<id>/`. Crie um backup pelo menu **?** no canto inferior esquerdo (**Criar backup**) e
restaure-o em uma nova pasta:

```sh
inkacre restore --from /caminho/do/backup --to /caminho/da/nova-pasta
inkacre --data /caminho/da/nova-pasta
```

A restauração nunca sobrescreve uma pasta existente; hashes, integridade e revisões são verificados antes.

Os backups também acontecem sozinhos — uma vez por dia por padrão, e só quando algo mudou. Em **Configurações ›
Backups** você define a frequência, quantos backups automáticos manter e onde guardá-los: escolha uma pasta em outro
disco, porque um backup no mesmo disco se perde com ele. Cada backup lá pode ser verificado por inteiro ou aberto como
um novo espaço de trabalho ao lado deste.

A mesma pasta guarda `file-text.sqlite`, o texto lido dos anexos para a pesquisa (refeito se você o apagar), e as
configurações deste computador para os backups, a pasta de entrada e o espelho em Markdown (`backup.json`,
`inbox.json`, `mirror.json`).

## Captura rápida

Escolha uma página em **Configurações › Captura rápida** (ou indique uma) e adicione conteúdo de qualquer lugar deste
computador:

```sh
inkacre capture --todo "Comprar leite"                  # na página de captura rápida, como tarefa
inkacre capture --to "Diário" "Uma ideia para hoje"     # em uma página pelo título
inkacre capture --db "Leituras" --prop "Autor=Machado de Assis" "Dom Casmurro"   # uma linha em um banco de dados
pbpaste | inkacre capture --to "Entrada"                # texto da entrada padrão, um bloco por linha
```

Qualquer coisa que envie uma requisição também serve: faça um POST de JSON como `{"text": "…", "as": "todo"}` para
`http://127.0.0.1:4141/api/capture` — no Atalhos da Apple, uma única ação **Obter Conteúdo do URL**. A página de
configurações mostra chamadas prontas para copiar. Cada captura é uma alteração comum: aparece no
**Histórico de alterações** e pode ser desfeita.

**Pasta de entrada.** Na mesma página de configurações, escolha uma pasta: arquivos novos que aparecerem nela —
digitalizações, capturas, downloads — são adicionados à página de captura rápida alguns segundos depois e podem ser
pesquisados como qualquer anexo. Os que já estavam lá ficam de fora, e nada é apagado (os arquivos importados podem
ser movidos para uma pasta `Imported` ao lado).

## Agentes de IA (MCP)

Deixe o app em execução e adicione o servidor MCP ao seu agente:

```json
{
  "mcpServers": {
    "inkacre": { "command": "inkacre", "args": ["mcp"] }
  }
}
```

Está rodando a partir de um clone sem instalação global? Use o caminho completo de `app-local` como comando (veja
[mcp.example.json](mcp.example.json)). No Claude Code:

```sh
claude mcp add inkacre -- inkacre mcp
```

Se o app estiver em outra porta, defina `LOCAL_WORKSPACE_URL` (padrão `http://127.0.0.1:4141`) para o servidor MCP.

| Uso | Ferramentas |
| --- | --- |
| Ler | `workspace_status`, `workspace_get`, `workspace_query`, `workspace_search`, `workspace_tasks`, `workspace_command_schema`, `workspace_history`, `workspace_page_version` |
| Espaços de trabalho | `workspace_list`, `workspace_use` |
| Pré-visualizar e trocar | `workspace_preview_property_conversion`, `workspace_import_preview`, `workspace_export` |
| Alterar e recuperar | `workspace_apply`, `workspace_capture`, `workspace_undo`, `workspace_attachment_put`, `workspace_backup` |
| Notas de execução | `workspace_run_log`, `workspace_run_list`, `workspace_run_read` |

`workspace_apply` recebe um id de comando único, a revisão que o agente leu e uma lista de operações. Um lote é salvo
inteiro ou não é salvo; um comando repetido devolve o primeiro resultado, e uma revisão desatualizada é rejeitada em vez
de sobrescrever um trabalho mais novo. As alterações do agente aparecem em **Histórico de alterações**, como as suas.

## Idiomas

Escolha um idioma na tela de boas-vindas ou depois em **Configurações › Idioma e hora**. As páginas que você já criou
mantêm o texto. Adicionar um idioma é um único arquivo JSON — veja [ui/src/i18n/README.md](ui/src/i18n/README.md).

## Segurança

O Inkacre não tem login. Ele escuta em `127.0.0.1` e só responde a solicitações endereçadas a um host local que vêm
das suas próprias páginas, então outras máquinas e outros sites não conseguem acessá-lo. Não o coloque em um endereço de
rede nem atrás de um proxy público. Os recursos que acessam a internet — blocos de mapa e busca de lugares, prévias de
favoritos, webhooks e e-mails de automações — só rodam quando você os usa ou configura. Os arquivos PDF são impressos
por um navegador baseado em Chromium que já esteja no seu computador (Chrome, Edge ou outro), iniciado em segundo plano
com um perfil vazio próprio e sem acesso à rede; sem um navegador assim, a exportação em PDF abre a janela de impressão.

Os anexos são lidos para a pesquisa neste computador, em uma thread em segundo plano; nada é enviado a lugar nenhum. O
espelho em Markdown só grava na pasta que você escolher — vazia no início — e nunca sobrescreve nem apaga um arquivo
alterado lá.

Os backups, a pasta de entrada e o espelho em Markdown só usam as pastas que você escolher; o espelho e a pasta de
entrada recusam uma pasta de dados do Inkacre.

## Como é feito

- **Um arquivo, um registro.** Os objetos atuais e cada comando que os alterou — com o estado de antes e de depois —
  ficam em um único arquivo SQLite. Desfazer, o histórico de páginas e bancos de dados e a máquina do tempo vêm desse registro, e cada backup o leva inteiro.
- **Um só caminho para mudar qualquer coisa.** A interface, o servidor MCP e a linha de comando enviam os mesmos
  comandos tipados: operações verificadas por um esquema e aplicadas em uma transação sobre a revisão de que partiram.
  Um lote é salvo inteiro ou não é salvo, um comando repetido devolve o primeiro resultado e uma revisão antiga é
  recusada.
- **Node.js simples.** Um processo (o SQLite embutido do Node, sem módulos nativos) serve a interface em 127.0.0.1 e
  faz o trabalho de fundo: ler anexos em uma thread separada, os backups, o espelho e a pasta de entrada.
- **Escrito para este projeto.** O editor é React e ProseMirror; o leitor de texto de PDF (com fontes CJK e
  criptografia padrão), os leitores de Office, HWPX e OpenDocument, o importador de .xls, a importação ZIP64 em fluxo
  e o layout do mapa de links foram escritos aqui em vez de trazer analisadores de terceiros.
- **Testado em um navegador de verdade.** Testes do motor e do servidor (`npm test`, rodados pela CI a cada push) e
  suítes do Playwright em `scripts/ux-trace/` que usam a interface como uma pessoa usaria.

## Desenvolvimento

```sh
npm install
cd ui && npm install && npm run build && cd ..   # recompila a interface em web/app/
npm test                                         # testes do motor
node scripts/package.mjs                         # o download para este sistema, em dist/
```

A interface é feita com React, TypeScript e ProseMirror em `ui/`; o motor, o servidor e o servidor MCP são Node puro em
`src/`. As verificações no navegador ficam em `scripts/ux-trace/` (`local-suite*.mjs`) e rodam com Playwright sobre
dados de teste criados por `node scripts/handoff-ui-fixture.mjs`.

## Não incluído

Equipes, compartilhamento e permissões, coedição em tempo real, publicação na web, cobrança, recursos de IA dentro do
app e integrações com serviços de terceiros.

## Licença

O código do projeto é distribuído sob a [licença MIT](LICENSE). Os componentes de terceiros mantêm suas próprias licenças.

O Inkacre é um projeto independente e não tem afiliação com a Notion Labs, Inc.
