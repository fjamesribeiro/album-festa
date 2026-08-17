'use strict';

const crypto = require('node:crypto');

const config = require('./config');

const TOKEN_ESPERADO = Buffer.from(config.albumToken, 'utf8');

// Resposta unica para token ausente, token errado e rota inexistente. Se as
// tres fossem diferentes, daria para descobrir por tentativa que existe um
// album aqui e que o token so estava errado.
const NAO_ENCONTRADO = { erro: 'não encontrei essa página' };

function tokenConfere(recebido) {
  if (typeof recebido !== 'string' || recebido === '') return false;

  const informado = Buffer.from(recebido, 'utf8');

  // timingSafeEqual exige o mesmo comprimento. O comprimento do token nao e
  // segredo, entao comparar antes nao entrega nada.
  if (informado.length !== TOKEN_ESPERADO.length) return false;

  return crypto.timingSafeEqual(informado, TOKEN_ESPERADO);
}

// Protege a pagina do convidado e a API. As derivadas em /media ficam de fora
// por decisao do James: o nome e UUID v4, impossivel de adivinhar ou listar,
// entao sem token continua nao dando para descobrir que fotos existem — e o
// link de uma foto solta continua abrindo quando alguem compartilha.
function exigirToken(req, res, proximo) {
  if (tokenConfere(req.query?.k)) return proximo();

  console.warn('[token] acesso recusado', {
    caminho: req.path,
    ip: req.ip,
    tinha_k: req.query?.k !== undefined,
  });

  return res.status(404).json(NAO_ENCONTRADO);
}

module.exports = { exigirToken, NAO_ENCONTRADO };
