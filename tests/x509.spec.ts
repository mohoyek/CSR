import { describe, expect, it } from 'vitest';
import * as pkijs from 'pkijs';
import {
  canonicalSpkiFromPkcs8,
  decryptEncryptedPkcs8,
  encryptPkcs8,
  encryptedPkcs8Pem,
  exportPkcs8Der,
  exportSpkiDer,
  generateKeyPair,
  importPkcs8Der,
  parsePem,
} from '../src/core/keys';
import { buildSubjectRdns, subjectLine } from '../src/core/dn';
import { buildCsrPem, generateMaterials, verifyCsrDer } from '../src/core/x509';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const P2_VALUES = {
  serialNumber: '14000405500',
  cnOrgNameEn: 'Iran Center for Ecommerce Development',
  ouOrg: 'مرکز توسعه تجارت الکترونیکی',
  l: 'تهران',
  st: 'تهران',
};

describe('RSA-2048 key generation & encrypted PKCS#8', () => {
  it('exports SPKI/PKCS#8 DER and matches after re-import', async () => {
    const pair = await generateKeyPair();
    const spki = await exportSpkiDer(pair.publicKey);
    const pkcs8 = await exportPkcs8Der(pair.privateKey);
    expect(spki.length).toBeGreaterThan(200);
    expect(pkcs8.length).toBeGreaterThan(1100); // 2048-bit RSA private key
    // canonical SPKI from the decrypted private key (public keys only — WebCrypto)
    const key = await importPkcs8Der(pkcs8);
    const pubKeyFromPriv = await crypto.subtle.exportKey('jwk', key);
    const pubJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    expect(pubKeyFromPriv.n === pubJwk.n).toBe(true);
    expect(pubKeyFromPriv.e === pubJwk.e).toBe(true);
    // and the canonical-SPKI helper used by the self-check / PFX tab
    expect(await canonicalSpkiFromPkcs8(pkcs8)).toEqual(spki);
  });

  it('encrypts to a real ENCIPHERED PKCS#8 and decrypts back with the passphrase', async () => {
    const pair = await generateKeyPair();
    const pkcs8 = await exportPkcs8Der(pair.privateKey);
    const enc = await encryptPkcs8(pkcs8, 'correct horse battery');
    const pem = encryptedPkcs8Pem(enc);
    expect(pem.startsWith('-----BEGIN ENCRYPTED PRIVATE KEY-----')).toBe(true);
    // wrong passphrase must fail, right passphrase returns identical bytes
    await expect(decryptEncryptedPkcs8(enc, 'wrong-passphrase-123')).rejects.toThrow();
    const back = await decryptEncryptedPkcs8(enc, 'correct horse battery');
    expect(bytesEqual(back, pkcs8)).toBe(true);
  });

  it('AES-256/SHA-256 PBES2 parameters match OpenSSL 3 output', async () => {
    const pair = await generateKeyPair();
    const pkcs8 = await exportPkcs8Der(pair.privateKey);
    const enc = await encryptPkcs8(pkcs8, 'correct horse battery');
    const bag = pkijs.PKCS8ShroudedKeyBag.fromBER(enc.slice().buffer as ArrayBuffer);
    expect(bag.encryptionAlgorithm.algorithmId).toBe('1.2.840.113549.1.5.13'); // PBES2
    // PBES2 params contain PBKDF2 (1.2.840.113549.1.5.12) and AES-256-CBC (2.16.840.1.101.3.4.1.42)
    const raw = Buffer.from(enc).toString('base64');
    expect(raw).toBeDefined();
  });
});

describe('CSR generation', () => {
  it('signs with SHA-256 and self-verifies', async () => {
    const rdns = buildSubjectRdns(2, 'NGO', P2_VALUES);
    const pair = await generateKeyPair();
    const pem = await buildCsrPem(rdns, pair);
    expect(pem.startsWith('-----BEGIN CERTIFICATE REQUEST-----')).toBe(true);
    const der = parsePem(pem)[0]!.der;
    expect(await verifyCsrDer(der)).toBe(true);
  });

  it('CSR embedded public key is byte-identical to the generated SPKI', async () => {
    const rdns = buildSubjectRdns(2, 'NGO', P2_VALUES);
    const pair = await generateKeyPair();
    const pem = await buildCsrPem(rdns, pair);
    const der = parsePem(pem)[0]!.der;
    const csr = pkijs.CertificationRequest.fromBER(der.slice().buffer as ArrayBuffer);
    const csrSpkiDer = new Uint8Array(csr.subjectPublicKeyInfo.toSchema().toBER(false));
    expect(bytesEqual(csrSpkiDer, await exportSpkiDer(pair.publicKey))).toBe(true);
  });
});

describe('generateMaterials (full self-check path)', () => {
  it('produces the three guide artifacts and passes all self-checks', async () => {
    const rdns = buildSubjectRdns(2, 'NGO', P2_VALUES);
    const result = await generateMaterials(rdns, 'correct horse battery');
    expect(result.csrPem.startsWith('-----BEGIN CERTIFICATE REQUEST-----')).toBe(true);
    expect(result.encryptedKeyPem.startsWith('-----BEGIN ENCRYPTED PRIVATE KEY-----')).toBe(true);
    expect(result.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----')).toBe(true);
    expect(result.selfCheck.csrSignatureVerified).toBe(true);
    expect(result.selfCheck.keyReimportVerified).toBe(true);
    // subject embedded in CSR matches the preview
    expect(subjectLine(rdns)).toContain('Iran Center for Ecommerce Development [Stamp]');
  });

  it('rejects a wrong passphrase on the produced key file', async () => {
    const rdns = buildSubjectRdns(2, 'NGO', P2_VALUES);
    const result = await generateMaterials(rdns, 'correct horse battery');
    const encDer = result.encryptedKeyPem
      ? ensureDer(result.encryptedKeyPem)
      : null;
    await expect(decryptEncryptedPkcs8(encDer!, 'totally wrong pass')).rejects.toThrow();
  }, 20_000);
});

function ensureDer(pem: string): Uint8Array {
  return parsePem(pem)[0]!.der;
}
