import { describe, expect, it } from 'vitest';
import * as forge from 'node-forge';
import { buildPfx, buildPfxBytes, keyMatchesCertificate } from '../src/core/pfx';
import { exportPkcs8Der } from '../src/core/keys';
import { newKeyPair, selfSignedCertDer } from './helpers/selfSigned';

function forgeBuffer(bytes: Uint8Array): forge.util.ByteBuffer {
  return forge.util.createBuffer(bytes.slice().buffer as ArrayBuffer);
}

/** DER encoding of an object identifier (without tag/length) */
function oidBytes(oid: string): Uint8Array {
  const parts = oid.split('.').map(Number);
  const out: number[] = [parts[0]! * 40 + parts[1]!];
  for (const part of parts.slice(2)) {
    const chunk: number[] = [part & 0x7f];
    let rest = part >> 7;
    while (rest > 0) {
      chunk.unshift((rest & 0x7f) | 0x80);
      rest >>= 7;
    }
    out.push(...chunk);
  }
  return new Uint8Array(out);
}

/** true when the DER contains the given object identifier */
function containsOid(der: Uint8Array, oid: string): boolean {
  const needle = oidBytes(oid);
  outer: for (let i = 0; i + needle.length <= der.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (der[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

const OID_PBES2 = '1.2.840.113549.1.5.13';
const OID_PBKDF2 = '1.2.840.113549.1.5.12';
const OID_AES256_CBC = '2.16.840.1.101.3.4.1.42';
const OID_3DES = '1.2.840.113549.1.12.1.3';

describe('modern PFX (PBES2 / AES-256-CBC)', () => {
  it('builds a PFX that node-forge can read back with the export password', async () => {
    const pair = await newKeyPair();
    const pkcs8 = await exportPkcs8Der(pair.privateKey);
    const leaf = await selfSignedCertDer(pair);
    const pfx = await buildPfx({
      certs: { leaf, chain: [] },
      privateKeyPkcs8Der: pkcs8,
      exportPassword: 'export pass 123',
      friendlyName: 'دیجیتال',
    });
    expect(pfx.length).toBeGreaterThan(500);

    const parsed = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(forgeBuffer(pfx)),
      false,
      'export pass 123'
    );
    const certBags = Object.values(parsed.getBags({ bagType: forge.pki.oids.certBag }))[0]!;
    const keyBags = Object.values(
      parsed.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })
    )[0]!;
    expect(certBags).toHaveLength(1);
    expect(keyBags).toHaveLength(1);
    const friendly = Object.values(parsed.getBags({ friendlyName: 'دیجیتال' }))[0]!;
    expect(friendly.length).toBeGreaterThan(0);
  });

  it('refuses to open with a wrong export password', async () => {
    const pair = await newKeyPair();
    const pkcs8 = await exportPkcs8Der(pair.privateKey);
    const leaf = await selfSignedCertDer(pair);
    const pfx = await buildPfx({
      certs: { leaf, chain: [] },
      privateKeyPkcs8Der: pkcs8,
      exportPassword: 'right password',
    });
    expect(() =>
      forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forgeBuffer(pfx)), false, 'wrong password')
    ).toThrow();
  });

  it('the shrouded key bag uses PBES2 with PBKDF2 and AES-256-CBC', async () => {
    const pair = await newKeyPair();
    const pkcs8 = await exportPkcs8Der(pair.privateKey);
    const leaf = await selfSignedCertDer(pair);
    const pfx = buildPfxBytes({
      certs: { leaf, chain: [] },
      privateKeyPkcs8Der: pkcs8,
      exportPassword: 'export pass 123',
    });
    expect(containsOid(pfx, OID_PBES2)).toBe(true);
    expect(containsOid(pfx, OID_PBKDF2)).toBe(true);
    expect(containsOid(pfx, OID_AES256_CBC)).toBe(true);
    expect(containsOid(pfx, OID_3DES)).toBe(false);
  });
});

describe('legacy PFX (3DES) for old Windows importers', () => {
  it('uses pbeWithSHAAnd3-KeyTripleDES-CBC for the shrouded key bag', async () => {
    const pair = await newKeyPair();
    const pkcs8 = await exportPkcs8Der(pair.privateKey);
    const leaf = await selfSignedCertDer(pair);
    const pfx = buildPfxBytes({
      certs: { leaf, chain: [] },
      privateKeyPkcs8Der: pkcs8,
      exportPassword: 'legacy pass 000',
      legacy: true,
    });
    expect(containsOid(pfx, OID_3DES)).toBe(true);
    expect(containsOid(pfx, OID_PBES2)).toBe(false);
  });

  it('is still readable with the export password', async () => {
    const pair = await newKeyPair();
    const pkcs8 = await exportPkcs8Der(pair.privateKey);
    const leaf = await selfSignedCertDer(pair);
    const pfx = buildPfxBytes({
      certs: { leaf, chain: [] },
      privateKeyPkcs8Der: pkcs8,
      exportPassword: 'legacy pass 000',
      legacy: true,
    });
    const parsed = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(forgeBuffer(pfx)),
      false,
      'legacy pass 000'
    );
    const certBags = Object.values(parsed.getBags({ bagType: forge.pki.oids.certBag }))[0]!;
    expect(certBags).toHaveLength(1);
  });
});

describe('keyMatchesCertificate', () => {
  it('accepts a matching key and rejects a mismatched one', async () => {
    const pair = await newKeyPair();
    const certDer = await selfSignedCertDer(pair);
    const pkcs8 = await exportPkcs8Der(pair.privateKey);
    expect(await keyMatchesCertificate(certDer, pkcs8)).toBe(true);

    const other = await newKeyPair();
    const otherPkcs8 = await exportPkcs8Der(other.privateKey);
    expect(await keyMatchesCertificate(certDer, otherPkcs8)).toBe(false);
  });
});
