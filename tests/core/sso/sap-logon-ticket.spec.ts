import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  generateLogonTicket,
  decodeLogonTicket,
  formatDecodedTicket,
  buildDataToSign,
  decodeInfoUnits,
  encodeInfoUnit,
  ID_USER,
  ID_CREATE_CLIENT,
  ID_CREATE_NAME,
  ID_CREATE_TIME,
  ID_VALID_TIME,
} from '../../../src/core/sso/sap-logon-ticket.js';

const certPem = readFileSync(join(__dirname, '../../fixtures/sso/test_dsa_cert.pem'), 'utf8');
const keyPem = readFileSync(join(__dirname, '../../fixtures/sso/test_dsa_key.pem'), 'utf8');

describe('sap-logon-ticket (MYSAPSSO2)', () => {
  it('round-trips a generated ticket', () => {
    const ticket = generateLogonTicket({
      username: 'SAP*',
      client: '001',
      system: 'NPL',
      issuedAt: new Date('2026-10-27T10:00:00Z'),
      durationHours: 8,
      certPem,
      keyPem,
    });

    const decoded = decodeLogonTicket(ticket);
    const fields = formatDecodedTicket(decoded);

    expect(decoded.codepage).toBe('4103');
    expect(fields.user).toBe('SAP*');
    expect(fields.client).toBe('001');
    expect(fields.sid).toBe('NPL');
    expect(fields.create_time).toBe('202610271000');
    expect(fields.valid_hours).toBe('8');
    expect(decoded.signature.length).toBeGreaterThan(100);
    // DataToSign begins with preamble 0x02 + codepage "4103".
    expect(decoded.dataToSign[0]).toBe(0x02);
    expect(decoded.dataToSign.subarray(1, 5).toString('ascii')).toBe('4103');
  });

  it('supports UTF-16BE codepage 4102', () => {
    const ticket = generateLogonTicket({
      username: 'USER',
      client: '002',
      system: 'TST',
      issuedAt: new Date('2026-01-01T00:00:00Z'),
      codepage: '4102',
      certPem,
      keyPem,
    });
    const decoded = decodeLogonTicket(ticket);
    const fields = formatDecodedTicket(decoded);
    expect(decoded.codepage).toBe('4102');
    expect(fields.user).toBe('USER');
    expect(fields.client).toBe('002');
    expect(fields.sid).toBe('TST');
  });

  it('encodes custom duration and extra units', () => {
    const ticket = generateLogonTicket({
      username: 'ADMIN',
      client: '100',
      system: 'PRD',
      durationHours: 12,
      certPem,
      keyPem,
    });
    const fields = formatDecodedTicket(decodeLogonTicket(ticket));
    expect(fields.valid_hours).toBe('12');
  });

  it('builds and decodes info units', () => {
    const unit = encodeInfoUnit(ID_USER, Buffer.from('USER', 'utf16le'));
    expect(unit[0]).toBe(ID_USER);
    expect(unit.readUInt16BE(1)).toBe(8); // "USER" UTF-16LE = 8 bytes

    const units = decodeInfoUnits(unit);
    expect(units).toHaveLength(1);
    expect(units[0].id).toBe(ID_USER);
    expect(units[0].value.toString('utf16le')).toBe('USER');
  });

  it('builds DataToSign with preamble and codepage', () => {
    const data = buildDataToSign('4103', [
      { id: ID_USER, value: Buffer.from('A', 'utf16le') },
      { id: ID_CREATE_CLIENT, value: Buffer.from('1', 'utf16le') },
      { id: ID_CREATE_NAME, value: Buffer.from('X', 'utf16le') },
      { id: ID_CREATE_TIME, value: Buffer.from('202601010000', 'utf16le') },
      { id: ID_VALID_TIME, value: Buffer.from([0, 0, 0, 8]) },
    ]);
    expect(data[0]).toBe(0x02);
    expect(data.subarray(1, 5).toString('ascii')).toBe('4103');
    // ID_USER (1) present
    expect(data[5]).toBe(ID_USER);
    // "A" UTF-16LE = 41 00 (2 bytes) after the 8-byte header
    expect(data.subarray(8, 10).toString('utf16le')).toBe('A');
  });

  it('rejects missing cert/key', () => {
    expect(() =>
      generateLogonTicket({
        username: 'U',
        client: '1',
        system: 'S',
        certPem: 'not a pem',
        keyPem: 'not a pem',
      }),
    ).toThrow();
  });

  it('rejects malformed cookie', () => {
    expect(() => decodeLogonTicket('!!!not-base64!!!')).toThrow();
  });
});

