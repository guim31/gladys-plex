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
- **État de lecture** (en lecture ou non) — compatible avec le widget
  **Musique** du tableau de bord de Gladys ;
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

## Découverte des lecteurs

Les lecteurs apparaissent automatiquement :

- les lecteurs enregistrés auprès du serveur (la liste `/clients`) sont
  trouvés au démarrage et via le bouton **Rechercher les lecteurs Plex** ;
- tout lecteur qui **démarre une lecture** est découvert à la volée et publié
  dans l'onglet Découverte, même s'il n'est pas contrôlable à distance.

Note : tous les clients Plex n'acceptent pas le contrôle à distance. Un
lecteur doit s'annoncer auprès de votre serveur (c'est le cas de la plupart
des applications TV et bureau ; certaines applications mobiles demandent
d'activer le réglage « S'annoncer comme lecteur »).

## Idées d'automatisations

- Quand **Dans le générique** s'active dans le salon → rallumer les lumières ;
- Quand **État de lecture** s'active après 22 h → tamiser les lumières à 20 % ;
- Quand **Flux actifs** dépasse 3 → envoyer une notification (bande passante !) ;
- Un bouton sur le tableau de bord pour mettre en **Pause** tous les lecteurs
  à l'heure du dîner.

## Dépannage

L'intégration journalise tout ce qu'elle fait : consultez les logs de
l'intégration depuis l'interface Gladys (ou `docker logs` sur l'hôte) avec
`LOG_LEVEL=debug` pour le détail complet.

- **« Plex authentication failed »** — le jeton est invalide ou expiré.
  Récupérez un X-Plex-Token à jour et mettez la configuration à jour.
- **« Plex server unreachable »** — vérifiez l'URL (schéma, IP, port 32400)
  et que Gladys peut joindre le réseau du serveur.
- **Un lecteur ne réagit pas aux commandes** — le lecteur doit être joignable
  par le **serveur** (les commandes transitent par lui). Vérifiez qu'il
  apparaît après un **Rechercher les lecteurs Plex** et que le contrôle à
  distance est autorisé dans les réglages du lecteur.
- **Les capteurs intro/générique ne s'activent jamais** — la détection des
  intros/génériques doit être activée sur votre serveur Plex
  (Réglages → Bibliothèque) et les marqueurs n'existent que pour les éléments
  déjà analysés.
