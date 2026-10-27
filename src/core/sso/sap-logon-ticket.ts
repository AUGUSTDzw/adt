/**
 * SAP Logon Ticket (MYSAPSSO2) generation and decoding.
 *
 * Ported from `reference/sap_logon_ticket` (SAPLogonTicket.py +
 * forge_sap_logon_ticket.py). SAP is strict about the CMS (PKCS#7) format, so
 * the DER encoding is constructed by hand (no asn1.js / forge dependency).
 *
 * Wire format:
 *   DataToSign ::= preamble(0x02) + targetSystemCodepage(4 ASCII) + infoUnits*
 *   InfoUnit   ::= unitId(1) + unitLength(2 BE) + unitValue
 *   Ticket     ::= DataToSign + 0xFF + signatureLength(2 BE) + PKCS7(Signature)
 *   MYSAPSSO2  = urlEncode(base64url(ticket))   (base64 alphabet uses !/ instead of +/)
 *
 * The PKCS#7 SignedData is DSA-with-SHA1:
 *   ContentInfo ::= SEQUENCE {
 *     contentType OID(pkcs7-signedData),
 *     content [0] EXPLICIT SignedData
 *   }
 *   SignedData ::= SEQUENCE {
 *     version INTEGER(1),
 *     digestAlgorithms SET{ SEQUENCE{ OID(sha1), NULL } },
 *     encapContentInfo SEQUENCE{ OID(pkcs7-data) },
 *     signerInfos SET{ SignerInfo }
 *   }
 *   SignerInfo ::= SEQUENCE {
 *     version INTEGER(1),
 *     sid IssuerAndSerialNumber,
 *     digestAlgorithm SEQUENCE{ OID(sha1), NULL },
 *     signedAttrs [0] IMPLICIT SET{ contentType, signingTime, messageDigest },
 *     signatureAlgorithm SEQUENCE{ OID(dsaWithSHA1) },
 *     signature OCTET STRING( DSA-SHA1 DER )
 *   }
 */

import { createHash, createSign, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';

// ── Info unit IDs (see SAP InfoUnit javadoc) ─────────────────────────────────
export const ID_USER = 1;
export const ID_CREATE_CLIENT = 2;
export const ID_CREATE_NAME = 3;
export const ID_CREATE_TIME = 4;
export const ID_VALID_TIME = 5;
export const ID_RFC = 6;
export const ID_VALID_TIME_MIN = 7;
export const ID_FLAGS = 8;
export const ID_LANGUAGE = 9;
export const ID_USER_UTF = 10;
export const ID_CREATE_CLIENT_UTF = 11;
export const ID_CREATE_NAME_UTF = 12;
export const ID_CREATE_TIME_UTF = 13;
export const ID_LANGUAGE_UTF = 14;
export const ID_RECIPIENT_CLIENT = 15;
export const ID_RECIPIENT_SID = 16;
export const ID_AUTHSCHEME = 136;
export const ID_SIGNATURE = 255;

// ── OIDs (DER-encoded bodies, first byte of first arc folded) ────────────────
const OID_SHA1 = Buffer.from([0x2b, 0x0e, 0x03, 0x02, 0x1a]);
const OID_PKCS7_DATA = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01]);
const OID_PKCS7_SIGNED_DATA = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);
const OID_DSA_WITH_SHA1 = Buffer.from([0x2a, 0x86, 0x48, 0xce, 0x38, 0x04, 0x03]);
const OID_CONTENT_TYPE = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x03]);
const OID_SIGNING_TIME = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x05]);
const OID_MESSAGE_DIGEST = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x04]);
const OID_COMMON_NAME = Buffer.from([0x55, 0x04, 0x03]);

// ── Minimal DER encoder ──────────────────────────────────────────────────────

function derLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v >>>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
}

function derSeq(...parts: Buffer[]): Buffer {
  return derTlv(0x30, Buffer.concat(parts));
}

