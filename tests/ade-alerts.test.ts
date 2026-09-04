import {
  buildWebhookPayload,
  detectWebhookFormat,
  diffNewDevices,
  normalizeADEDevice,
  MAX_DEVICES_PER_MESSAGE,
  GOOGLE_CHAT_TEXT_LIMIT,
  DISCORD_CONTENT_LIMIT,
  type ADEDeviceRecord,
  type NewADEDevice,
} from '../server/ade-alerts.ts';

const device = (serialNumber: string, extra: Partial<ADEDeviceRecord> = {}): ADEDeviceRecord => ({
  serialNumber,
  model: 'MacBook Pro',
  description: null,
  assetTag: null,
  deviceAssignedDate: null,
  ...extra,
});

const newDevice = (serialNumber: string, extra: Partial<NewADEDevice> = {}): NewADEDevice => ({
  ...device(serialNumber),
  instanceId: '1',
  instanceName: 'Colgate ASM',
  ...extra,
});

describe('diffNewDevices', () => {
  it('returns only serials absent from the seen-set', () => {
    const result = diffNewDevices(
      [device('AAA111'), device('BBB222'), device('CCC333')],
      new Set(['BBB222'])
    );
    expect(result.map((d) => d.serialNumber)).toEqual(['AAA111', 'CCC333']);
  });

  it('returns nothing when every device is already known', () => {
    const result = diffNewDevices([device('AAA111')], new Set(['AAA111']));
    expect(result).toEqual([]);
  });

  it('treats an empty seen-set as everything being new', () => {
    const result = diffNewDevices([device('AAA111'), device('BBB222')], new Set());
    expect(result).toHaveLength(2);
  });

  it('de-duplicates a serial repeated across pages so it only alerts once', () => {
    const result = diffNewDevices([device('AAA111'), device('AAA111')], new Set());
    expect(result.map((d) => d.serialNumber)).toEqual(['AAA111']);
  });

  it('skips records with a missing serial number', () => {
    const result = diffNewDevices(
      [device(''), { serialNumber: undefined as any }, device('AAA111')],
      new Set()
    );
    expect(result.map((d) => d.serialNumber)).toEqual(['AAA111']);
  });

  it('preserves the order Jamf returned devices in', () => {
    const result = diffNewDevices([device('ZZZ999'), device('AAA111')], new Set());
    expect(result.map((d) => d.serialNumber)).toEqual(['ZZZ999', 'AAA111']);
  });
});

describe('normalizeADEDevice', () => {
  it('maps the fields the ADE payload actually carries', () => {
    expect(
      normalizeADEDevice({
        serialNumber: 'AAA111',
        model: 'iPad Air',
        description: 'IPAD AIR',
        assetTag: 'ASM-42',
        deviceAssignedDate: 1735689600000,
        profileStatus: 'ignored',
      })
    ).toEqual({
      serialNumber: 'AAA111',
      model: 'iPad Air',
      description: 'IPAD AIR',
      assetTag: 'ASM-42',
      deviceAssignedDate: '1735689600000',
    });
  });

  it('nulls absent optional fields rather than leaving them undefined', () => {
    expect(normalizeADEDevice({ serialNumber: 'AAA111' })).toEqual({
      serialNumber: 'AAA111',
      model: null,
      description: null,
      assetTag: null,
      deviceAssignedDate: null,
    });
  });
});

describe('detectWebhookFormat', () => {
  it.each([
    ['https://hooks.slack.com/services/T0/B0/xxx', 'slack'],
    ['https://discord.com/api/webhooks/123/abc', 'discord'],
    ['https://chat.googleapis.com/v1/spaces/AAQA/messages?key=k&token=t', 'google-chat'],
    ['https://prod-12.westus.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke', 'teams-workflow'],
    ['https://colgate.webhook.office.com/webhookb2/abc/IncomingWebhook/def', 'teams'],
    ['https://alerts.example.edu/hook', 'json'],
  ])('detects %s as %s', (url, expected) => {
    expect(detectWebhookFormat(url)).toBe(expected);
  });

  it('honours an explicit override for a proxied URL', () => {
    expect(detectWebhookFormat('https://proxy.example.edu/hook', 'slack')).toBe('slack');
  });
});

