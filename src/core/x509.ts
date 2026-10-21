import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { encodeRdnValue, type RdnValue } from './dn';
import {
  canonicalSpkiFromPkcs8,
  decryptEncryptedPkcs8,
  encryptPkcs8,
  encryptedPkcs8Pem,
  exportPkcs8Der,
  exportSpkiDer,
  generateKeyPair,
  pemEncode,
  parsePem,
  spkiPem,
  toArrayBuffer,
} from './keys';

/**
 * PKCS#10 CSR generation with RSASSA-PKCS1-v1_5 / SHA-256 over WebCrypto,
 * plus the self-checks required before results are shown to the user:
 *   1. the CSR signature verifies against its own embedded public key
 *   2. the encrypted key re-imports with the passphrase
 *   3. the re-imported key's SPKI is byte-identical to the exported public key
 */

export interface GenerateResult {
  csrPem: string;
  encryptedKeyPem: string;
  publicKeyPem: string;
  selfCheck: {
    csrSignatureVerified: boolean;
    keyReimportVerified: boolean;
  };
}

/**
 * Build the X.501 Name of the CSR.
 *
 * X.501 requires one SET (= one RDN) per attribute, but pkijs'
 * `RelativeDistinguishedNames.toSchema()` puts every attribute into a single
 * SET. OpenSSL — and therefore the guide's sample output — emits one SET per
 * RDN, so the RDN sequence is assembled here with asn1js' `Set`; the
 * attributes themselves are still encoded by pkijs, which keeps the
 * UTF8String / PrintableString / IA5String choice intact.
 */
function buildSubjectName(rdns: RdnValue[]): pkijs.RelativeDistinguishedNames {
  const attributes = rdns.map(
    (r) =>
      new pkijs.AttributeTypeAndValue({
        type: r.oid,
        value: encodeRdnValue(r.asn1Type, r.value) as never,
      })
  );
  const name = new pkijs.RelativeDistinguishedNames({ typesAndValues: attributes });
  name.toSchema = () =>
    new asn1js.Sequence({
      value: attributes.map((a) => new asn1js.Set({ value: [a.toSchema()] })),
    });
  return name;
}

export function createCsr(rdns: RdnValue[], _keyPair: CryptoKeyPair): pkijs.CertificationRequest {
  // `attributes: []` makes pkijs emit the empty [0] attributes field that
  // OpenSSL writes as well (the field is OPTIONAL in PKCS#10).
  const csr = new pkijs.CertificationRequest({ version: 0, attributes: [] });
  csr.subject = buildSubjectName(rdns);
  return csr;
}

/** Build, sign and PEM-encode the CSR */
export async function buildCsrPem(rdns: RdnValue[], keyPair: CryptoKeyPair): Promise<string> {
  const csr = createCsr(rdns, keyPair);
  await csr.subjectPublicKeyInfo.importKey(keyPair.publicKey);
  await csr.sign(keyPair.privateKey, 'SHA-256');
  const der = new Uint8Array(csr.toSchema(true).toBER(false));
  return pemEncode('CERTIFICATE REQUEST', der);
}

/** Verify a PKCS#10 signature (sha256WithRSAEncryption) using WebCrypto directly */
export async function verifyCsrDer(csrDer: Uint8Array): Promise<boolean> {
  const csr = pkijs.CertificationRequest.fromBER(toArrayBuffer(csrDer));
  if (csr.signatureAlgorithm.algorithmId !== '1.2.840.113549.1.1.11') return false; // sha256WithRSAEncryption
  const spkiDer = new Uint8Array(csr.subjectPublicKeyInfo.toSchema().toBER(false));
  const pubKey = await crypto.subtle.importKey(
    'spki',
    toArrayBuffer(spkiDer),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const tbsDer = csr.tbsView;
  const sig = new Uint8Array(csr.signatureValue.valueBlock.valueHex);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', pubKey, toArrayBuffer(sig), toArrayBuffer(tbsDer));
}

/** Generate all three artifacts (CSR, encrypted key, public key) with self-checks */
export async function generateMaterials(
  rdns: RdnValue[],
  passphrase: string
): Promise<GenerateResult> {
  const keyPair = await generateKeyPair();

  const csrPem = await buildCsrPem(rdns, keyPair);

  const pkcs8 = await exportPkcs8Der(keyPair.privateKey);
  const encDer = await encryptPkcs8(pkcs8, passphrase);
  const encryptedKeyPem = encryptedPkcs8Pem(encDer);

  const spki = await exportSpkiDer(keyPair.publicKey);
  const publicKeyPem = spkiPem(spki);

  /* ---- self-checks (fail loudly, never show unverified output) ---- */
  const csrVerified = await verifyCsrDer(pkiCsrDerFromPem(csrPem));

  let keyReimport = false;
  try {
    const decPem = await decryptEncryptedPkcs8(encDer, passphrase);
    const canonical = await canonicalSpkiFromPkcs8(decPem);
    keyReimport = bytesEqual(canonical, spki);
  } catch {
    keyReimport = false;
  }

  if (!csrVerified || !keyReimport) {
    throw new Error('خودارزیابی ناموفق بود — نتایج نشان داده نمی‌شود. لطفاً دوباره تلاش کنید.');
  }

  return {
    csrPem,
    encryptedKeyPem,
    publicKeyPem,
    selfCheck: { csrSignatureVerified: csrVerified, keyReimportVerified: keyReimport },
  };
}

function pkiCsrDerFromPem(pem: string): Uint8Array {
  return parsePem(pem)[0]!.der;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