function derSetOf(...parts: Buffer[]): Buffer {
  // DER requires SET OF elements to be sorted by their full encoded bytes.
  const sorted = [...parts].sort((a, b) => Buffer.compare(a, b));
  return derTlv(0x31, Buffer.concat(sorted));
}

function derOid(body: Buffer): Buffer {
  return derTlv(0x06, body);
}

function derNull(): Buffer {
  return Buffer.from([0x05, 0x00]);
}

function derInt(value: number | Buffer): Buffer {
  if (typeof value === 'number') {
    if (value === 0) return Buffer.from([0x02, 0x01, 0x00]);
    const bytes: number[] = [];
    let v = value;
    while (v > 0) {
      bytes.unshift(v & 0xff);
      v >>>= 8;
    }
    if (bytes[0] & 0x80) bytes.unshift(0);
    return Buffer.from([0x02, bytes.length, ...bytes]);
  }
  // Buffer — ensure positive (leading zero if high bit set)
  const buf = value[0] & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value;
  return derTlv(0x02, buf);
}

function derOctetString(content: Buffer): Buffer {
  return derTlv(0x04, content);
}

function derBitString(content: Buffer): Buffer {
  return derTlv(0x03, Buffer.concat([Buffer.from([0]), content]));
}

function derUtcTime(d: Date): Buffer {
  const y = d.getUTCFullYear();
  const yy = String(y).slice(2);
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return derTlv(0x17, Buffer.from(`${yy}${mo}${dd}${hh}${mi}${ss}Z`, 'ascii'));
}

function derPrintableString(s: string): Buffer {
  return derTlv(0x13, Buffer.from(s, 'ascii'));
}

function derContextExplicit(tag: number, content: Buffer): Buffer {
  // [tag] EXPLICIT — the inner TLV is wrapped as-is.
  return derTlv(0xa0 | tag, content);
}

function derContextImplicitSet(tag: number, content: Buffer): Buffer {
  // [tag] IMPLICIT SET OF — the tag replaces 0x31, the length/content stay.
  return derTlv(0xa0 | tag, content);
}

// ── Certificate issuer extraction (minimal DER reader) ───────────────────────

/**
 * Reads a DER length header at `offset`, returns [length, bytesConsumed].
 */
function readDerLen(buf: Buffer, offset: number): [number, number] {
  const first = buf[offset];
  if (first < 0x80) return [first, 1];
  const n = first & 0x7f;
  let len = 0;
  for (let i = 1; i <= n; i++) len = (len << 8) | buf[offset + i];
  return [len, n + 1];
}

/**
 * Reads a TLV at `offset`, returns [tag, contentStart, contentEnd, nextOffset].
 */
function readDerTlv(buf: Buffer, offset: number): [number, number, number, number] {
  const tag = buf[offset];
  const [len, hdr] = readDerLen(buf, offset + 1);
  const contentStart = offset + 1 + hdr;
  return [tag, contentStart, contentStart + len, contentStart + len];
}

/**
 * Extracts the DER-encoded issuer Name from an X.509 certificate (PEM or DER).
 * Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }
 * TBSCertificate ::= SEQUENCE { [0] version?, serialNumber, signature, issuer, ... }
 * The issuer Name is the 4th top-level element of the TBSCertificate (or the
 * 3rd when the version field is absent).
 */
function extractIssuerDer(certDer: Buffer): Buffer {
  // Certificate ::= SEQUENCE { tbsCertificate, ... }
  const [, certContentStart] = readDerTlv(certDer, 0);
  // TBSCertificate ::= SEQUENCE { ... }
  const [, tbsContentStart, tbsContentEnd] = readDerTlv(certDer, certContentStart);
  let off = tbsContentStart;
  // Optional [0] version (absent for v1).
  if (certDer[off] === 0xa0) {
    const [, , versionEnd] = readDerTlv(certDer, off);
    off = versionEnd;
  }
  // serialNumber INTEGER
  const [, , serialEnd] = readDerTlv(certDer, off);
  off = serialEnd;
  // signature AlgorithmIdentifier
  const [, , sigEnd] = readDerTlv(certDer, off);
  off = sigEnd;
  // issuer Name
  const issuerTagPos = off;
  const [, issuerStart, issuerEnd] = readDerTlv(certDer, off);
  void issuerStart;
  void tbsContentEnd;
  // Return the full Name TLV (including the SEQUENCE tag) — CMS IssuerAndSerialNumber
  // expects the complete Name, not just its content.
  return certDer.subarray(issuerTagPos, issuerEnd);
}

