import axios from 'axios';

import logger from './logger.ts';
import {
  getKnownADESerials,
  isADEInstanceSeeded,
  recordADEDevices,
  markADEInstanceSeeded,
  markADEInstancePolled,
  writeAudit,
} from './db.ts';
import {
  buildWebhookPayload,
  detectWebhookFormat,
  diffNewDevices,
  normalizeADEDevice,
  type NewADEDevice,
} from './ade-alerts.ts';
import * as utils from './utils.ts';

const {
  ADE_WATCH_ENABLED,
  ADE_WATCH_INTERVAL_MINUTES,
  ADE_ALERT_WEBHOOK_URL,
  ADE_ALERT_WEBHOOK_FORMAT,
} = process.env;

// Posts to the configured chat webhook. Never throws: a broken webhook must not stop the
// watcher from recording devices or writing the in-app alert feed.
async function notifyWebhook(devices: NewADEDevice[]): Promise<void> {
  if (!ADE_ALERT_WEBHOOK_URL) return;
  const format = detectWebhookFormat(ADE_ALERT_WEBHOOK_URL, ADE_ALERT_WEBHOOK_FORMAT);
  try {
    await axios.post(ADE_ALERT_WEBHOOK_URL, buildWebhookPayload(format, devices), {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    logger.info({ count: devices.length, format }, 'ADE alert posted to chat webhook');
  } catch (err: any) {
    logger.warn(
      { err: err.message, status: err.response?.status, format },
      'ADE alert chat webhook failed — devices are still recorded in the in-app feed'
    );
  }
}

// Runs one full sweep across every device-enrollment instance and returns the devices
// that were newly detected. An instance's first sweep seeds the baseline silently.
export async function runADEWatchTick(): Promise<NewADEDevice[]> {
  const instances = await utils.getADEInstances();
  logger.debug({ instances: instances.length }, 'ADE watch tick started');
  const allNew: NewADEDevice[] = [];

  for (const instance of instances) {
    const instanceId = String(instance.id);
    const instanceName = instance.name ?? null;
    try {
      const fetched = (await utils.getADEEnrolledDevices(instanceId)).map(normalizeADEDevice);

      if (!isADEInstanceSeeded(instanceId)) {
        // First time we've ever seen this instance: everything Apple already has is
        // baseline, not news. Alerting here would fire once per device in the org.
        recordADEDevices(instanceId, instanceName, fetched, false);
        markADEInstanceSeeded(instanceId, instanceName, fetched.length);
        logger.info(
          { instanceId, instanceName, count: fetched.length },
          'ADE watcher seeded baseline for device-enrollment instance — no alerts emitted'
        );
        continue;
      }

      const known = getKnownADESerials(instanceId);
      const newDevices = diffNewDevices(fetched, known);

      if (newDevices.length > 0) {
        recordADEDevices(instanceId, instanceName, newDevices, true);
        for (const device of newDevices) {
          writeAudit({
            action: 'ade_device_added',
            actor: 'ade-watcher',
            device_serial: device.serialNumber,
            details: {
              instanceId,
              instanceName,
              model: device.model,
              description: device.description,
              assetTag: device.assetTag,
              deviceAssignedDate: device.deviceAssignedDate,
            },
            result: 'success',
          });
        }
        allNew.push(...newDevices.map((d) => ({ ...d, instanceId, instanceName })));
      }

      markADEInstancePolled(instanceId, instanceName);
    } catch (err: any) {
      // One unreachable or misconfigured instance must not abort the sweep for the rest.
      const detail = String(err.response?.data ?? err.message);
      logger.error({ instanceId, err: detail }, 'ADE watch tick failed for device-enrollment instance');
      markADEInstancePolled(instanceId, instanceName, detail);
    }
  }

  if (allNew.length > 0) {
    await notifyWebhook(allNew);
  }

  return allNew;
}

let ticking = false;
let timer: ReturnType<typeof setInterval> | null = null;

async function tickGuarded(): Promise<void> {
  // setInterval does not wait for the previous tick; a slow sweep over a large ASM/ABM
  // tenant could otherwise overlap itself and alert twice for the same device.
  if (ticking) {
    logger.warn('ADE watch tick skipped — previous tick is still running');
    return;
  }
  ticking = true;
  try {
    await runADEWatchTick();
  } catch (err: any) {
    // An unhandled rejection inside setInterval would take the server process down.
    logger.error({ err: err.message, stack: err.stack }, 'ADE watch tick failed');
  } finally {
    ticking = false;
  }
}

export function startADEWatcher(): void {
  if (ADE_WATCH_ENABLED === 'false') {
    logger.info('ADE watcher disabled via ADE_WATCH_ENABLED=false');
    return;
  }
  if (timer) return;

  const minutes = Math.max(1, parseInt(ADE_WATCH_INTERVAL_MINUTES ?? '15', 10) || 15);

  logger.info(
    { intervalMinutes: minutes, chatWebhook: !!ADE_ALERT_WEBHOOK_URL },
    'ADE watcher starting'
  );

  // Kick off immediately so a fresh deployment seeds its baseline right away rather
  // than leaving the first interval blind.
  void tickGuarded();
  timer = setInterval(() => void tickGuarded(), minutes * 60 * 1000);
}

export function stopADEWatcher(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
