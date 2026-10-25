// -----------------------------------------------------------------------------
// Texts sent to Gladys outside the widgets: configuration action results,
// connection statuses (Gladys shows the user's language, English otherwise),
// and the folders and errors of the music panel (Gladys 5.3), in the language
// chosen in the configuration (the core sends none with a music command).
// -----------------------------------------------------------------------------

/** Every language of the Gladys interface. */
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const MESSAGES = {
  notConfigured: {
    en: 'Fill in the Plex server URL and token in the configuration.',
    fr: "Renseignez l'URL et le jeton du serveur Plex dans la configuration.",
    de: 'Gib die URL und das Token des Plex-Servers in der Konfiguration ein.',
    es: 'Introduzca la URL y el token del servidor Plex en la configuración.',
  },
  /** @param {{ friendlyName: string, version: string, libraries: number, players: number }} p */
  connected: ({ friendlyName, version, libraries, players }) => ({
    en: `Connected to "${friendlyName}" (Plex ${version}): ${libraries} libraries, ${players} players found.`,
    fr: `Connecté à « ${friendlyName} » (Plex ${version}) : ${libraries} bibliothèques, ${players} lecteurs trouvés.`,
    de: `Verbunden mit „${friendlyName}“ (Plex ${version}): ${libraries} Bibliotheken, ${players} Player gefunden.`,
    es: `Conectado a «${friendlyName}» (Plex ${version}): ${libraries} bibliotecas, ${players} reproductores encontrados.`,
  }),
  /** @param {{ total: number }} p */
  playersScanned: ({ total }) => ({
    en: `${total} Plex players known. New ones appear in the Discovery tab.`,
    fr: `${total} lecteurs Plex connus. Les nouveaux apparaissent dans l'onglet Découverte.`,
    de: `${total} Plex-Player bekannt. Neue erscheinen im Tab „Entdecken“.`,
    es: `${total} reproductores Plex conocidos. Los nuevos aparecen en la pestaña «Descubrir».`,
  }),
  /** @param {{ error: string }} p */
  unreachable: ({ error }) => ({
    en: `Cannot reach the Plex server: ${error}`,
    fr: `Impossible de joindre le serveur Plex : ${error}`,
    de: `Der Plex-Server ist nicht erreichbar: ${error}`,
    es: `No se puede contactar con el servidor Plex: ${error}`,
  }),
  /** @param {{ error: string }} p */
  contactLost: ({ error }) => ({
    en: `Lost contact with the Plex server: ${error}`,
    fr: `Contact perdu avec le serveur Plex : ${error}`,
    de: `Verbindung zum Plex-Server verloren: ${error}`,
    es: `Se perdió el contacto con el servidor Plex: ${error}`,
  }),

  // --- Music panel (Gladys 5.3) ----------------------------------------------
  folderArtists: { en: 'Artists', fr: 'Artistes', de: 'Künstler', es: 'Artistas' },
  folderAlbums: { en: 'Albums', fr: 'Albums', de: 'Alben', es: 'Álbumes' },
  folderPlaylists: {
    en: 'Playlists',
    fr: 'Playlists',
    de: 'Playlists',
    es: 'Listas de reproducción',
  },
  notAPlayer: {
    en: 'This device is not a Plex player.',
    fr: "Cet appareil n'est pas un lecteur Plex.",
    de: 'Dieses Gerät ist kein Plex-Player.',
    es: 'Este dispositivo no es un reproductor Plex.',
  },
  notBrowsable: {
    en: 'This item cannot be opened.',
    fr: 'Cet élément ne peut pas être ouvert.',
    de: 'Dieses Element kann nicht geöffnet werden.',
    es: 'Este elemento no se puede abrir.',
  },
  notPlayable: {
    en: 'This item cannot be played.',
    fr: 'Cet élément ne peut pas être lu.',
    de: 'Dieses Element kann nicht abgespielt werden.',
    es: 'Este elemento no se puede reproducir.',
  },
  gone: {
    en: 'This item is no longer in the Plex library.',
    fr: "Cet élément n'est plus dans la bibliothèque Plex.",
    de: 'Dieses Element ist nicht mehr in der Plex-Bibliothek.',
    es: 'Este elemento ya no está en la biblioteca de Plex.',
  },
  emptyMedia: {
    en: 'Nothing to play in this item.',
    fr: 'Rien à lire dans cet élément.',
    de: 'In diesem Element gibt es nichts abzuspielen.',
    es: 'No hay nada que reproducir en este elemento.',
  },
  notInQueue: {
    en: 'This track is no longer in the queue.',
    fr: "Ce morceau n'est plus dans la file d'attente.",
    de: 'Dieser Titel ist nicht mehr in der Warteschlange.',
    es: 'Esta pista ya no está en la cola.',
  },
  badValue: {
    en: 'Value not supported by Plex.',
    fr: 'Valeur non prise en charge par Plex.',
    de: 'Wert wird von Plex nicht unterstützt.',
    es: 'Valor no compatible con Plex.',
  },
  /** @param {{ player: string }} p */
  nothingLoaded: ({ player }) => ({
    en: `Nothing is playing on ${player}.`,
    fr: `Rien n'est en cours de lecture sur ${player}.`,
    de: `Auf ${player} wird nichts abgespielt.`,
    es: `No se está reproduciendo nada en ${player}.`,
  }),
  /** @param {{ player: string }} p */
  cannotSeek: ({ player }) => ({
    en: `${player} cannot move within a live stream.`,
    fr: `${player} ne peut pas se déplacer dans un direct.`,
    de: `${player} kann in einem Livestream nicht springen.`,
    es: `${player} no puede desplazarse en una emisión en directo.`,
  }),
};

/**
 * A message of MESSAGES in a language, English when missing.
 * @param {string} key
 * @param {string} language
 * @param {object} [params] - Parameters of a message that takes some.
 * @returns {string}
 */
export function localized(key, language, params) {
  const message = typeof MESSAGES[key] === 'function' ? MESSAGES[key](params) : MESSAGES[key];
  return message[language] ?? message.en;
}

/**
 * An Error carrying a localized message (shown in the music panel, or in the
 * scene log for the `music.play-media` action).
 */
export function localizedError(key, language, params) {
  return new Error(localized(key, language, params));
}
