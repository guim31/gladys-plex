# Plex pour Gladys Assistant

Connectez votre [serveur Plex](https://www.plex.tv) à Gladys Assistant :
contrôlez vos lecteurs Plex depuis Gladys et utilisez ce qui est en cours de
lecture dans vos automatisations (baisser les lumières quand un film démarre,
les rallumer au générique de fin...).

## Ce que vous obtenez

**Un appareil « serveur »** avec des capteurs de supervision :

- **Flux actifs** — le nombre de lectures en cours ;
- **Sessions en transcodage** — combien d'entre elles sont transcodées ;
- **Bande passante de streaming** — la bande passante totale, en kbps ;
- **En cours de lecture** — un résumé « qui regarde quoi » sur une ligne ;
- **Un compteur d'éléments par bibliothèque** (désactivable) : films, séries
  (plus un compteur d'épisodes), artistes (plus un compteur de pistes)...

**Un appareil par lecteur Plex** (application TV, mobile, Chromecast... tout
lecteur que votre serveur sait contrôler) :

- Commandes de lecture : **Lecture, Pause, Stop, Précédent, Suivant, Retour,
  Avance** ;
- **Volume** (0–100) et **Sourdine** ;
- **État de lecture** — en lecture (1), en pause (0), arrêté (2) ou en
  chargement (3), et une commande : l'écrire met en pause, lance ou arrête ;
- **Titre**, **Artiste**, **Album**, **Pochette**, **Durée** et **Position**
  de ce qui est joué (la position se règle : un déplacement dans le morceau) —
  le widget **Musique** de Gladys 5.3 (voir plus bas) ;
- **En cours de lecture** — le titre formaté du média
  (`Série S01E02 - Épisode`, `Artiste - Titre`, `Film (année)`) ;
- **Temps restant**, en minutes ;
- **Dans l'intro** et **Dans le générique** — des capteurs binaires actifs
  quand la lecture se trouve dans l'intro ou le générique de fin de
  l'épisode/du film (grâce aux marqueurs détectés par votre serveur Plex).
  Des déclencheurs parfaits pour vos scènes.

Les états de lecture se rafraîchissent toutes les quelques secondes
(configurable), et l'intégration écoute aussi le flux de notifications temps
réel du serveur : une lecture, une pause ou un arrêt est reflété dans Gladys
en moins d'une seconde.

## Lecteur Musique de Gladys 5.3

La version 1.3 de l'intégration demande Gladys 5.3 ou plus récent (les
versions précédentes de Gladys restent sur la 1.2). Depuis Gladys 5.3, la boîte
**Musique** du tableau de bord est un vrai lecteur. Choisissez un lecteur Plex : elle montre ce qu'il joue (pochette,
titre, artiste, album — pour un épisode : l'épisode, la série et la saison ;
pour un film : son titre), une barre de progression que l'on fait glisser pour
se déplacer, lecture / pause, précédent / suivant, le volume et la sourdine.

- **Panneau Musique** : la loupe de la boîte parcourt vos bibliothèques
  musicales (artistes, albums, playlists audio) et y cherche ; un appui lance
  un morceau, un album, un artiste ou une playlist sur le lecteur, tout de
  suite, à la suite ou en fin de file. L'icône liste montre la **file
  d'attente** du lecteur, le morceau en cours surligné : un appui y saute. Le
  même sélecteur sert à l'action de scène de Gladys **Lancer une musique sur une enceinte**
  (_à 7 h, lancer la playlist « Matin » dans la cuisine_).