describe('buildWebhookPayload', () => {
  it('uses singular wording for one device', () => {
    const payload = buildWebhookPayload('json', [newDevice('AAA111')]) as any;
    expect(payload.title).toBe('1 new device in Apple School/Business Manager');
  });

  it('uses plural wording for several devices', () => {
    const payload = buildWebhookPayload('json', [newDevice('AAA111'), newDevice('BBB222')]) as any;
    expect(payload.title).toBe('2 new devices in Apple School/Business Manager');
    expect(payload.count).toBe(2);
  });

  it('includes the serial, model and asset tag in the body', () => {
    const payload = buildWebhookPayload('slack', [
      newDevice('AAA111', { model: 'iPad Air', assetTag: 'ASM-42' }),
    ]) as any;
    const body = payload.blocks[1].text.text;
    expect(body).toContain('AAA111');
    expect(body).toContain('iPad Air');
    expect(body).toContain('asset ASM-42');
  });

  it('omits a description that merely repeats the model', () => {
    const payload = buildWebhookPayload('json', [
      newDevice('AAA111', { model: 'iPad Air', description: 'iPad Air' }),
    ]) as any;
    expect(payload.text.match(/iPad Air/g)).toHaveLength(1);
  });

  it('truncates long lists and reports the remainder', () => {
    const devices = Array.from({ length: MAX_DEVICES_PER_MESSAGE + 5 }, (_, i) =>
      newDevice(`SER${i.toString().padStart(4, '0')}`)
    );
    const payload = buildWebhookPayload('json', devices) as any;
    expect(payload.count).toBe(MAX_DEVICES_PER_MESSAGE + 5);
    expect(payload.text).toContain('…and 5 more');
    expect(payload.text).toContain('SER0000');
    expect(payload.text).not.toContain(`SER00${MAX_DEVICES_PER_MESSAGE}`);
  });

  it('emits a Slack block-kit envelope', () => {
    const payload = buildWebhookPayload('slack', [newDevice('AAA111')]) as any;
    expect(payload.text).toContain('1 new device');
    expect(payload.blocks[0].type).toBe('header');
  });

  it('emits a legacy MessageCard for Office 365 connectors', () => {
    const payload = buildWebhookPayload('teams', [newDevice('AAA111')]) as any;
    expect(payload['@type']).toBe('MessageCard');
    expect(payload.title).toContain('1 new device');
  });

  it('emits an Adaptive Card attachment for Power Automate workflows', () => {
    const payload = buildWebhookPayload('teams-workflow', [newDevice('AAA111')]) as any;
    expect(payload.type).toBe('message');
    expect(payload.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(payload.attachments[0].content.body[1].text).toContain('AAA111');
  });

  it('emits a bare Google Chat Message resource with no extra fields', () => {
    const payload = buildWebhookPayload('google-chat', [
      newDevice('AAA111', { model: 'iPad Air' }),
    ]) as any;
    // Google Chat 400s on any unknown field, so `text` must be the only key.
    expect(Object.keys(payload)).toEqual(['text']);
    expect(payload.text).toContain('AAA111');
    expect(payload.text).toContain('iPad Air');
  });

  it('uses single-asterisk bold for Google Chat, not double', () => {
    const payload = buildWebhookPayload('google-chat', [newDevice('AAA111')]) as any;
    expect(payload.text).toMatch(/^\*1 new device in Apple School\/Business Manager\*\n/);
    expect(payload.text).not.toContain('**');
  });

  it('keeps Google Chat text within the 4096-character limit', () => {
    const devices = Array.from({ length: MAX_DEVICES_PER_MESSAGE }, (_, i) =>
      newDevice(`SER${i}`, { model: 'M'.repeat(500) })
    );
    const payload = buildWebhookPayload('google-chat', devices) as any;
    expect(payload.text.length).toBeLessThanOrEqual(GOOGLE_CHAT_TEXT_LIMIT);
  });

  it('keeps Discord content within the 2000-character limit', () => {
    const devices = Array.from({ length: MAX_DEVICES_PER_MESSAGE }, (_, i) =>
      newDevice(`SER${i}`, { model: 'M'.repeat(300) })
    );
    const payload = buildWebhookPayload('discord', devices) as any;
    expect(payload.content.length).toBeLessThanOrEqual(DISCORD_CONTENT_LIMIT);
  });
});
