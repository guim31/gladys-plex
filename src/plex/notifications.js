// -----------------------------------------------------------------------------
// Plex real-time notifications.
//
// The Plex Media Server exposes a WebSocket at /:/websockets/notifications
// that streams server events. We only care about the `playing` events (a
// session started, paused, resumed, stopped or progressed): each one triggers
// an immediate session refresh, so playback state changes reach Gladys within
// a second instead of waiting for the next poll — the same mechanism the Home
// Assistant integration relies on.
//
// The socket is a nice-to-have: if it cannot connect (old server, proxy...),
// the periodic session poll still keeps everything up to date. Reconnection
// uses a simple capped exponential backoff.
//
// Logs stay quiet when the socket flaps: one info line when it first connects,
// one when it closes, then nothing (debug only) until it has stayed open for a
// minute again. The token travels in the URL query: it is masked in every
// message that could quote the URL.
// -----------------------------------------------------------------------------

import WebSocket from 'ws';
import { createLogger } from '@gladysassistant/integration-sdk';
import { redactSecret } from '../redact.js';

const logger = createLogger({ name: 'plex-notifications' });

export const INITIAL_RECONNECT_DELAY_MS = 5_000;
export const MAX_RECONNECT_DELAY_MS = 60_000;
// A connection is considered back (info log, backoff reset) once it has stayed
// open this long: a socket that opens and closes right away is still "lost".
export const STABLE_CONNECTION_MS = 60_000;

export class PlexNotifications {
  /**
   * @param {{ plex_url: string, plex_token: string }} config
   * @param {{ onPlaying: (entries: Array<object>) => void }} handlers - `onPlaying` is debounced by
   *   the caller; it is invoked for every playback-related event.
   * @param {{ WebSocketImpl?: typeof WebSocket }} [options] - Socket class
   *   (the tests pass an in-memory one).
   */
  constructor(config, { onPlaying }, { WebSocketImpl = WebSocket } = {}) {
    this.WebSocketImpl = WebSocketImpl;
    this.url =
      config.plex_url.replace(/^http/, 'ws') +
      '/:/websockets/notifications?X-Plex-Token=' +
      encodeURIComponent(config.plex_token);
    this.token = config.plex_token;
    this.onPlaying = onPlaying;
    this.everConnected = false;
    this.lost = false;
    this.stableTimer = null;
    this.ws = null;
    this.stopped = false;
    this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
    this.reconnectTimer = null;
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  connect() {
    if (this.stopped) {
      return;
    }
    try {
      this.ws = new this.WebSocketImpl(this.url, {
        // Self-signed certificates are handled globally (see PlexApi); the
        // ws client follows the same process-wide TLS settings.
        handshakeTimeout: 10_000,
      });
    } catch (err) {
      logger.debug(`Notification socket creation failed: ${this.redact(err.message)}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      if (!this.everConnected) {
        this.everConnected = true;
        logger.info('Connected to the Plex notification socket');
      } else {
        logger.debug('Plex notification socket reopened');
      }
      this.stableTimer = setTimeout(() => {
        this.stableTimer = null;
        this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
        if (this.lost) {
          this.lost = false;
          logger.info('Plex notification socket back');
        }
      }, STABLE_CONNECTION_MS);
    });

    this.ws.on('message', (raw) => {
      try {
        const container = JSON.parse(raw.toString())?.NotificationContainer;
        if (container?.type === 'playing') {
          // The entries carry what /status/sessions does not: the play queue
          // of the player (`playQueueID`, `playQueueItemID`).
          this.onPlaying(container.PlaySessionStateNotification ?? []);
        }
      } catch {
        // Non-JSON frames are ignored: the poll remains the source of truth.
      }
    });

    this.ws.on('error', (err) => {
      logger.debug(`Notification socket error: ${this.redact(err.message)}`);
    });

    this.ws.on('close', () => {
      this.ws = null;
      this.clearStableTimer();
      if (this.stopped) {
        return;
      }
      if (!this.everConnected) {
        // Never opened yet (old server, proxy...): nothing was lost.
        logger.debug(`Plex notification socket unavailable, retry in ${this.reconnectDelay} ms`);
      } else if (!this.lost) {
        this.lost = true;
        logger.info(
          'Plex notification socket closed, the session poll keeps running until it is back',
        );
      } else {
        logger.debug(`Plex notification socket closed again, retry in ${this.reconnectDelay} ms`);
      }
      this.scheduleReconnect();
    });
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
  }

  clearStableTimer() {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
  }

  /** Mask the Plex token in a message that may quote the socket URL. */
  redact(message) {
    return redactSecret(message, this.token);
  }

  stop() {
    this.stopped = true;
    this.clearStableTimer();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Already closing.
      }
      this.ws = null;
    }
  }
}
