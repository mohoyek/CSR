import * as forgeNamespace from 'node-forge';
import * as pkijs from 'pkijs';
import {
  canonicalSpkiFromPkcs8,
  decryptEncryptedPkcs8,
  parsePem,
  pkcs1ToPkcs8,
  toArrayBuffer,
} from './keys';

/**
 * node-forge is a CommonJS package. Depending on the bundler/runner the
 * ESM namespace either exposes the API directly (Vite) or only through
 * `default` (plain Node ESM) — this normalises both cases.
 */
const forge = ((forgeNamespace as unknown as { default?: typeof forgeNamespace }).default ??
  forgeNamespace) as typeof forgeNamespace;

/**
 * PKCS#12 / PFX builder for the «ساخت PFX» tab.
 *
 *  - modern (default): PBES2 / AES-256-CBC key bag, PKCS#12 MAC (SHA-1)
 *  - legacy (opt-in):  pkcs12PbeWithSHAAnd3-KeyTripleDES-CBC (3DES) for old
 *                      Windows versions and importers
 *
 * node-forge builds the container; WebCrypto is used for the public-key
 * comparison (certificate <-> private key). The private key is introduced
 * only as the passphrase-protected mykey.key (+ its passphrase) and never
 * leaves the browser.
 */

export interface CertificatesDers {
  /** DER of the end-entity certificate */
  leaf: Uint8Array;
  /** DER list of optional CA chain certificates */
  chain: Uint8Array[];
}

export interface BuildPfxInput {
  certs: CertificatesDers;
  /** unencrypted PKCS#8 DER of the private key */
  privateKeyPkcs8Der: Uint8Array;
  exportPassword: string;
  legacy?: boolean;
  friendlyName?: string;
}

/** Modern parameters — OpenSSL 3 compatible */
export const PFX_MODERN_PARAMS = {
  algorithm: 'aes256',
  prfAlgorithm: 'sha256',
  count: 100_000,
  saltSize: 16,
} as const;

/** Legacy parameters — maximum compatibility with old Windows importers */
export const PFX_LEGACY_PARAMS = {
  algorithm: '3des',
  count: 2_048,
  saltSize: 8,
} as const;

/** Parse certificate text/bytes (PEM or DER) into DER */
export function certificateDerFromInput(data: ArrayBuffer | Uint8Array, text?: string): Uint8Array {
  if (typeof text === 'string' && text.includes('-----BEGIN CERTIFICATE-----')) {
    const parts = parsePem(text).filter((p) => p.label === 'CERTIFICATE' || p.label === 'X509 CERTIFICATE');
    if (parts.length === 0) throw new Error('فایل گواهی شامل گواهی معتبری نیست');
    return parts[0]!.der;
  }
  const der = data instanceof Uint8Array ? data : new Uint8Array(data);
  return der;
}

/** Read the leaf certificate; throws on invalid DER */
export function parseCertificateDer(der: Uint8Array): pkijs.Certificate {
  return pkijs.Certificate.fromBER(toArrayBuffer(der));
}

/** True when the public key of the certificate matches the private key */
export async function keyMatchesCertificate(
  certDer: Uint8Array,
  privateKeyPkcs8Der: Uint8Array
): Promise<boolean> {
  const cert = parseCertificateDer(certDer);
  const certSpkiRaw = new Uint8Array(cert.subjectPublicKeyInfo.toSchema().toBER(false));
  const pubKey = await crypto.subtle.importKey(
    'spki',
    toArrayBuffer(certSpkiRaw),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    true,
    ['verify']
  );
  const canonical = new Uint8Array(await crypto.subtle.exportKey('spki', pubKey));
  const privSpki = await canonicalSpkiFromPkcs8(privateKeyPkcs8Der);
  return bytesEqual(canonical, privSpki);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* node-forge adapters                                                  */
/* ------------------------------------------------------------------ */

function forgeBuffer(bytes: Uint8Array): forgeNamespace.util.ByteBuffer {
  return forge.util.createBuffer(bytes.slice().buffer as ArrayBuffer);
}

function forgeBytesToUint8(bytes: string): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes.charCodeAt(i) & 0xff;
  return out;
}

