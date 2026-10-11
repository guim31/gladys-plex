// -----------------------------------------------------------------------------
// Texts sent to Gladys outside the widgets: configuration action results and
// connection statuses. Gladys shows the user's language, English otherwise.
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
};
