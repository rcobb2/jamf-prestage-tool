// Pure alert computation and chat-payload formatting for the ADE watcher.
//
// Deliberately dependency-free — no db.ts, no axios, no logger — so it can be unit
// tested under Jest, which cannot resolve Bun's built-in `bun:sqlite`.

export type ADEDeviceRecord = {
  serialNumber: string;
  model?: string | null;
  description?: string | null;
  assetTag?: string | null;
  deviceAssignedDate?: string | null;
};

export type NewADEDevice = ADEDeviceRecord & { instanceId: string; instanceName: string | null };

// Devices listed in a single chat message before the rest are summarised as "+N more".
export const MAX_DEVICES_PER_MESSAGE = 20;

// Hard caps the destination platforms enforce on a single message's text field.
export const GOOGLE_CHAT_TEXT_LIMIT = 4096;
export const DISCORD_CONTENT_LIMIT = 2000;

// Chat platforms all expect a different envelope for the same text. Inferring it from the
// URL keeps single-var configuration working; the override handles a proxied URL whose
// host is no longer recognisable.
export type WebhookFormat = 'teams' | 'teams-workflow' | 'slack' | 'discord' | 'google-chat' | 'json';

export function detectWebhookFormat(url: string, override?: string): WebhookFormat {
  if (override) return override as WebhookFormat;
  if (url.includes('hooks.slack.com')) return 'slack';
  if (url.includes('chat.googleapis.com') || url.includes('chat.google.com')) return 'google-chat';
  if (url.includes('discord.com/api/webhooks') || url.includes('discordapp.com/api/webhooks')) return 'discord';
  // Power Automate "Workflows" webhooks require an Adaptive Card; the retired
  // Office 365 connectors (webhook.office.com) take a legacy MessageCard.
  if (url.includes('logic.azure.com') || url.includes('logic.azure.us')) return 'teams-workflow';
  if (url.includes('webhook.office.com') || url.includes('office365.com')) return 'teams';
  return 'json';
}

// Returns the devices in `fetched` that aren't already in the seen-set. Order is preserved
// so the resulting alert reads in the order Jamf returned the devices.
export function diffNewDevices(fetched: ADEDeviceRecord[], knownSerials: Set<string>): ADEDeviceRecord[] {
  const seen = new Set<string>();
  const out: ADEDeviceRecord[] = [];
  for (const device of fetched) {
    const serial = device.serialNumber;
    // A record with no serial can't be diffed or alerted on usefully, and a serial
    // duplicated across pages would otherwise alert twice.
    if (!serial || knownSerials.has(serial) || seen.has(serial)) continue;
    seen.add(serial);
    out.push(device);
  }
  return out;
}

// Normalises a raw Jamf device-enrollment record down to the fields alerts use.
export function normalizeADEDevice(raw: any): ADEDeviceRecord {
  return {
    serialNumber: raw?.serialNumber,
    model: raw?.model ?? null,
    description: raw?.description ?? null,
    // Apple's ADE asset tag, not the Jamf inventory asset tag field.
    assetTag: raw?.assetTag ?? null,
    deviceAssignedDate: raw?.deviceAssignedDate != null ? String(raw.deviceAssignedDate) : null,
  };
}

function describeDevice(d: NewADEDevice): string {
  const parts = [d.serialNumber];
  if (d.model) parts.push(d.model);
  if (d.description && d.description !== d.model) parts.push(d.description);
  if (d.assetTag) parts.push(`asset ${d.assetTag}`);
  return parts.join(' · ');
}

export function buildWebhookPayload(format: WebhookFormat, devices: NewADEDevice[]): unknown {
  const count = devices.length;
  const title = `${count} new device${count === 1 ? '' : 's'} in Apple School/Business Manager`;
  const shown = devices.slice(0, MAX_DEVICES_PER_MESSAGE);
  const lines = shown.map((d) => `• ${describeDevice(d)}`);
  if (count > shown.length) lines.push(`• …and ${count - shown.length} more`);
  const body = lines.join('\n');
  const text = `**${title}**\n${body}`;

  switch (format) {
    case 'slack':
      return {
        text: title,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: title } },
          { type: 'section', text: { type: 'mrkdwn', text: body } },
        ],
      };

    case 'discord':
      // Discord hard-rejects a content field over 2000 characters.
      return { content: text.slice(0, DISCORD_CONTENT_LIMIT) };

    case 'teams':
      return {
        '@type': 'MessageCard',
        '@context': 'https://schema.org/extensions',
        summary: title,
        themeColor: '0076D7',
        title,
        // MessageCard collapses single newlines, so double them to keep one device per line.
        text: body.replace(/\n/g, '\n\n'),
      };

    case 'teams-workflow':
      return {
        type: 'message',
        attachments: [
          {
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: {
              $schema: 'https://adaptivecards.io/schemas/adaptive-card.json',
              type: 'AdaptiveCard',
              version: '1.4',
              body: [
                { type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', wrap: true },
                { type: 'TextBlock', text: body, wrap: true },
              ],
            },
          },
        ],
      };

    case 'google-chat':
      // Google Chat's REST API rejects a body containing unknown fields, so this must be
      // exactly a Message resource — `text` and nothing else. Its markdown is also
      // single-asterisk bold, not the double asterisks the other platforms use.
      return { text: `*${title}*\n${body}`.slice(0, GOOGLE_CHAT_TEXT_LIMIT) };

    default:
      return { title, count, text, devices };
  }
}
