// -----------------------------------------------------------------------------
// Dashboard widgets (Gladys 5.1+), content builders — pure functions.
//
//   - now_playing  : who watches what, where, with the posters (a row per
//                    playback) and two live tiles bound to the server sensors;
//   - player       : ONE player, as a remote: the artwork of what it plays,
//                    title, state, remaining time and the playback buttons;
//   - latest_media : the posters of the latest additions (movies, seasons,
//                    albums — Plex already groups new episodes by season).
//
// Artwork is served by the integration (the browser never loads a
// third-party URL): a content only carries image KEYS, resolved through
// onWidgetGetImage, which asks the server's photo transcoder for a JPEG of
// the right size. The core caches an image one hour by key; Plex image paths
// end with an update timestamp, so the key changes with the artwork.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';

/** Widget keys, declared in the manifest `widgets` (forever: never rename). */
export const WIDGET = {
  NOW_PLAYING: 'now_playing',
  PLAYER: 'player',
  LATEST_MEDIA: 'latest_media',
};

/** Entry types kept for each `kind` setting of the latest_media widget. */
export const LATEST_KINDS = {
  all: ['movie', 'show', 'season', 'episode'],
  movies: ['movie'],
  series: ['show', 'season', 'episode'],
  music: ['album'],
};

/** Box asked from the photo transcoder, per artwork kind (aspect kept). */
export const IMAGE_BOX = {
  poster: { width: 300, height: 450 },
  backdrop: { width: 800, height: 450 },
};

const MAX_LIST_ITEMS = 8;
const MAX_GRID_ITEMS = 12;

const TEXTS = {
  en: {
    streams: 'Streams',
    transcoding: 'Transcoding',
    playing: 'Playing',
    paused: 'Paused',
    nothingPlaying: 'Nothing is playing right now.',
    playerIdle: 'Nothing is playing on this player right now.',
    nothingNew: 'Nothing added recently.',
    remaining: 'Remaining time',
    state: 'State',
    user: 'User',
    play: 'Play',
    pause: 'Pause',
    stop: 'Stop',
    next: 'Next',
    on: 'on',
    openInPlex: 'Open in Plex',
  },
  fr: {
    streams: 'Lectures',
    transcoding: 'Transcodage',
    playing: 'Lecture',
    paused: 'Pause',
    nothingPlaying: "Rien n'est en cours de lecture.",
    playerIdle: 'Rien en lecture sur ce lecteur pour le moment.',
    nothingNew: 'Aucun ajout récent.',
    remaining: 'Temps restant',
    state: 'État',
    user: 'Utilisateur',
    play: 'Lecture',
    pause: 'Pause',
    stop: 'Stop',
    next: 'Suivant',
    on: 'sur',
    openInPlex: 'Ouvrir dans Plex',
  },
};

/**
 * Texts of a widget request language ('fr-FR', 'en'...), English fallback.
 * @param {unknown} language
 */
export function texts(language) {
  return String(language ?? '')
    .toLowerCase()
    .startsWith('fr')
    ? TEXTS.fr
    : TEXTS.en;
}

/**
 * @param {string} text
 * @param {number} max
 */
