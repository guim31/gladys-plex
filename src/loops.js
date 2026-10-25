// -----------------------------------------------------------------------------
// Refresh loops owned by the integration.
//
// No Plex device asks Gladys to poll it (no `should_poll`, no
// `poll_frequency`): the core only polls at a fixed list of fast paces, and
// Gladys 5.2.0 never polls a device created without `should_poll` anyway
// (GladysAssistant/Gladys#3198). Every value therefore comes from the timers
// below, never from the core's `onPoll`:
//   - the session poll (config.session_poll_frequency seconds): playback
//     states, markers, server activity, scene events;
//   - the library poll (config.poll_frequency seconds): library counts;
//   - the real-time notification socket, which only accelerates the session
//     poll (every playback event triggers a debounced refresh).
//
// Repeated failures are logged once (see FailureLog), and three session
// failures in a row flag the integration as disconnected in Gladys.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { PlexNotifications } from './plex/notifications.js';
import { FailureLog } from './failure-log.js';
import { MESSAGES } from './messages.js';
import { redactSecret } from './redact.js';

const logger = createLogger({ name: 'plex-loops' });

/** Session failures in a row before the connection status turns red. */
export const FAILURES_BEFORE_DISCONNECTED = 3;

export class RefreshLoops {
  /**
   * @param {object} gladys - SDK instance.
   * @param {ReturnType<import('./config.js').normalizeConfig>} config
   * @param {import('./monitor.js').PlexMonitor} monitor
   * @param {{ createNotifications?: (config: object, handlers: object) => { start(): void, stop(): void } }} [options]
   */
  constructor(gladys, config, monitor, options = {}) {
    this.gladys = gladys;
    this.config = config;
    this.monitor = monitor;
    this.createNotifications =
      options.createNotifications ?? ((cfg, handlers) => new PlexNotifications(cfg, handlers));
    const redact = (message) => redactSecret(message, config.plex_token);
    this.sessionFailures = new FailureLog(logger, 'Plex session refresh', { redact });
    this.libraryFailures = new FailureLog(logger, 'Plex library refresh', { redact });
    this.sessionInterval = null;
    this.libraryInterval = null;
    this.notifications = null;
    this.stopped = true;
  }

  start() {
    this.stop();
    this.stopped = false;
    this.sessionInterval = setInterval(() => {
      this.refreshSessions();
    }, this.config.session_poll_frequency * 1_000);
    this.libraryInterval = setInterval(() => {
      this.refreshLibraries();
    }, this.config.poll_frequency * 1_000);
    this.notifications = this.createNotifications(this.config, {
      onPlaying: (entries) => {
        this.monitor.notePlayQueues(entries);
        this.monitor.scheduleSessionRefresh();
      },
    });
    this.notifications.start();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.sessionInterval);
    clearInterval(this.libraryInterval);
    this.sessionInterval = null;
    this.libraryInterval = null;
    this.notifications?.stop();
    this.notifications = null;
  }

  /** One session poll; never throws. */
  async refreshSessions() {
    try {
      await this.monitor.refreshSessions();
      if (this.stopped) {
        // Stopped meanwhile (new configuration, disconnection): a newer
        // monitor owns the devices and the connection status now.
        return;
      }
      if (this.sessionFailures.succeeded() >= FAILURES_BEFORE_DISCONNECTED) {
        await this.gladys.setConnectionStatus(true).catch(() => {});
      }
    } catch (err) {
      if (this.stopped) {
        return;
      }
      if (this.sessionFailures.failed(err) === FAILURES_BEFORE_DISCONNECTED) {
        await this.gladys
          .setConnectionStatus(false, MESSAGES.contactLost({ error: err.message }))
          .catch(() => {});
      }
    }
    if (this.stopped) {
      return;
    }
    // A never-seen player started streaming: offer it in the Discovery tab.
    // A Gladys-side failure here is not a Plex failure: retried next poll.
    await this.monitor.publishPendingDiscovery().catch((err) => {
      logger.debug(`Discovery publication failed, retrying next poll: ${err.message}`);
    });
  }

  /** One library poll; never throws. */
  async refreshLibraries() {
    try {
      await this.monitor.refreshLibraries();
      if (!this.stopped) {
        this.libraryFailures.succeeded();
      }
    } catch (err) {
      if (!this.stopped) {
        this.libraryFailures.failed(err);
      }
    }
  }
}
