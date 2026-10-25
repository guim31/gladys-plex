# CLAUDE.md — Plex

Contrôlez vos lecteurs Plex : lecture, en cours, activité et bibliothèques.

Intégration externe pour [Gladys Assistant](https://gladysassistant.com), bâtie sur le template officiel `GladysAssistant/integration-template-js` (SDK `@gladysassistant/integration-sdk` ^0.16.0, `gladys_version` `>=5.3.0`). Mainteneur : Guilhem (`guim31`).

Ce fichier rassemble ce qu'une session de code doit savoir et qui ne se lit pas dans le code : choix de conception, faits vérifiés en réel, pièges déjà payés. Le compléter quand un nouveau piège est découvert.

## État au 25/10/2026

Version 1.3.0 : lecteur Musique de Gladys 5.3 (ci-dessous). Indexée dans le store. Jumelle de `guim31/gladys-jellyfin` : mêmes quatre
déclencheurs `playback_*`, mêmes widgets `now_playing`, `player` et `latest_media`. Un changement
de l'une se reporte souvent dans l'autre.

## Faits et choix

- Images par `/photo/:/transcode?url=&width=&height=` (affiche 300×450, fond 800×450) ; liens
  vers `app.plex.tv`.
- Dans le monitor, `init()` ne traite pas les sessions : le premier `refreshSessions()` sert de
  ligne de base.
- Widget `player` : sans lecteur choisi, ou si l'appareil choisi est le serveur, il suit la
  lecture en cours (retour de Guilhem, 1.1.1). Plex Web dans un navigateur n'est pas un appareil
  Gladys.
- Pas d'action de scène propre : Plex n'a pas d'API de message. Lancer un média passe par
  l'action du cœur `music.play-media` (Gladys 5.3, ci-dessous).
- `gladys_version >=5.1.0` depuis la 1.1.0, `>=5.3.0` depuis la 1.3.0 (champ `music`).

- **Polling** : aucun appareil ne demande à être sondé (ni `should_poll` ni
  `poll_frequency` publiés). Toutes les valeurs viennent des minuteurs de `src/loops.js` (sessions toutes
  les `session_poll_frequency` s, bibliothèques toutes les `poll_frequency` s, socket de
  notifications en accélérateur), jamais d'`onPoll` du cœur, qu'un cœur 5.2.0 n'envoie pas à un
  appareil créé sans `should_poll` (Gladys #3198). `onPoll` n'est qu'un repli qui avance le
  rafraîchissement. `test/loops.test.js` le vérifie avec le faux Gladys du SDK
  (`@gladysassistant/integration-sdk/testing`) et des minuteurs simulés.
- Un démarrage raté (Plex injoignable quand l'intégration démarre) est retenté par un minuteur
  propre à `index.js` (30 s puis jusqu'à 5 min, une erreur au premier échec, une info au
  retour) : rien d'autre ne relancerait `initialize()` avant une sauvegarde de la configuration.
- Un nouveau lecteur est marqué `discoveryPending` dans `PlexMonitor` et publié dans la
  Découverte par `publishPendingDiscovery()` (rafraîchissement anticipé ou boucle), retenté au
  cycle suivant si Gladys refuse : un échec côté Gladys ne compte pas comme une panne Plex.
- **Logs** : info = cycle de vie (démarrage, connexion au serveur, nouveau lecteur, une ligne
  par commande). Événements de scène, rafraîchissements et reconnexions du socket en debug.
  Échecs répétés dédupliqués par `FailureLog` (`src/failure-log.js`) : un warn au premier, un
  info au retour. Le socket n'est « revenu » qu'après 60 s ouvert (sinon il clignote dans les
  logs) ; le jeton passe dans l'URL du socket et est masqué dans ses messages. Un test vérifie
  qu'un cycle normal n'écrit rien en info : le garder vert. Les messages d'erreur passent par
  `redactSecret` (`src/redact.js`) avant d'être journalisés.
- Les tests de `PlexMonitor` gardent leur faux Gladys maison (`test/helpers/fakeGladys.js`,
  simple et suffisant) ; les nouveaux tests passent par celui du SDK, qui valide les charges
  comme l'API hôte.
- Pour un banc d'essai sans toucher à un vrai serveur : un Plex non réclamé dont
  `ALLOWED_NETWORKS` couvre le client ne demande aucun jeton, et un simple
  `/:/timeline?state=…` avec des en-têtes `X-Plex-Client-Identifier` crée une vraie session dans
  `/status/sessions`. Les commandes à distance, elles, ne se simulent pas.

## Lecteur Musique de Gladys 5.3 (1.3.0)

- Contrat : `capabilities/music.md` du cœur. `publishNowPlaying` (SDK) est le **seul canal** de
  `playback_state`, `title`, `artist`, `album`, `artwork`, `duration`, `position`, `volume`,
  `mute` ; `processSessions` ne publie plus `playback-state` par `publishStates`. Ids gardés :
  `playback-state` (par `featureExternalIds`), `volume`, `mute` (television/volume_mute → music/mute
  par « Mettre à jour » ; avant, `onSetValue` reçoit encore la catégorie television : bascule
  gardée). Arrêt = 2 (IDLE), chargement = 3.
- **Ni aléatoire ni répétition** : le serveur ne les publie pas (seule la timeline du lecteur,
  `/player/timeline/poll`, les donne). Volume et sourdine non plus : publiés après une commande
  acceptée.
- **Position** : `viewOffset` de `/status/sessions` n'est **pas extrapolé** par le serveur (resté
  à 5000 une minute durant, PMS 1.43) : un échantillon répété pendant la lecture est retiré de
  l'instantané (`positionSamples`), sinon le SDK le republierait en arrière.
- **File d'attente** : absente de `/status/sessions`. Les notifications `playing` portent
  `playQueueID` / `playQueueItemID` par `clientIdentifier` (= `machineIdentifier`) :
  `notePlayQueues()`. Le serveur suit l'élément que le lecteur rapporte
  (`playQueueSelectedItemOffset`) et pagine `/playQueues/<id>` avec `X-Plex-Container-Start/Size`.
- **Commandes companion** (dépendent de l'appli) : `playMedia` (playQueue créée par
  `POST /playQueues`, paramètres de python-plexapi, jeton `/security/token?type=delegation`, 400
  sur un serveur non réclamé → jeton configuré), `refreshPlayQueue` après `PUT /playQueues/<id>`
  (suite / fin de file), `skipTo` (clé + `playQueueItemID`), `seekTo` (ms). Un lecteur répond en
  **XML** (`<Response code="200"/>`) : `playerCommand` ne lit pas le corps (bug corrigé en 1.3.0,
  la route directe signalait un échec après avoir exécuté la commande).
- **Pochettes** : transcodeur avec `format=jpeg` (sans lui, une source PNG revient en PNG lourd,
  étiqueté image/jpeg). `onMusicGetArtwork` maison (jeton en en-tête, jamais dans l'URL ni la clé).
- **Banc** (25/10, vérifié) : `plexinc/pms-docker` non réclamé, `ALLOWED_NETWORKS` = sous-réseau du
  réseau Docker, bibliothèque générée par ffmpeg (MP3 tagués, pochettes intégrées), faux lecteur
  companion Node (port 32500, timelines `/:/timeline` avec `containerKey`/`playQueueItemID`).
  **Appeler le serveur par son IP** : par son nom DNS, un PMS non réclamé répond 401 même depuis un
  réseau autorisé (protection contre le DNS rebinding). Un vrai client Plex (Plexamp, Plex Web)
  demande un compte plex.tv : non testé.

## Travailler sur ce dépôt

- Mêmes étapes que la CI, dans le même ordre : `npm ci`, `npm run format:check`, `npm run lint`,
  `npm test` (`node --test`). Prettier contrôle **aussi le Markdown** : lancer `npm run format`
  après avoir modifié ce fichier ou le README, sinon la CI tombe.
- La CI tourne en Node 24. Une session cloud a Node 22 par défaut, ce qui suffit (`engines` :
  `>=20`).
- Une session de code n'a **ni instance Gladys ni appareil réel**. La suite de tests, le lint et
  le validateur du store sont les seules vérifications possibles : le test réel passe par
  Guilhem ou par les testeurs du forum. Le dire, plutôt que de conclure que « ça marche ».
- **Publier est un geste de Guilhem** : Actions → Release (patch, minor ou major) construit
  l'image `ghcr.io/guim31/<dépôt>`, monte la version du manifeste et pose le tag. Un correctif
  poussé sur `main` sans Release n'atteint aucune installation : le signaler.
- Le workflow Release reformate le manifeste avec Prettier, publie l'image et crée la **release
  GitHub** (notes générées depuis les PR, ou `.github/release-notes/vX.Y.Z.md` s'il existe) : c'est
  elle que Gladys ouvre par « Voir le changelog de cette version ». Les trois workflows (`ci`,
  `build`, `release`) sont communs aux intégrations de guim31 : ne pas les modifier dans un seul dépôt.
- Le dépôt est **public** : aucun secret, aucune adresse ni détail d'infrastructure privée, ni
  ici, ni dans les tests, ni dans les captures.

## Pièges du cœur Gladys (communs aux intégrations de guim31)

Vérifiés dans le code du cœur ou payés sur une intégration publiée. Ils valent pour toutes.

**Appareils et fonctionnalités**

- **Polling** : le planificateur n'interroge un appareil que si `should_poll: true` **et**
  `poll_frequency` vaut une valeur de la liste fixe (1000, 2000, 10000, 15000, 30000, 60000 ms).
  Publier seulement `poll_frequency` donne un appareil accepté mais jamais interrogé. Pour une
  cadence hors liste, publier `should_poll: false` et pousser les états depuis le conteneur, en
  gardant un `onPoll` de repli.
- **`min` et `max` sont NOT NULL** dans `t_device_feature`, y compris pour `text/text` : sans eux,
  « Ajouter à Gladys » échoue en HTTP 422. Mettre 0/0, comme Zigbee2MQTT.
- `level-sensor/decimal` n'existe pas côté serveur. `light-sensor/binary` n'a pas de libellé dans
  le front (pastille vide) : préférer `input/binary`. Un `text/text` reçoit `{ text }`, jamais
  vide, sinon l'état est ignoré.
- Les **noms de fonctionnalités sont figés à la création**. Et quand une fonctionnalité est seule
  de son type sur l'appareil, le tableau de bord affiche le libellé générique du type à la place
  du nom publié (`getDeviceFeatureName` du front).
- Depuis Gladys 4.84, un changement de structure fait proposer « Mettre à jour » dans l'onglet
  Découverte (`structure_changed`) : plus besoin de supprimer et recréer l'appareil. Un
  changement des seules `supported_options` ne le déclenche pas.
- **Jauge** : l'aiguille se place par `(value - min) / (max - min)` des bornes de la
  fonctionnalité. `gauge_min`/`gauge_max` ne pilotent que les couleurs, et le cœur n'applique
  jamais `min`/`max` en écriture : ce sont des bornes d'affichage. Une valeur signée exige des
  bornes symétriques.
- Le cœur plafonne à **300 états par minute** et réévalue les scènes à chaque état : ne publier
  que les changements.
- Une intégration `device` ne reçoit pas la langue de l'utilisateur, une action de scène non
  plus (un widget, si) : prévoir un champ de config `language`. Le superviseur injecte `TZ`, le
  fuseau de Gladys, dans le conteneur. La sandbox est limitée à 256 Mo.

**Formulaires de configuration et actions**

- Les champs `number` sont rendus en `<input type="number" min max>` **sans `step`** (le
  manifeste n'en accepte pas) : le navigateur n'accepte alors que `min + k`. Min et défaut
  **entiers** seulement ; une valeur décimale passe par un `select` ou par un `string` parsé
  (virgule acceptée).
- Un champ `secret` dans les `fields` d'une **action** est impossible à remplir (la saisie
  s'efface à chaque frappe), et une action n'applique **aucun `default`**, ni à l'affichage ni
  côté serveur, tout en exigeant les champs `required` (422).

**Widgets, déclencheurs, actions de scène (SDK ≥ 0.14, Gladys ≥ 5.1)**

- Budget du cœur : **8 composants par widget, dont 2 textes au plus**. Le validateur du SDK le
  signale ; `validateWidgetContent` est exporté pour les tests.
- Le cœur **jette un bouton dont la clé d'action est déjà prise** : clés numérotées, ce que fait
  le bouton dans ses paramètres.
- Le vocabulaire des widgets n'a ni liste ni curseur. Seul un bouton `device_feature` numérique
  a un état actif natif.
- Dans une grille `card-list`, la `date` s'affiche **à la place** du sous-titre.
- `onWidgetAction` fait recharger le widget dès la résolution, alors que `requestWidgetRefresh`
  est plafonné à un appel toutes les 10 s.
- Les filtres de scène ne font qu'égalité et appartenance : un seuil (Kp > 6) reste le travail
  d'un capteur.
- **Les clés de widgets, de déclencheurs et d'actions sont figées une fois publiées.**
- Passer `gladys_version` à `>=5.1.0` coupe les mises à jour des cœurs plus anciens, qui
  refusent les champs inconnus du manifeste.

## Publication et store

- Avant de demander une Release ou le topic, lancer le validateur officiel depuis la racine :
  `npx -y github:GladysAssistant/integration-store`. Il vérifie le schéma, la `description`
  (**100 caractères au plus par langue**), la documentation (300 caractères au moins), l'image
  Docker et la cover (**150 Ko au plus**).
- Le topic `gladys-assistant-integration` fait indexer le dépôt ; Guilhem le pose (le jeton de
  l'agent n'en a pas le droit). L'indexeur passe à H:13 chaque heure, souvent avec une demi-heure
  de retard, et rejette **en silence** : la raison n'apparaît que dans `rejected.json`, à côté de
  l'index `https://integration-store-storage.gladysassistant.com/index.json`.
- Sans topic, on installe par la carte « Installer depuis GitHub » (URL du dépôt, Gladys ≥ 4.84) :
  le cœur lit le manifeste sur `main` et propose les mises à jour à chaque rafraîchissement du
  catalogue.
- La règle `data/` du `.gitignore` du template (pour le volume `/data`) exclut aussi `src/data/` :
  l'ancrer en `/data/`, dans `.prettierignore` aussi. Avant de pousser un dépôt neuf, tester sur
  un `git clone` propre, pas sur la copie de travail.
