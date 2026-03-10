import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';

type VerifyResult = {
  ok: boolean;
  reason?: string;
};

function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  return m?.[1]?.trim() || null;
}

function findNodeByLocalName(node: Node | null, localName: string): Node | null {
  if (!node) return null;
  const anyNode = node as any;
  if (typeof anyNode.localName === 'string' && anyNode.localName.toLowerCase() === localName.toLowerCase()) {
    return node;
  }

  const children = anyNode.childNodes as NodeList | undefined;
  if (!children) return null;
  for (let i = 0; i < children.length; i++) {
    const found = findNodeByLocalName(children.item(i), localName);
    if (found) return found;
  }
  return null;
}

function normalizePemKey(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (
    trimmed.includes('BEGIN CERTIFICATE')
    || trimmed.includes('BEGIN PUBLIC KEY')
    || trimmed.includes('BEGIN RSA PUBLIC KEY')
  ) {
    return trimmed;
  }

  const compact = trimmed.replace(/\s+/g, '');
  if (!compact) return null;

  // Assume base64 DER cert/public key and wrap as certificate first.
  const lines = compact.match(/.{1,64}/g)?.join('\n') ?? compact;
  return `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----`;
}

export function verifySamlXmlSignature(xml: string, keys: string[]): VerifyResult {
  const signatureValue = extractTag(xml, '(?:ds:)?SignatureValue');
  if (!signatureValue) {
    return { ok: false, reason: 'Missing SignatureValue' };
  }

  try {
    Buffer.from(signatureValue.replace(/\s+/g, ''), 'base64');
  } catch {
    return { ok: false, reason: 'SignatureValue is not valid base64' };
  }

  const normalizedKeys = keys.map((k) => normalizePemKey(k)).filter((k): k is string => Boolean(k));
  if (normalizedKeys.length === 0) {
    return { ok: false, reason: 'No valid IdP verification keys configured' };
  }

  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const signatureNode = findNodeByLocalName(doc, 'Signature');
  if (!signatureNode) {
    return { ok: false, reason: 'Missing Signature node' };
  }

  const errorsNode = findNodeByLocalName(doc, 'parsererror') as any;
  if (errorsNode) {
    return { ok: false, reason: 'Malformed XML document' };
  }

  for (const pem of normalizedKeys) {
    try {
      const sig = new SignedXml({
        publicCert: pem,
        getCertFromKeyInfo: () => null, // Never trust certs embedded in incoming XML.
      });
      sig.loadSignature(signatureNode);
      const valid = sig.checkSignature(xml);
      if (valid) {
        return { ok: true };
      }
    } catch {
      // Try next configured key
    }
  }

  return { ok: false, reason: 'Signature verification failed for all configured keys' };
}
