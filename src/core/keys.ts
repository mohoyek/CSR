import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';

/**
 * Key generation, PEM/DER helpers and encrypted PKCS#8 (PKCS#8 EncryptedPrivateKeyInfo).
 *
 * - key generation, signing and ALL signature verification: WebCrypto
 * - PKCS#8 encryption/decryption and PKCS#12: node-forge
 *
 * Everything runs in the browser (globalThis.crypto in Node 24+ for tests).
 * The private key material only ever lives in memory.
 */

export const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: 'RSASSA-PKCS1-v1_5',
  modulusLength: 2048,
  publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
  hash: 'SHA-256',
};

const subtle = crypto.subtle;

export async function generateKeyPair(): Promise<CryptoKeyPair> {
  const pair = (await subtle.generateKey(RSA_PARAMS, true, ['sign', 'verify'])) as CryptoKeyPair;
  return pair;
}

export async function exportSpkiDer(publicKey: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await subtle.exportKey('spki', publicKey));
}

export async function exportPkcs8Der(privateKey: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await subtle.exportKey('pkcs8', privateKey));
}

/** Re-imported PKCS#8 must stay extractable: the self-check and the PFX
 *  builder re-export its SPKI for public-key matching. */
export async function importPkcs8Der(pkcs8: Uint8Array): Promise<CryptoKey> {
  return subtle.importKey(
    'pkcs8',
    toArrayBuffer(pkcs8),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    true,
    ['sign']
  );
}

/* ------------------------------------------------------------------ */
/* PEM helpers                                                        */
/* ------------------------------------------------------------------ */