// ── Info units ───────────────────────────────────────────────────────────────

export interface InfoUnit {
  id: number;
  value: Buffer;
}

export function encodeInfoUnit(id: number, value: Buffer): Buffer {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(value.length, 0);
  return Buffer.concat([Buffer.from([id]), len, value]);
}

export function decodeInfoUnits(buf: Buffer): InfoUnit[] {
  const units: InfoUnit[] = [];
  let off = 0;
  while (off < buf.length && buf[off] !== 0xff) {
    const id = buf[off];
    const len = buf.readUInt16BE(off + 1);
    const value = buf.subarray(off + 3, off + 3 + len);
    units.push({ id, value: Buffer.from(value) });
    off += 3 + len;
  }
  return units;
}

// ── DataToSign ───────────────────────────────────────────────────────────────

export function buildDataToSign(codepage: '4103' | '4102', units: InfoUnit[]): Buffer {
  const preamble = Buffer.from([0x02]);
  const cp = Buffer.from(codepage, 'ascii');
  const unitBufs = units.map((u) => encodeInfoUnit(u.id, u.value));
  return Buffer.concat([preamble, cp, ...unitBufs]);
}

function encodeValue(val: string | Date | number, encoding: 'utf16le' | 'utf16be'): Buffer {
  if (typeof val === 'string') {
    const le = Buffer.from(val, 'utf16le');
    if (encoding === 'utf16le') return le;
    // Convert UTF-16LE to BE by swapping every pair.
    const be = Buffer.alloc(le.length);
    for (let i = 0; i < le.length; i += 2) {
      be[i] = le[i + 1];
      be[i + 1] = le[i];
    }
    return be;
  }
  if (val instanceof Date) {
    const s = val.toISOString().replace(/[-:TZ]/g, '').slice(0, 12);
    return encodeValue(s, encoding);
  }
  const out = Buffer.alloc(4);
  out.writeUInt32BE(val, 0);
  return out;
}

// ── PKCS#7 SignedData construction ───────────────────────────────────────────

/**
 * Builds the SignedAttrs (contentType, signingTime, messageDigest) as the
 * IMPLICIT [0] SET OF Attribute and returns both the full DER (for hashing)
 * and the SET-OF content (for the outer SignerInfo TLV).
 */
function buildSignedAttrs(dataToSign: Buffer, signingTime: Date): { full: Buffer; content: Buffer } {
  const digest = createHash('sha1').update(dataToSign).digest();

  const contentTypeAttr = derSeq(derOid(OID_CONTENT_TYPE), derSetOf(derOid(OID_PKCS7_DATA)));
  const signingTimeAttr = derSeq(derOid(OID_SIGNING_TIME), derSetOf(derUtcTime(signingTime)));
  const messageDigestAttr = derSeq(derOid(OID_MESSAGE_DIGEST), derSetOf(derOctetString(digest)));

  // SET OF sorts attributes by encoded bytes.
  const attrs = [contentTypeAttr, signingTimeAttr, messageDigestAttr].sort((a, b) =>
    Buffer.compare(a, b),
  );
  const content = Buffer.concat(attrs);
  return { full: derContextImplicitSet(0, content), content };
}

/**
 * Builds a CMS SignedData ContentInfo (DSA-with-SHA1) for `dataToSign`.
 * The `issuerDer` is the DER-encoded issuer Name from the PSE certificate.
 */
