import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { toArrayBuffer } from '../../src/core/keys';

/** Self-signed X.509 certificate for a given RSA key pair (test helper only) */
export async function selfSignedCertDer(pair: CryptoKeyPair): Promise<Uint8Array> {
  const cert = new pkijs.Certificate();
  cert.version = 2;
  // @ts-ignore
  cert.serialNumber = new asn1js.Integer({ value: 1 });

  const now = Date.now();
  cert.notBefore = new pkijs.Time({ value: new Date(now - 86_400_000) });
  cert.notAfter = new pkijs.Time({ value: new Date(now + 365 * 86_400_000) });

  const name = new pkijs.RelativeDistinguishedNames({
    typesAndValues: [
      new pkijs.AttributeTypeAndValue({ type: '2.5.4.6', value: new asn1js.PrintableString({ value: 'IR' }) as any }),
      new pkijs.AttributeTypeAndValue({ type: '2.5.4.3', value: new asn1js.Utf8String({ value: 'Test Root' }) as any }),
    ],
  });
  cert.issuer = name;
  cert.subject = name;

  await cert.subjectPublicKeyInfo.importKey(pair.publicKey);
  await cert.sign(pair.privateKey, 'SHA-256');

  const der = new Uint8Array(cert.toSchema(true).toBER(false));
  void toArrayBuffer; // keep import used
  return der;
}

export function newKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  ) as Promise<CryptoKeyPair>;
}
