# Inkacre

**Des pages, des blocs et des bases de données qui restent sur votre ordinateur — et dans lesquels votre agent IA peut
travailler.**

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · Français · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md)

![Page de démarrage](docs/screenshots/page.png)

Inkacre est un espace de travail local, pour une seule personne, dans le style familier des blocs et des bases de données. Tout est conservé dans un
seul fichier SQLite sur votre machine : pas de compte, pas de cloud, pas de télémétrie. L'interface web, un serveur MCP
intégré pour les agents IA et le moteur de commandes partagent ce fichier ; un agent modifie donc les mêmes pages que
vous, et chaque modification, la vôtre comme celle de l'agent, est enregistrée et peut être annulée.

## Ce que la plupart des applis de notes ne font pas

- **Remonter le temps** — ouvrez tout l'espace de travail tel qu'il était à n'importe quel moment passé, en lecture
  seule dans son propre onglet, et ramenez une page au présent ou sortez-en une copie.
- **Chercher dans les fichiers** — la recherche trouve aussi les mots des fichiers PDF, Word, Excel, PowerPoint, HWPX,
  OpenDocument et texte joints, et affiche le fichier et la ligne.
- **Une carte des liens** — chaque page comme un point, avec les liens, mentions et relations entre elles ; ouvrez-la
  autour d'une page pour voir ce qu'elle touche.
- **Capturer de partout** — ajoutez une ligne, une tâche ou une ligne de base de données depuis Raccourcis, Raycast,
  un script ou le terminal sans ouvrir l'app ; les fichiers déposés dans un dossier d'arrivée rejoignent la même page.
- **Sauvegardes automatiques** — toutes les heures, chaque jour ou chaque semaine quand quelque chose a changé, sur un
  autre disque si vous voulez ; chaque sauvegarde peut être vérifiée ou ouverte comme un nouvel espace.
- **Un miroir Markdown** — tout l'espace de travail sous forme de fichiers Markdown et CSV dans un dossier pour
  Obsidian, un éditeur, Spotlight ou git, mis à jour quelques secondes après chaque modification (sens unique).
- **Les agents travaillent comme vous** — Claude, Codex ou tout client MCP utilise les mêmes commandes typées que
  l'interface, et leurs modifications sont enregistrées et annulables comme les vôtres.

| Recherche dans un PDF joint | La carte des liens | La machine à remonter le temps |
| --- | --- | --- |
| ![Recherche trouvant des mots dans un PDF](docs/screenshots/search.png) | ![Carte des liens](docs/screenshots/graph.png) | ![Une page dans la machine à remonter le temps](docs/screenshots/time-machine.png) |

## Et tout ce que vous attendez d'une appli de notes

- **Écrire** — blocs imbriqués, menu barre oblique, raccourcis Markdown, mentions et rappels, rétroliens, commentaires,
  historique des pages et 51 modèles pour démarrer.
- **Organiser** — bases de données avec 23 types de propriétés, relations, agrégations et formules ; filtres, tris et
  groupes ; vues tableau, Kanban, liste, galerie, calendrier, chronologie, fil, graphique, carte, formulaire et tableau
  de bord.