function buildCmsSignedData(
  dataToSign: Buffer,
  issuerDer: Buffer,
  serialNumber: Buffer,
  dsaKey: Buffer | string,
  signingTime: Date,
): Buffer {
  const { content: signedAttrsContent } = buildSignedAttrs(dataToSign, signingTime);
  // Hash the full [0] IMPLICIT SET DER.
  const signedAttrsFull = derContextImplicitSet(0, signedAttrsContent);
  const sign = createSign('sha1');
  sign.update(signedAttrsFull);
  const signature = sign.sign(dsaKey);

  // sid = IssuerAndSerialNumber
  const sid = derSeq(issuerDer, derInt(serialNumber));

  const signerInfo = derSeq(
    derInt(1), // version
    sid,
    derSeq(derOid(OID_SHA1), derNull()), // digestAlgorithm
    signedAttrsFull, // [0] IMPLICIT SignedAttrs
    derSeq(derOid(OID_DSA_WITH_SHA1)), // signatureAlgorithm
    derOctetString(signature), // signature
  );

  const signedData = derSeq(
    derInt(1), // version
    derSetOf(derSeq(derOid(OID_SHA1), derNull())), // digestAlgorithms
    derSeq(derOid(OID_PKCS7_DATA)), // encapContentInfo
    derSetOf(signerInfo), // signerInfos
  );

  return derSeq(derOid(OID_PKCS7_SIGNED_DATA), derContextExplicit(0, signedData));
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface LogonTicketOptions {
  username: string;
  client: string;
  system: string;
  issuedAt?: Date;
  durationHours?: number;
  codepage?: '4103' | '4102';
  certPem: string;
  keyPem: string;
  /** Extra info units, e.g. [{ id: ID_RFC, value: 'X' }]. */
  extraUnits?: InfoUnit[];
}

function readPem(pathOrPem: string, label: string): string {
  const trimmed = pathOrPem.trim();
  if (trimmed.startsWith('-----BEGIN')) return trimmed;
  return readFileSync(pathOrPem, 'utf8');
}

/**
 * Generates a MYSAPSSO2 logon ticket (the cookie value, already URL-encoded).
 *
 * Requires the system PSE private key (DSA) and certificate. The private key
 * must be a DSA key in PEM format; the certificate may be PEM or DER.
 */
export function generateLogonTicket(options: LogonTicketOptions): string {
  const {
    username,
    client,
    system,
    issuedAt = new Date(),
    durationHours = 8,
    codepage = '4103',
    certPem,
    keyPem,
    extraUnits = [],
  } = options;

  const encoding = codepage === '4103' ? 'utf16le' : 'utf16be';

  const units: InfoUnit[] = [
    { id: ID_USER, value: encodeValue(username, encoding) },
    { id: ID_CREATE_CLIENT, value: encodeValue(client, encoding) },
    { id: ID_CREATE_NAME, value: encodeValue(system, encoding) },
    { id: ID_CREATE_TIME, value: encodeValue(issuedAt, encoding) },
    { id: ID_VALID_TIME, value: encodeValue(durationHours, encoding) },
    ...extraUnits,
  ];

  const dataToSign = buildDataToSign(codepage, units);

  // Load cert + key (accept PEM strings or file paths).
  const certPemStr = readPem(certPem, 'cert');
  const keyPemStr = readPem(keyPem, 'key');

  // Extract issuer Name DER + serial from the certificate.
  const cert = new X509Certificate(certPemStr);
  const certDer = cert.raw;
  const issuerDer = extractIssuerDer(certDer);
  const serial = Buffer.from(cert.serialNumber.replace(/:/g, ''), 'hex');

  const cms = buildCmsSignedData(dataToSign, issuerDer, serial, keyPemStr, issuedAt);

  // Ticket = DataToSign + 0xFF + sigLen(2 BE) + CMS
  const ticket = Buffer.concat([
    dataToSign,
    Buffer.from([ID_SIGNATURE]),
    (() => {
      const b = Buffer.alloc(2);
      b.writeUInt16BE(cms.length, 0);
      return b;
    })(),
    cms,
  ]);

  // MYSAPSSO2 = urlEncode(base64(ticket)) with `+/` → `!/`.
  const b64 = ticket.toString('base64').replace(/\+/g, '!').replace(/\//g, '_').replace(/=+$/, '');
  return encodeURIComponent(b64);
}

// ── Decoding ─────────────────────────────────────────────────────────────────

export interface DecodedLogonTicket {
  codepage: string;
  units: InfoUnit[];
  signature: Buffer;
  dataToSign: Buffer;
}

/**
 * Decodes a MYSAPSSO2 cookie value into its info units and signature.
 */
export function decodeLogonTicket(cookie: string): DecodedLogonTicket {
  const urlDecoded = decodeURIComponent(cookie.trim());
  const b64 = urlDecoded.replace(/!/g, '+').replace(/_/g, '/');
  // Re-pad base64.
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = Buffer.from(padded, 'base64');

  let off = 0;
  const preamble = raw[off];
  if (preamble !== 0x02) throw new Error(`Invalid logon ticket preamble: 0x${preamble.toString(16)}`);
  off += 1;
  const codepage = raw.subarray(off, off + 4).toString('ascii');
  off += 4;

  // Read info units until 0xFF marker.
  const dataToSignEnd = findDataToSignEnd(raw, off);
  const dataToSign = raw.subarray(0, dataToSignEnd);
  const units = decodeInfoUnits(raw.subarray(off, dataToSignEnd));
  off = dataToSignEnd;

  if (raw[off] !== ID_SIGNATURE) throw new Error('Missing signature marker 0xFF');
  off += 1;
  const sigLen = raw.readUInt16BE(off);
  off += 2;
  const signature = Buffer.from(raw.subarray(off, off + sigLen));

  return { codepage, units, signature, dataToSign };
}

function findDataToSignEnd(raw: Buffer, from: number): number {
  let off = from;
  while (off < raw.length) {
    const id = raw[off];
    if (id === ID_SIGNATURE) return off;
    const len = raw.readUInt16BE(off + 1);
    off += 3 + len;
  }
  return raw.length;
}

/** Convenience: renders decoded units as human-readable strings. */
export function formatDecodedTicket(ticket: DecodedLogonTicket): Record<string, string> {
  const out: Record<string, string> = {};
  for (const unit of ticket.units) {
    let label = `0x${unit.id.toString(16).padStart(2, '0')}`;
    switch (unit.id) {
      case ID_USER: label = 'user'; break;
      case ID_CREATE_CLIENT: label = 'client'; break;
      case ID_CREATE_NAME: label = 'sid'; break;
      case ID_CREATE_TIME: label = 'create_time'; break;
      case ID_VALID_TIME: label = 'valid_hours'; break;
      case ID_VALID_TIME_MIN: label = 'valid_minutes'; break;
      case ID_LANGUAGE: label = 'language'; break;
      case ID_RECIPIENT_CLIENT: label = 'recipient_client'; break;
      case ID_RECIPIENT_SID: label = 'recipient_sid'; break;
      case ID_AUTHSCHEME: label = 'authscheme'; break;
    }
    if (unit.id === ID_VALID_TIME || unit.id === ID_VALID_TIME_MIN) {
      out[label] = String(unit.value.readUInt32BE(0));
    } else if (ticket.codepage === '4102') {
      // UTF-16BE: swap byte pairs then decode as UTF-16LE.
      const swapped = Buffer.alloc(unit.value.length);
      for (let i = 0; i < unit.value.length; i += 2) {
        swapped[i] = unit.value[i + 1];
        swapped[i + 1] = unit.value[i];
      }
      out[label] = swapped.toString('utf16le').replace(/\0+$/, '');
    } else {
      out[label] = unit.value.toString('utf16le').replace(/\0+$/, '');
    }
  }
  return out;
}
