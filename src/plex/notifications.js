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
// -----------------------------------------------------------------------------

import WebSocket from 'ws';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'plex-notifications' });

const INITIAL_RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 60_000;

export class PlexNotifications {
  /**
   * @param {{ plex_url: string, plex_token: string }} config
   * @param {{ onPlaying: () => void }} handlers - `onPlaying` is debounced by
   *   the caller; it is invoked for every playback-related event.
   */
  constructor(config, { onPlaying }) {
    this.url =
      config.plex_url.replace(/^http/, 'ws') +
      '/:/websockets/notifications?X-Plex-Token=' +
      encodeURIComponent(config.plex_token);
    this.onPlaying = onPlaying;
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
      this.ws = new WebSocket(this.url, {
        // Self-signed certificates are handled globally (see PlexApi); the
        // ws client follows the same process-wide TLS settings.
        handshakeTimeout: 10_000,
      });
    } catch (err) {
      logger.warn(`Notification socket creation failed: ${err.message}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      logger.info('Connected to the Plex notification socket');
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
    });

    this.ws.on('message', (raw) => {
      try {
        const container = JSON.parse(raw.toString())?.NotificationContainer;
        if (container?.type === 'playing') {
          this.onPlaying();
        }
      } catch {
        // Non-JSON frames are ignored: the poll remains the source of truth.
      }
    });

    this.ws.on('error', (err) => {
      logger.debug(`Notification socket error: ${err.message}`);
    });

    this.ws.on('close', () => {
      this.ws = null;
      if (!this.stopped) {
        logger.info('Plex notification socket closed, falling back to polling until reconnect');
        this.scheduleReconnect();
      }
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

  stop() {
    this.stopped = true;
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
