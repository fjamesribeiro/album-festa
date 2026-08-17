'use strict';

const { rateLimit } = require('express-rate-limit');

const config = require('./config');
const { espacoLivre } = require('./disco');

// Resposta no mesmo formato do upload, senao o cliente nao sabe ler o motivo
// e mostra uma mensagem generica.
function recusa(motivo) {
  return { enviadas: [], falhas: [{ nome: null, motivo }] };
}

// Rajada de envios do mesmo IP. Calibrado para nao barrar a festa: veja o
// comentario em config.js sobre Wi-Fi compartilhado.
const limitadorUploads = rateLimit({
  windowMs: config.janelaRateLimitMin * 60 * 1000,
  limit: config.uploadsPorJanela,

  // Cabecalhos padrao (RateLimit-*) sim, os antigos X-RateLimit-* nao.
  standardHeaders: 'draft-7',
  legacyHeaders: false,

  handler: (req, res) => {
    console.warn('[limite] rate limit atingido', {
      ip: req.ip,
      janela_min: config.janelaRateLimitMin,
      teto: config.uploadsPorJanela,
    });
    res
      .status(429)
      .json(recusa('muita foto ao mesmo tempo agora. Espere um minutinho e tente de novo'));
  },
});

// Espaco em disco conferido ANTES do multer, senao o arquivo ja teria sido
// gravado justamente quando nao ha espaco para ele.
async function verificarDisco(req, res, proximo) {
  const disco = await espacoLivre();

  // Se nao consegui medir, deixo passar: recusar upload por causa de uma
  // leitura que falhou seria pior que o problema que ela evita.
  if (!disco.disponivel) return proximo();

  if (disco.apertado) {
    console.error('[ALERTA] disco abaixo do minimo, upload recusado', {
      livre_gb: Number(disco.livreGb.toFixed(2)),
      minimo_gb: config.discoMinimoGb,
      percentual_usado: Number(disco.percentualUsado.toFixed(1)),
      ip: req.ip,
    });
    return res
      .status(507)
      .json(recusa('o álbum ficou sem espaço. Avise alguém da família, por favor'));
  }

  return proximo();
}

module.exports = { limitadorUploads, verificarDisco };