export function toBase64(der: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < der.length; i += chunk) {
    bin += String.fromCharCode(...der.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function pemEncode(label: string, der: Uint8Array): string {
  const b64 = toBase64(der);
  const lines = b64.match(/.{1,64}/g) ?? [];
  return [`-----BEGIN ${label}-----`, ...lines, `-----END ${label}-----`, ''].join('\n');
}

interface PemPart {
  label: string;
  der: Uint8Array;
}

/** Parse a PEM text into (possibly multiple) labeled DER blocks; no network, no fs */
export function parsePem(text: string): PemPart[] {
  const parts: PemPart[] = [];
  const re = /-----BEGIN ([A-Z0-9 ]+)-----([A-Za-z0-9+/=\s]+)-----END \1-----/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const b64 = m[2]!.replace(/\s+/g, '');
    const bin = atob(b64);
    const der = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
    parts.push({ label: m[1]!, der });
  }
  return parts;
}

/* ------------------------------------------------------------------ */
/* DER <-> ArrayBuffer                                                */
/* ------------------------------------------------------------------ */

export function toArrayBuffer(der: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(der.byteLength);
  new Uint8Array(ab).set(der);
  return ab;
}

/* ------------------------------------------------------------------ */
/* Encrypted PKCS#8 ("BEGIN ENCRYPTED PRIVATE KEY")                   */
/* Same shape as OpenSSL 3's default output:                         */
/*   PBES2 / PBKDF2-HMAC-SHA256 / AES-256-CBC                         */
/*                                                                    */
/* Implemented with pkijs on top of the native WebCrypto PBKDF2 +     */
/* AES-CBC (random 64-byte salt, random 16-byte IV). node-forge's    */
/* PBKDF2 is pure JavaScript and ~25x slower — see README, section   */
/* «انحراف از کتابخانه‌های پیشنهادی».                                 */
/* ------------------------------------------------------------------ */

/** Encryption parameters — `openssl pkcs8 -topk8 -v2 aes-256-cbc` compatible */
export const PKCS8_ENCRYPTION = {
  algorithm: 'AES-CBC',
  keyLength: 256,
  hmacHashAlgorithm: 'SHA-256',
  /** OWASP 2023 recommendation for PBKDF2-HMAC-SHA256 */
  iterationCount: 310_000,
} as const;

export function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Encrypt an unencrypted PKCS#8 PrivateKeyInfo DER into an EncryptedPrivateKeyInfo DER */
export async function encryptPkcs8(
  pkcs8Der: Uint8Array,
  passphrase: string
): Promise<Uint8Array> {
  const keyInfo = pkijs.PrivateKeyInfo.fromBER(toArrayBuffer(pkcs8Der));
  const bag = new pkijs.PKCS8ShroudedKeyBag({ parsedValue: keyInfo });
  // pkijs generates its own random IV/salt; a random IV is passed as well so
  // the call is type-correct and stays correct if a future version honours it.
  const iv = crypto.getRandomValues(new Uint8Array(16));
  await bag.makeInternalValues({
    password: toArrayBuffer(utf8Bytes(passphrase)),
    contentEncryptionAlgorithm: {
      name: PKCS8_ENCRYPTION.algorithm,
      length: PKCS8_ENCRYPTION.keyLength,
      iv: toArrayBuffer(iv),
    },
    hmacHashAlgorithm: PKCS8_ENCRYPTION.hmacHashAlgorithm,
    iterationCount: PKCS8_ENCRYPTION.iterationCount,
  });
  return new Uint8Array(bag.toSchema().toBER(false));
}

/**
 * Decrypt an EncryptedPrivateKeyInfo DER back into PKCS#8 PrivateKeyInfo DER.
 *
 * Throws `WrongPassphraseError` when the passphrase is wrong: PBES2 has no
 * integrity check, so a wrong passphrase only shows up as an unparsable
 * plaintext — which is exactly what is detected here.
 */
export async function decryptEncryptedPkcs8(
  encDer: Uint8Array,
  passphrase: string
): Promise<Uint8Array> {
  try {
    const bag = pkijs.PKCS8ShroudedKeyBag.fromBER(toArrayBuffer(encDer));
    const encData = new pkijs.EncryptedData({
      encryptedContentInfo: new pkijs.EncryptedContentInfo({
        contentEncryptionAlgorithm: bag.encryptionAlgorithm,
        encryptedContent: bag.encryptedData,
      }),
    });
    const pkcs8Der = await encData.decrypt({ password: toArrayBuffer(utf8Bytes(passphrase)) });
    // re-validate: a wrong passphrase yields bytes that are not a PrivateKeyInfo
    pkijs.PrivateKeyInfo.fromBER(pkcs8Der);
    return new Uint8Array(pkcs8Der);
  } catch {
    throw new WrongPassphraseError();
  }
}

/** Raised when a passphrase does not decrypt a private key */
export class WrongPassphraseError extends Error {
  constructor() {
    super('رمز عبور کلید خصوصی نادرست است');
    this.name = 'WrongPassphraseError';
  }
}

/** Standard encrypted PKCS#8 PEM as produced by OpenSSL 3 */
export function encryptedPkcs8Pem(encDer: Uint8Array): string {
  return pemEncode('ENCRYPTED PRIVATE KEY', encDer);
}

/** Public key PEM ("BEGIN PUBLIC KEY", SPKI DER) */
export function spkiPem(spkiDer: Uint8Array): string {
  return pemEncode('PUBLIC KEY', spkiDer);
}

/**
 * کلید خصوصی بدون رمز ("BEGIN PRIVATE KEY") — همان خروجی
 * `openssl req -new -nodes -keyout mykey.key` در راهنما.
 */
export function privateKeyPem(pkcs8Der: Uint8Array): string {
  return pemEncode('PRIVATE KEY', pkcs8Der);
}

/* ------------------------------------------------------------------ */
/* PKCS#1 (traditional) fallback for the PFX tab                      */
/* ------------------------------------------------------------------ */

/** Convert a PKCS#1 RSAPrivateKey DER into an unencrypted PKCS#8 PrivateKeyInfo DER */
export function pkcs1ToPkcs8(pkcs1Der: Uint8Array): Uint8Array {
  const keyInfo = new pkijs.PrivateKeyInfo({
    version: 0,
    privateKeyAlgorithm: new pkijs.AlgorithmIdentifier({
      algorithmId: '1.2.840.113549.1.1.1',
      algorithmParams: new asn1js.Null(),
    }),
    privateKey: new asn1js.OctetString({ valueHex: pkcs1Der }) as any,
  });
  return new Uint8Array(keyInfo.toSchema().toBER(false));
}

/* ------------------------------------------------------------------
 * Public-key equality (match certificate <-> private key)
 * ------------------------------------------------------------------ */

/** Canonical SPKI DER of the public key belonging to a PKCS#8 private key.
 *  WebCrypto cannot export a private key in SPKI format directly, so:
 *  export private JWK -> project to public JWK (kty,n,e only) -> import -> SPKI. */
export async function canonicalSpkiFromPkcs8(pkcs8Der: Uint8Array): Promise<Uint8Array> {
  const priv = await subtle.importKey(
    'pkcs8',
    toArrayBuffer(pkcs8Der),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    true,
    ['sign']
  );
  const privJwk = (await subtle.exportKey('jwk', priv)) as JsonWebKey;
  const pubJwk: JsonWebKey = { kty: privJwk.kty, n: privJwk.n, e: privJwk.e };
  const pub = await subtle.importKey(
    'jwk',
    pubJwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    true,
    ['verify']
  );
  return exportSpkiDer(pub);
}
