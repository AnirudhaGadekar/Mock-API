import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { SignedXml } from 'xml-crypto';
import { verifySamlXmlSignature } from '../src/lib/saml-signature.js';

function buildSignedAssertion(privateKeyPem: string): string {
  const xml = `<Assertion ID="assertion-1" IssueInstant="${new Date().toISOString()}"><NameID>user@example.com</NameID></Assertion>`;
  const sig = new SignedXml({ privateKey: privateKeyPem });
  sig.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  sig.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#';
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  sig.computeSignature(xml);
  return sig.getSignedXml();
}

describe('SAML signature verification', () => {
  it('accepts correctly signed xml with uploaded public key', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const signedXml = buildSignedAssertion(
      privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
    );
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    const result = verifySamlXmlSignature(signedXml, [publicPem]);
    expect(result.ok).toBe(true);
  });

  it('rejects tampered signed xml', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const signedXml = buildSignedAssertion(
      privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
    );
    const tampered = signedXml.replace('user@example.com', 'attacker@example.com');
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    const result = verifySamlXmlSignature(tampered, [publicPem]);
    expect(result.ok).toBe(false);
  });
});
