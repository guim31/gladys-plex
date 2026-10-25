// -----------------------------------------------------------------------------
// Gladys 5.3 music panel (manifest `music`): the SDK handlers, wired to the
// catalog of the connected monitor (src/catalog.js). Kept out of index.js so
// the tests and the bench run them on the SDK's fake Gladys.
// -----------------------------------------------------------------------------

/**
 * @param {object} gladys - SDK instance (or its fake).
 * @param {() => import('./monitor.js').PlexMonitor|null} getMonitor
 */
export function registerMusicHandlers(gladys, getMonitor) {
  const catalog = () => {
    const monitor = getMonitor();
    if (!monitor) {
      throw new Error('Plex server not connected');
    }
    return monitor.catalog;
  };
  gladys.onMusicBrowse(async (device, options) => catalog().browse(device, options));
  gladys.onMusicSearch(async (device, options) => catalog().search(device, options));
  gladys.onMusicPlay(async (device, media, mode) => catalog().play(device, media, mode));
  gladys.onMusicQueueGet(async (device, options) => catalog().queue(device, options));
  gladys.onMusicQueuePlay(async (device, index) => catalog().queuePlay(device, index));
  // Our own handler: the artworks go through the server's photo transcoder,
  // with the token (the SDK's default handler sends none).
  gladys.onMusicGetArtwork(async (key) => catalog().artwork(key));
}
