import https from 'https';
import tls from 'tls';
import dns from 'node:dns/promises';
import { URL } from 'url';
import { enumerateServerCiphers } from './cipherEnumerator.js';

function parseServerProduct(serverHeader = '') {
  const serverText = String(serverHeader || '').trim();
  if (!serverText) {
    return { softwareName: '', softwareVersion: '', softwareType: '' };
  }

  const first = serverText.split(/[\s,;]+/).find(Boolean) || '';
  const [name = '', version = ''] = first.split('/');
  return {
    softwareName: name || serverText,
    softwareVersion: version || '',
    softwareType: 'web_server',
  };
}

export async function runAPIScanner(apiEndpoint) {
  if (!apiEndpoint) return { skipped: true, reason: 'No API endpoint provided' };

  let url;
  try {
    url = new URL(apiEndpoint);
  } catch {
    return {
      skipped: true,
      reason: 'API endpoint is not a valid URL. Provide a full URL such as https://api.example.com',
    };
  }

  const tlsMetadata = await new Promise((resolve) => {
    const socket = tls.connect(
      {
        host: url.hostname,
        port: url.port || 443,
        servername: url.hostname,
        rejectUnauthorized: false
      },
      () => {
        const cipher = socket.getCipher();
        const protocol = socket.getProtocol();
        const certificate = socket.getPeerCertificate();
        const ephemeral = socket.getEphemeralKeyInfo?.() || null;
        const ciphers = [...new Set([cipher?.name, cipher?.standardName].filter(Boolean))];

        resolve({
          tlsVersion: protocol || '',
          cipher: ciphers.join(', '),
          ciphers,
          host: url.hostname,
          port: String(url.port || 443),
          ipAddress: socket.remoteAddress || '',
          keyExchange:
            ephemeral?.name ||
            ephemeral?.type ||
            cipher?.kx ||
            cipher?.standardName ||
            '',
          signature: certificate?.signatureAlgorithm || '',
          issuer: certificate?.issuer?.O || certificate?.issuer?.CN || '',
          commonName: certificate?.subject?.CN || '',
          fingerprint: certificate?.fingerprint256 || certificate?.fingerprint || '',
          certificateAuthority: certificate?.issuer?.O || certificate?.issuer?.CN || '',
        });

        socket.end();
      }
    );

    socket.on('error', () => {
      resolve({
        tlsVersion: '',
        cipher: '',
        ciphers: [],
        host: url.hostname,
        port: String(url.port || 443),
        ipAddress: '',
        keyExchange: '',
        signature: '',
        issuer: '',
        commonName: '',
        fingerprint: '',
        certificateAuthority: '',
      });
    });
  });

  const httpProbe = await new Promise((resolve) => {
    const req = https.get(apiEndpoint, (res) => {
      const headers = res.headers || {};
      resolve({
        statusCode: res.statusCode || 0,
        server: String(headers.server || ''),
        contentType: String(headers['content-type'] || ''),
        poweredBy: String(headers['x-powered-by'] || ''),
      });
      res.resume();
    });

    req.on('error', () => resolve({ statusCode: 0, server: '', contentType: '', poweredBy: '' }));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ statusCode: 0, server: '', contentType: '', poweredBy: '' });
    });
  });

  if (!tlsMetadata.ipAddress) {
    try {
      const lookup = await dns.lookup(url.hostname);
      tlsMetadata.ipAddress = lookup?.address || '';
    } catch {
      tlsMetadata.ipAddress = '';
    }
  }

  const serverProduct = parseServerProduct(httpProbe.server || httpProbe.poweredBy);

  const allCiphers = await enumerateServerCiphers(
    url.hostname,
    tlsMetadata.ciphers || [],
    url.port || 443
  );
  const finalMetadata = {
    ...tlsMetadata,
    ciphers: allCiphers,
    cipher: allCiphers.join(', '),
    softwareName: serverProduct.softwareName,
    softwareVersion: serverProduct.softwareVersion,
    softwareType: serverProduct.softwareType,
    serverHeader: httpProbe.server,
    contentType: httpProbe.contentType,
    poweredBy: httpProbe.poweredBy,
  };

  return {
    raw: JSON.stringify({ ...finalMetadata, statusCode: httpProbe.statusCode }, null, 2),
    ...finalMetadata,
    statusCode: httpProbe.statusCode
  };
}