- **Vos données restent à vous** — sauvegardes et restauration dans un nouveau dossier ; import de Markdown, texte,
  HTML, Word (.docx), CSV, TSV, Excel (.xlsx, .xls), OpenDocument (.ods), EPUB, OPML, PDF et archives ZIP jusqu’à 5 Go
  (exports d'autres applis de notes compris) ; export en Markdown et CSV, HTML, PDF (avec sous-pages, un PDF par page) et en paquet JSON
  sans perte.
- **Plusieurs espaces de travail** — séparez par exemple vos notes personnelles et vos études dans des espaces
  distincts sur le même ordinateur et passez de l'un à l'autre ; chacun a ses propres données.
- **Dans votre langue** — English, 한국어, 日本語, 简体中文, 繁體中文, Español, Français, Deutsch, Português (Brasil).

## Pourquoi ce projet

- **Un espace personnel séparé du travail.** Gardez vos notes et vos projets hors du compte de l'entreprise : pas de
  changement de compte, pas de déconnexion, et pas d'abonnement payant pour des fonctions que vous êtes seul à utiliser.
- **Conçu pour les agents IA.** Laissez un agent comme Claude lire, trier et mettre à jour vos documents via MCP, chaque
  modification étant enregistrée et annulable.
- **Fonctionne sans compte cloud.** Inkacre enregistre l’espace de travail sur votre ordinateur. Les fonctions
  facultatives comme la recherche de lieux et l’aperçu des favoris se connectent à des services externes lorsque vous
  les utilisez. Les clients IA que vous connectez appliquent leurs propres politiques de traitement des données.

![Vue Kanban](docs/screenshots/board.png)

## Démarrage rapide

### Créer le paquet de l’application

Lancez `node scripts/package.mjs` dans ce dossier pour créer le paquet adapté à votre ordinateur. Les fichiers dans `dist/` contiennent le moteur Node.js.

| Système | Fichier | Ensuite |
| --- | --- | --- |
| macOS (Apple silicon) | `Inkacre-…-macos-arm64.dmg` | Ouvrez-le, glissez **Inkacre** dans Applications et ouvrez-le depuis là. |
| Windows (x64) | `Inkacre-…-windows-x64.zip` | Décompressez et ouvrez **Inkacre.exe** dans le dossier `Inkacre`. |
| Linux (x64) | `Inkacre-…-linux-x64.tar.gz` | Extrayez et lancez `./inkacre` dans le dossier `inkacre`. |

À l’ouverture, Inkacre démarre en arrière-plan et s’ouvre dans votre navigateur à **http://127.0.0.1:4141** ; l’ouvrir à
nouveau pendant qu’il tourne ouvre simplement le navigateur. Pour l’arrêter, choisissez **Quitter Inkacre** en bas du
menu de l’espace de travail (son nom, en bas à gauche). Votre espace de travail est conservé dans le dossier de données
d’applications du système ([Vos données](#vos-données)) : une nouvelle version remplace seulement l’app et garde tout.

Les téléchargements ne sont pas encore signés avec un certificat de développeur Apple ou Microsoft, donc la première fois :

- **macOS** le bloque. Ouvrez **Réglages Système › Confidentialité et sécurité** et choisissez **Ouvrir quand même** à
  côté du message concernant Inkacre.
- **Windows** peut afficher « Windows a protégé votre ordinateur ». Choisissez **Informations complémentaires › Exécuter
  quand même**.

Sur un Mac Intel, lancez-le depuis les sources comme ci-dessous.

### Depuis les sources

Il vous faut [Node.js](https://nodejs.org) 22.16 ou plus récent (24 recommandé).

```sh
npm ci
npm start
```

L'application s'ouvre sur **http://127.0.0.1:4141**. Au premier lancement, un écran d'accueil vous demande votre langue
et si vous voulez commencer avec un court guide et des exemples ou avec un espace de travail vide.

![Écran d'accueil](docs/screenshots/welcome.png)

Pour l'utiliser comme commande depuis n'importe où, installez-la globalement depuis le dossier :

```sh
npm install -g .
inkacre            # comme npm start
inkacre --help
```

| Option | Effet |
| --- | --- |
| `--port <numéro>` | Port d'écoute (4141 par défaut, ou `LOCAL_WORKSPACE_PORT`) |
| `--data <dossier>` | Emplacement de l'espace de travail (ou `LOCAL_WORKSPACE_DATA`) |
| `--lang <code>` | Langue présélectionnée sur l'écran de premier lancement : `en`, `ko`, `ja`, `zh-CN`, `zh-TW`, `es`, `fr`, `de`, `pt-BR` |
| `--no-open` | N'ouvre pas le navigateur |

La relancer pendant qu'elle tourne ouvre simplement l'application déjà en cours d'exécution.

### Docker

```sh
docker build -t inkacre .
docker run -d --name inkacre -p 127.0.0.1:4141:4141 -v inkacre-data:/data inkacre
```

Lors de la mise à jour d’une installation Docker existante, réutilisez son volume de données.

Ne publiez le port que sur `127.0.0.1` — voir [Sécurité](#sécurité).

### Mise à jour

Si vous lancez l’application depuis le code source, exécutez `npm ci` dans le dossier de la nouvelle version.

Redémarrez ensuite l'application. L'interface est livrée précompilée dans `web/app/`, la mise à jour ne demande donc
aucune étape de compilation.

## Vos données

Par défaut, Inkacre utilise le dossier des données d’application du système d’exploitation. Pour choisir un autre dossier, utilisez `--data <dossier>` ou définissez `LOCAL_WORKSPACE_DATA`. Conservez le même dossier lors des mises à jour.

Le dossier contient `workspace.sqlite` et `blobs/` (pièces jointes) ; les autres espaces
de travail que vous créez sont rangés à l'intérieur, dans `workspaces/<id>/`. Créez une sauvegarde depuis le menu
**?** en bas à gauche (**Créer une sauvegarde**) et restaurez-la dans un nouveau dossier :

```sh
inkacre restore --from /chemin/vers/la/sauvegarde --to /chemin/vers/nouveau-dossier
inkacre --data /chemin/vers/nouveau-dossier
```

Une restauration n'écrase jamais un dossier existant ; les empreintes, l'intégrité et les révisions sont vérifiées
d'abord.

Les sauvegardes se font aussi toutes seules : une fois par jour par défaut, seulement si quelque chose a changé.
**Paramètres › Sauvegardes** règle la fréquence, le nombre de sauvegardes automatiques à garder et leur emplacement :
choisissez un dossier sur un autre disque, car une sauvegarde sur le même disque disparaît avec lui. Chaque sauvegarde
peut y être vérifiée entièrement ou ouverte comme un nouvel espace de travail à côté de celui-ci.

Le même dossier contient `file-text.sqlite`, le texte lu dans les pièces jointes pour la recherche (reconstruit si
vous le supprimez), et les réglages de cet ordinateur pour les sauvegardes, le dossier d'arrivée et le miroir Markdown
(`backup.json`, `inbox.json`, `mirror.json`).

## Capture rapide

Choisissez une page dans **Paramètres › Capture rapide** (ou indiquez-en une), puis ajoutez-y du contenu depuis n'importe
où sur cet ordinateur :

```sh
inkacre capture --todo "Acheter du lait"                # dans la page de capture rapide, comme tâche
inkacre capture --to "Journal" "Une idée du jour"       # dans une page désignée par son titre
inkacre capture --db "Lectures" --prop "Auteur=Victor Hugo" "Les Misérables"   # une ligne dans une base de données
pbpaste | inkacre capture --to "Boîte de réception"     # texte de l'entrée standard, un bloc par ligne
```

Tout ce qui peut envoyer une requête convient aussi : envoyez en POST un JSON comme `{"text": "…", "as": "todo"}` à
`http://127.0.0.1:4141/api/capture` ; dans Raccourcis d'Apple, une seule action **Obtenir le contenu de l'URL**. La page
des paramètres propose des appels prêts à copier. Chaque capture est une modification ordinaire : elle apparaît dans
l'**Historique des modifications** et peut être annulée.

**Dossier d'arrivée.** Sur la même page de paramètres, choisissez un dossier : les nouveaux fichiers qui y
apparaissent (numérisations, captures, téléchargements) sont ajoutés à la page de capture rapide quelques secondes
plus tard et peuvent être recherchés comme toute pièce jointe. Les fichiers déjà présents sont ignorés et rien n'est
supprimé (les fichiers importés peuvent être déplacés dans un dossier `Imported` à côté).

## Agents IA (MCP)

Laissez l'application tourner et ajoutez le serveur MCP à votre agent :

```json
{
  "mcpServers": {
    "inkacre": { "command": "inkacre", "args": ["mcp"] }
  }
}
```

Vous l'exécutez depuis un clone sans installation globale ? Utilisez le chemin complet de `app-local` comme commande
(voir [mcp.example.json](mcp.example.json)). Dans Claude Code :

```sh
claude mcp add inkacre -- inkacre mcp
```

Si l'application tourne sur un autre port, définissez `LOCAL_WORKSPACE_URL` (par défaut `http://127.0.0.1:4141`) pour
le serveur MCP.

| Usage | Outils |
| --- | --- |
| Lire | `workspace_status`, `workspace_get`, `workspace_query`, `workspace_search`, `workspace_tasks`, `workspace_command_schema`, `workspace_history`, `workspace_page_version` |
| Espaces de travail | `workspace_list`, `workspace_use` |
| Prévisualiser et échanger | `workspace_preview_property_conversion`, `workspace_import_preview`, `workspace_export` |
| Modifier et récupérer | `workspace_apply`, `workspace_capture`, `workspace_undo`, `workspace_attachment_put`, `workspace_backup` |
| Notes d'exécution | `workspace_run_log`, `workspace_run_list`, `workspace_run_read` |

`workspace_apply` prend un identifiant de commande unique, la révision lue par l'agent et une liste d'opérations. Un
lot est enregistré entièrement ou pas du tout, une commande renvoyée retourne son premier résultat, et une révision
périmée est refusée au lieu d'écraser un travail plus récent. Les modifications de l'agent apparaissent dans
**Historique des modifications** comme les vôtres.

## Langues

Choisissez une langue sur l'écran d'accueil ou plus tard dans **Paramètres › Langue et heure**. Les pages déjà créées
gardent leur texte. Ajouter une langue tient en un seul fichier JSON — voir
[ui/src/i18n/README.md](ui/src/i18n/README.md).

## Sécurité

Inkacre n'a pas de connexion. Il écoute sur `127.0.0.1` et ne répond qu'aux requêtes adressées à un hôte local et
provenant de ses propres pages : ni les autres machines ni les autres sites web ne peuvent l'atteindre. Ne le placez pas
sur une adresse réseau ni derrière un proxy public. Les fonctions qui vont en ligne — tuiles de carte et recherche de
lieux, aperçus de signets, webhooks et e-mails des automatisations — ne s'exécutent que lorsque vous les utilisez ou les
configurez. Les fichiers PDF sont imprimés par un navigateur basé sur Chromium déjà présent sur votre ordinateur
(Chrome, Edge ou autre), lancé en arrière-plan avec un profil vide qui lui est propre et sans accès au réseau ; à
défaut, l’export PDF ouvre la fenêtre d’impression.

Les pièces jointes sont lues pour la recherche sur cet ordinateur, dans un thread en arrière-plan ; rien n'est envoyé
ailleurs. Le miroir Markdown n'écrit que dans le dossier que vous choisissez — vide au départ — et n'écrase ni ne
supprime jamais un fichier modifié à cet endroit.

Les sauvegardes, le dossier d'arrivée et le miroir Markdown n'utilisent que les dossiers que vous choisissez ; le
miroir et le dossier d'arrivée refusent un dossier de données Inkacre.

## Comment c'est construit

- **Un fichier, un journal.** Les objets actuels et chaque commande qui les a modifiés — avec l'état avant et après —
  tiennent dans un seul fichier SQLite. L'annulation, l'historique des pages et des bases de données et la machine à remonter le temps viennent de ce journal, et chaque sauvegarde le contient en entier.
- **Une seule façon de modifier.** L'interface, le serveur MCP et la ligne de commande envoient les mêmes commandes
  typées : des opérations vérifiées par un schéma et appliquées en une transaction sur la révision dont elles partent.
  Un lot est enregistré entièrement ou pas du tout, une commande répétée renvoie son premier résultat et une révision
  périmée est refusée.
- **Du Node.js tout simple.** Un processus (le SQLite intégré de Node, sans module natif) sert l'interface sur
  127.0.0.1 et fait le travail de fond : lire les pièces jointes dans un thread à part, les sauvegardes, le miroir et
  le dossier d'arrivée.
- **Écrit pour ce projet.** L'éditeur repose sur React et ProseMirror ; le lecteur de texte PDF (polices CJK et
  chiffrement standard compris), les lecteurs Office, HWPX et OpenDocument, l'import .xls, l'import ZIP64 en flux et
  la disposition de la carte des liens sont écrits ici plutôt qu'empruntés à des analyseurs tiers.
- **Testé dans un vrai navigateur.** Des tests du moteur et du serveur (`npm test`, lancés par la CI à chaque push) et
  des suites Playwright dans `scripts/ux-trace/` qui manipulent l'interface comme une personne.

## Développement

```sh
npm install
cd ui && npm install && npm run build && cd ..   # recompile l'interface dans web/app/
npm test                                         # tests du moteur
node scripts/package.mjs                         # le téléchargement pour ce système, dans dist/
```

L'interface est écrite en React, TypeScript et ProseMirror dans `ui/` ; le moteur, le serveur et le serveur MCP sont en
Node pur dans `src/`. Les vérifications dans le navigateur se trouvent dans `scripts/ux-trace/` (`local-suite*.mjs`) et
s'exécutent avec Playwright sur des données de test créées par `node scripts/handoff-ui-fixture.mjs`.

## Non inclus

Équipes, partage et permissions, coédition en temps réel, publication sur le web, facturation, fonctions d'IA dans
l'application et intégrations tierces.

## Licence

Le code du projet est distribué sous [licence MIT](LICENSE). Les composants tiers conservent leurs propres licences.

Inkacre est un projet indépendant, sans lien avec Notion Labs, Inc.
