'use strict';

// Gera o QR code da mesa. Ferramenta de bancada: o pacote qrcode e
// devDependency e nao entra na imagem de producao (`npm ci --omit=dev`).
//
// Por que gerar aqui e nao num site de QR code: a URL contem o ALBUM_TOKEN,
// que e a senha do album. Colar isso num servico de terceiro entrega o acesso.
//
//   npm run qr
//   npm run qr -- https://outro.endereco/?k=TOKEN

const fs = require('node:fs');
const path = require('node:path');
const QRCode = require('qrcode');

const config = require('../src/config');

const ENDERECO_PADRAO = process.env.ENDERECO_PUBLICO ?? 'https://srv1325413.hstgr.cloud';
const url = process.argv[2] ?? `${ENDERECO_PADRAO}/?k=${config.albumToken}`;

const destino = path.join(__dirname, '..', 'qr');
fs.mkdirSync(destino, { recursive: true });

(async () => {
  // SVG para imprimir: vetorial, nao borra em nenhum tamanho de cartaz.
  await QRCode.toFile(path.join(destino, 'album.svg'), url, {
    type: 'svg',
    // Correcao alta: o QR continua legivel mesmo sujo, amassado ou com um
    // pedaco coberto — e ele vai ficar numa mesa de festa a noite inteira.
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 1000,
  });

  // PNG para mandar no WhatsApp de quem for imprimir.
  await QRCode.toFile(path.join(destino, 'album.png'), url, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 1000,
  });

  console.log('QR code gerado em qr/album.svg e qr/album.png');
  console.log('Aponta para: ' + url);
  console.log('');
  console.log('Confira no terminal antes de imprimir:');
  console.log(await QRCode.toString(url, { type: 'terminal', small: true }));
})();