export function truncate(text, max) {
  const value = String(text ?? '');
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Poster of an entry: the show poster for an episode, the album cover for a
 * track, the entry's own image otherwise. Null when Plex has none.
 * @param {ReturnType<import('./plex/sessions.js').normalizeMetadata>} item
 * @returns {{ path: string, kind: 'poster' }|null}
 */
export function posterOf(item) {
  if (!item) {
    return null;
  }
  const { thumb, parentThumb, grandparentThumb } = item.images;
  let path = thumb;
  if (item.type === 'episode') {
    path = grandparentThumb || parentThumb || thumb;
  } else if (item.type === 'track') {
    path = parentThumb || thumb;
  } else if (item.type === 'season') {
    path = thumb || parentThumb;
  }
  return path ? { path, kind: 'poster' } : null;
}

/**
 * Landscape art for the 16:9 frame of the player widget: the fan art (the
 * show's for an episode), or the episode still. Null for music, which shows
 * its square cover instead.
 * @param {ReturnType<import('./plex/sessions.js').normalizeMetadata>} item
 * @returns {{ path: string, kind: 'backdrop' }|null}
 */
export function backdropOf(item) {
  if (!item || item.type === 'track') {
    return null;
  }
  const { art, grandparentArt, thumb } = item.images;
  let path = art;
  if (item.type === 'episode') {
    path = grandparentArt || art || thumb;
  }
  return path ? { path, kind: 'backdrop' } : null;
}

/**
 * Image key of an artwork (`^[a-z0-9][a-z0-9-]{0,63}$`).
 * @param {{ path: string, kind: string }} artwork
 */
export function imageKey(artwork) {
  const slug = String(artwork.path)
    .toLowerCase()
    .replace(/^\/library\/metadata\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const key = `${artwork.kind}-${slug}`.slice(0, 64).replace(/-+$/, '');
  return key.length > artwork.kind.length + 1 ? key : `${artwork.kind}-x`;
}

/**
 * Link to an entry in the Plex web app (always https: app.plex.tv).
 * @param {string} machineIdentifier - Server id.
 * @param {string|null} ratingKey
 * @param {string} language
 */
export function itemLinks(machineIdentifier, ratingKey, language) {
  if (!machineIdentifier || !ratingKey) {
    return [];
  }
  const key = encodeURIComponent(`/library/metadata/${ratingKey}`);
  return [
    {
      url: `https://app.plex.tv/desktop/#!/server/${machineIdentifier}/details?key=${key}`,
      label: texts(language).openInPlex,
    },
  ];
}

/**
 * Two lines describing an entry for the player widget: the main name
 * (heading, ≤ 40) and what completes it (caption, ≤ 80).
 * @param {ReturnType<import('./plex/sessions.js').normalizeMetadata>} item
 */
export function describeItem(item) {
  if (item.type === 'episode' && item.seriesName) {
    const pad = (n) => String(n).padStart(2, '0');
    const code =
      item.season !== null && item.episode !== null
        ? `S${pad(item.season)}E${pad(item.episode)}`
        : '';
    return { heading: item.seriesName, caption: [code, item.name].filter(Boolean).join(' · ') };
  }
  if (item.type === 'track') {
    return { heading: item.name, caption: [item.artist, item.album].filter(Boolean).join(' · ') };
  }
  return { heading: item.name, caption: item.year ? String(item.year) : '' };
}

/**
 * Content of the now_playing widget.
 * @param {{ sessions: Array<object>, streamsFeature: string, transcodesFeature: string,
 *   language: string, register: (artwork: object) => string }} input
 *   `register` records an artwork and returns its image key.
 */
export function buildNowPlayingContent({
  sessions,
  streamsFeature,
  transcodesFeature,
  language,
  register,
}) {
  const t = texts(language);
  const components = [
    { type: 'value', device_feature: streamsFeature, label: t.streams, icon: 'play-circle' },
    { type: 'value', device_feature: transcodesFeature, label: t.transcoding, icon: 'cpu' },
  ];
  const playing = sessions.slice(0, MAX_LIST_ITEMS);
  if (playing.length === 0) {
    components.push({ type: 'text', variant: 'body', text: t.nothingPlaying });
    return { ttl_seconds: 60, components };
  }
  components.push({
    type: 'card-list',
    display: 'list',
    items: playing.map((session) => {
      const poster = posterOf(session.item);
      let badge = { text: t.playing, color: WIDGET_COLORS.SUCCESS };
      if (session.state === 'paused') {
        badge = { text: t.paused, color: WIDGET_COLORS.WARNING };
      } else if (session.transcoding) {
        badge = { text: t.transcoding, color: WIDGET_COLORS.INFO };
      }
      return compact({
        title: truncate(session.title, 60),
        subtitle: truncate(
          [session.user, session.playerName].filter(Boolean).join(` ${t.on} `),
          60,
        ),
        image: poster ? register(poster) : undefined,
        badge,
        description: session.item?.summary ? truncate(session.item.summary, 2000) : undefined,
      });
    }),
  });
  return { ttl_seconds: 30, components };
}

/**
 * Content of the player widget: one player, as a remote.
 * @param {{ session: object|null, playerName: string, featureOf: (key: string) => string,
 *   language: string, register: (artwork: object) => string }} input
 *   `featureOf` gives the external id of one of the player's features.
 */
export function buildPlayerContent({ session, playerName, featureOf, language, register }) {
  const t = texts(language);
  if (!session) {
    return {
      ttl_seconds: 60,
      components: [
        { type: 'text', variant: 'heading', text: truncate(playerName, 40) },
        { type: 'text', variant: 'body', text: t.playerIdle },
      ],
    };
  }
  const { item } = session;
  const { heading, caption } = describeItem(item);
  const paused = session.state === 'paused';
  const landscape = backdropOf(item);
  const poster = posterOf(item);
  const components = [{ type: 'text', variant: 'heading', text: truncate(heading, 40) }];
  if (caption) {
    components.push({ type: 'text', variant: 'caption', text: truncate(caption, 80) });
  }
  components.push({
    type: 'value',
    device_feature: featureOf('remaining'),
    label: t.remaining,
    icon: 'clock',
  });
  if (landscape || poster) {
    components.push({
      type: 'image',
      key: register(landscape ?? poster),
      alt: truncate(session.title, 80),
      // Fan art fills the 16:9 frame; a portrait poster or a square cover is
      // shown whole.
      fit: landscape ? 'cover' : 'contain',
    });
  }
  const status = [
    {
      label: t.state,
      value: paused ? t.paused : session.transcoding ? t.transcoding : t.playing,
      color: paused ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    },
  ];
  if (session.user) {
    status.push({ label: t.user, value: truncate(session.user, 40) });
  }
  components.push({ type: 'status', items: status });
  const button = (label, icon, style, key) => ({
    type: 'button',
    label,
    icon,
    style,
    device_feature: featureOf(key),
    value: 1,
  });
  components.push(
    paused
      ? button(t.play, 'play', 'primary', 'play')
      : button(t.pause, 'pause', 'primary', 'pause'),
    button(t.stop, 'square', 'secondary', 'stop'),
    button(t.next, 'skip-forward', 'secondary', 'next'),
  );
  return { ttl_seconds: 30, components };
}

/**
 * Content of the latest_media widget.
 * @param {{ items: Array<object>, kind?: string, language: string,
 *   machineIdentifier: string, register: (artwork: object) => string }} input
 *   `items` are normalized /library/recentlyAdded entries, newest first.
 */
export function buildLatestContent({ items, kind, language, machineIdentifier, register }) {
  const t = texts(language);
  const types = LATEST_KINDS[kind] ?? LATEST_KINDS.all;
  const cards = items.filter((item) => types.includes(item.type)).slice(0, MAX_GRID_ITEMS);
  if (cards.length === 0) {
    return {
      ttl_seconds: 900,
      components: [{ type: 'text', variant: 'body', text: t.nothingNew }],
    };
  }
  return {
    ttl_seconds: 900,
    components: [
      {
        type: 'card-list',
        display: 'grid',
        items: cards.map((item) => {
          const poster = posterOf(item);
          let title = item.name;
          let subtitle = item.year ? String(item.year) : undefined;
          if (item.type === 'season') {
            title = item.showName || item.name;
            subtitle = item.name;
          } else if (item.type === 'episode') {
            title = item.seriesName || item.name;
            subtitle = describeItem(item).caption;
          } else if (item.type === 'album') {
            subtitle = item.artist || subtitle;
          }
          return compact({
            title: truncate(title, 60),
            subtitle: subtitle ? truncate(subtitle, 60) : undefined,
            // The grid shows the date INSTEAD of the subtitle: only when
            // there is nothing better to say.
            date:
              !subtitle && item.addedAt ? new Date(item.addedAt * 1000).toISOString() : undefined,
            image: poster ? register(poster) : undefined,
            description: item.summary ? truncate(item.summary, 2000) : undefined,
            links: itemLinks(machineIdentifier, item.ratingKey, language),
          });
        }),
      },
    ],
  };
}

/**
 * Drop the undefined fields and the empty link lists of a card.
 * @param {Record<string, unknown>} card
 */
function compact(card) {
  return Object.fromEntries(
    Object.entries(card).filter(
      ([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0),
    ),
  );
}