/** Build the PKCS#12 container with node-forge */
export function buildPfxBytes(input: BuildPfxInput): Uint8Array {
  type ForgeP12Options = NonNullable<Parameters<typeof forge.pkcs12.toPkcs12Asn1>[3]>;
  /**
   * node-forge forwards the whole options object to `pki.encryptPrivateKeyInfo`,
   * which supports `prfAlgorithm`; the bundled @types/node-forge declaration
   * for toPkcs12Asn1 does not mention it.
   */
  type ExtendedOptions = ForgeP12Options & { prfAlgorithm?: string };

  const options: ExtendedOptions = input.legacy
    ? {
        algorithm: PFX_LEGACY_PARAMS.algorithm,
        count: PFX_LEGACY_PARAMS.count,
        saltSize: PFX_LEGACY_PARAMS.saltSize,
        friendlyName: input.friendlyName ?? 'keystore',
        generateLocalKeyId: true,
      }
    : {
        algorithm: PFX_MODERN_PARAMS.algorithm,
        prfAlgorithm: PFX_MODERN_PARAMS.prfAlgorithm,
        count: PFX_MODERN_PARAMS.count,
        saltSize: PFX_MODERN_PARAMS.saltSize,
        friendlyName: input.friendlyName ?? 'keystore',
        generateLocalKeyId: true,
      };

  const privateKey = forge.pki.privateKeyFromAsn1(
    forge.asn1.fromDer(forgeBuffer(input.privateKeyPkcs8Der))
  );

  const certs = [input.certs.leaf, ...input.certs.chain].map((der) =>
    forge.pki.certificateFromAsn1(forge.asn1.fromDer(forgeBuffer(der)))
  );

  const p12 = forge.pkcs12.toPkcs12Asn1(privateKey, certs, input.exportPassword, options);

  return forgeBytesToUint8(forge.asn1.toDer(p12).getBytes());
}

/** Full PFX build with the legacy toggle */
export async function buildPfx(input: BuildPfxInput): Promise<Uint8Array> {
  return buildPfxBytes(input);
}

/**
 * Load a private key file (generated by the app: encrypted PKCS#8 PEM with
 * passphrase; or traditional PKCS#1 / plain PKCS#8 PEM for key files created
 * elsewhere) into unencrypted PKCS#8 DER. Errors carry Persian messages.
 */
export interface LoadKeyResult {
  pkcs8: Uint8Array;
  encryptedKeyPem: string;
}

export async function loadPrivateKeyFile(
  keyPem: string,
  passphrase: string
): Promise<LoadKeyResult> {
  const parts = parsePem(keyPem);
  const part = parts.find((p) => p.label === 'ENCRYPTED PRIVATE KEY');
  if (part) {
    let der: Uint8Array;
    try {
      der = await decryptEncryptedPkcs8(part.der, passphrase);
    } catch {
      throw new Error('رمز کلید خصوصی نادرست است');
    }
    return { pkcs8: der, encryptedKeyPem: keyPem };
  }
  // Plain PKCS#8 or PKCS#1 without passphrase
  const plain = parts.find((p) => p.label === 'PRIVATE KEY' || p.label === 'RSA PRIVATE KEY');
  if (!plain) throw new Error('فایل کلید خصوصی شناسایی نشد — فایل mykey.key را وارد کنید');
  const pkcs8 = plain.label === 'RSA PRIVATE KEY' ? pkcs1ToPkcs8(plain.der) : plain.der;
  return { pkcs8, encryptedKeyPem: keyPem };
}

/** Split a PEM text into its certificate blocks (leaf first) */
export function certificateChainFromPem(text: string): Uint8Array[] {
  return parsePem(text)
    .filter((p) => p.label === 'CERTIFICATE' || p.label === 'X509 CERTIFICATE')
    .map((p) => p.der);
}