- **Ce que le lecteur doit accepter** : les commandes passent par le contrôle
  à distance de Plex (voir [Quels lecteurs sont pilotables ?](#quels-lecteurs-sont-pilotables-)).
  La lecture depuis le panneau, la file et le saut utilisent les commandes que
  les applications Plex emploient pour « caster » (`playMedia`,
  `refreshPlayQueue`, `skipTo`) : un lecteur qui les refuse affiche une erreur
  dans le panneau.
- **La file d'attente** est celle que le serveur tient pour le lecteur. Son
  identifiant arrive avec les notifications temps réel : après un redémarrage
  de l'intégration, elle apparaît quelques secondes après le début de la
  lecture.
- **Ni aléatoire ni répétition** : le serveur ne les publie pas (seul le
  lecteur les connaît), ces deux boutons n'apparaissent donc pas.
- Le volume et la sourdine ne sont pas publiés par le serveur non plus : la
  boîte montre la dernière valeur réglée depuis Gladys.
- Les pochettes sont redimensionnées par votre serveur Plex, en JPEG, et
  servies par l'intégration : le navigateur ne contacte jamais Plex.

**Lecteurs ajoutés avant la version 1.3** : ouvrez l'onglet **Découverte** et
cliquez sur **Mettre à jour** sur le lecteur pour recevoir les nouvelles
fonctionnalités. Les fonctionnalités existantes gardent leurs identifiants,
scènes et tableaux de bord continuent de marcher : **Sourdine** devient une
sourdine musique (un interrupteur au lieu d'un bouton poussoir) et l'**État de
lecture** devient pilotable. Deux comportements changent : un lecteur arrêté
publie désormais **2** (il publiait 0), une scène « état de lecture = 0 » ne se
déclenche donc plus sur un arrêt — utilisez 2, ou le déclencheur **Lecture
arrêtée** ; et le texte **En cours de lecture** reste, à côté du nouveau
**Titre**.

## Scènes

Quatre déclencheurs de scène (Gladys 5.1 et suivants) : **Lecture démarrée**,
**Lecture en pause**, **Lecture reprise** et **Lecture arrêtée**. Chacun peut
être limité à un lecteur et à des types de média (film, épisode, musique, TV
en direct…) : _un film démarre sur la TV du salon_ → tamiser le salon ;
_la lecture est en pause_ → rallumer. Les variables `title`, `name`,
`series_name`, `media_type`, `user` et `player_name` sont utilisables dans les
actions qui suivent (par exemple dans un message : « {{triggerEvent.data.user}}
regarde {{triggerEvent.data.title}} »).

## Widgets du tableau de bord

- **En cours de lecture** : qui regarde quoi, où, avec les affiches.
- **Lecteur** : la lecture en cours en télécommande — la jaquette (ou
  l'image de fond du film), le titre, l'état, le temps restant et les boutons
  lecture/pause, stop et suivant. Laissez le réglage « Lecteur » vide pour
  suivre automatiquement ce qui est en cours de lecture, ou choisissez un
  lecteur pour le suivre lui seul.
- **Derniers ajouts** : les affiches des films, saisons ou albums ajoutés
  récemment, avec un lien pour les ouvrir dans Plex.

Les images sont redimensionnées par votre serveur Plex et servies par
l'intégration : le navigateur ne contacte jamais Plex directement.

## Configuration

1. Trouvez l'**URL de votre serveur Plex**, généralement
   `http://<ip-du-serveur>:32400`. Préférez l'adresse locale quand Gladys et
   Plex sont sur le même réseau.
2. Trouvez votre **jeton Plex (X-Plex-Token)** : ouvrez l'application web
   Plex, lancez n'importe quel média, cliquez sur **Obtenir des
   informations → Afficher XML**, et copiez la valeur `X-Plex-Token` à la fin
   de l'URL. L'article officiel en lien dans l'écran de configuration détaille
   la démarche.
3. Renseignez les deux champs dans l'onglet **Configuration** de
   l'intégration et enregistrez.
4. Utilisez le bouton **Tester la connexion Plex** : il affiche le nom du
   serveur, sa version et le nombre de bibliothèques et de lecteurs trouvés.
5. Ouvrez l'onglet **Découverte** : l'appareil serveur et vos lecteurs n'y
   attendent que vous.

Si votre serveur ne répond qu'en `https` avec un certificat auto-signé,
utilisez de préférence l'adresse locale en `http`, ou activez **Accepter un
certificat auto-signé**.

### Options

- **Rafraîchissement de la lecture** — fréquence d'interrogation des sessions
  actives (10 s par défaut). Les notifications temps réel accélèrent le cas
  courant ; ce réglage est le rythme de secours.
- **Rafraîchissement des bibliothèques** — fréquence de mise à jour des
  compteurs de bibliothèques (5 min par défaut).
- **Capteurs de bibliothèques** — désactivez-le si vous ne voulez pas d'un
  compteur par bibliothèque sur l'appareil serveur.
- **Langue du panneau Musique** — la langue des dossiers de la boîte Musique
  et des messages renvoyés par ses commandes (français par défaut).

## Découverte des lecteurs

Les lecteurs apparaissent automatiquement :

- les lecteurs enregistrés auprès du serveur (la liste `/clients`) sont
  trouvés au démarrage et via le bouton **Rechercher les lecteurs Plex** ;
- tout lecteur qui **démarre une lecture** est découvert à la volée et publié
  dans l'onglet Découverte, même s'il n'est pas contrôlable à distance.

### Quels lecteurs sont pilotables ?

Voir un lecteur et le **piloter** sont deux choses différentes : les capteurs
(titre en cours, état, temps restant) fonctionnent pour **tous** les lecteurs,
mais les boutons n'agissent que sur ceux qui **acceptent le contrôle à
distance**.

- ✅ Les applications **TV / box / console** (Android TV, Apple TV, Roku…)
  s'annoncent comme lecteurs par défaut : tout fonctionne.
- ⚠️ Les applications **mobiles, Plexamp et Plex Web** ne le font
  généralement pas. Activez « **S'annoncer comme lecteur** » dans leurs
  réglages (souvent dans « Contrôle à distance ») — sans ce réglage, l'appli
  n'écoute aucune commande et **aucun logiciel ne peut la piloter**, Gladys
  comme l'application Plex elle-même.

L'intégration tente deux chemins avant d'abandonner : via le **serveur**
(pour les lecteurs qu'il a découverts), puis **directement vers le lecteur**
sur son adresse locale (port 32500) — le chemin qu'utilise Plex pour
« caster ». Le bouton **Stop** dispose en plus d'un filet de sécurité :
il coupe la lecture côté serveur, ce qui marche avec n'importe quel lecteur.

## Idées d'automatisations

- Quand **Dans le générique** s'active dans le salon → rallumer les lumières ;
- Quand **État de lecture** passe à 1 (en lecture) après 22 h → tamiser les
  lumières à 20 % ;
- À 7 h en semaine → **Lancer une musique sur une enceinte** : votre playlist « Matin » sur
  l'enceinte de la cuisine ;
- Quand **Flux actifs** dépasse 3 → envoyer une notification (bande passante !) ;
- Un bouton sur le tableau de bord pour mettre en **Pause** tous les lecteurs
  à l'heure du dîner.

## Dépannage

Consultez les logs de l'intégration depuis l'interface Gladys (ou
`docker logs` sur l'hôte). Ils restent courts : démarrage, connexion au
serveur, lecteurs trouvés, commandes, et une ligne quand le serveur ne répond
plus, et non une par tentative (puis une à son retour). `LOG_LEVEL=debug`
ajoute le détail de chaque rafraîchissement.

- **« Plex authentication failed »** — le jeton est invalide ou expiré.
  Récupérez un X-Plex-Token à jour et mettez la configuration à jour.
- **« Plex server unreachable »** — vérifiez l'URL (schéma, IP, port 32400)
  et que Gladys peut joindre le réseau du serveur.
- **Un lecteur ne réagit pas aux commandes** — les commandes transitent par
  le **serveur**, qui doit pouvoir joindre le lecteur. Si rien ne se passe,
  activez « S'annoncer comme lecteur » dans l'application Plex concernée
  (réglage absent de certaines applications), puis relancez **Rechercher les
  lecteurs Plex**. Quand le serveur refuse une commande, Gladys affiche une
  erreur explicite — sauf pour **Stop**, qui interrompt alors la lecture
  côté serveur (fin de session), ce qui fonctionne avec n'importe quel
  lecteur.
- **Les capteurs intro/générique ne s'activent jamais** — la détection des
  intros/génériques doit être activée sur votre serveur Plex
  (Réglages → Bibliothèque) et les marqueurs n'existent que pour les éléments
  déjà analysés.
