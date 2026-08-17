'use strict';

const express = require('express');

const { exigirToken } = require('../token');
const { contarPublicadas, listarPrimeiraPagina, listarAposCursor } = require('../banco');

const rotas = express.Router();

const LIMITE_PADRAO = 30;
// Sem teto, um ?limit=99999 faz o servidor montar o acervo inteiro em memoria.
const LIMITE_MAXIMO = 100;

// O cursor e opaco para o cliente: ele so devolve o que recebeu. Por dentro
// sao as duas colunas que ordenam a listagem.
function montarCursor(foto) {
  return Buffer.from(`${foto.criado_em}|${foto.id}`, 'utf8').toString('base64url');
}

// Cursor corrompido, truncado pelo navegador ou inventado a mao volta como
// nulo: a galeria recomeca da primeira pagina. Nunca derruba a requisicao.
function lerCursor(bruto) {
  if (typeof bruto !== 'string' || bruto === '') return null;

  try {
    const texto = Buffer.from(bruto, 'base64url').toString('utf8');
    const separador = texto.indexOf('|');
    if (separador <= 0) return null;

    const criadoEm = texto.slice(0, separador);
    const id = texto.slice(separador + 1);
    if (criadoEm === '' || id === '') return null;

    return { criado_em: criadoEm, id };
  } catch {
    return null;
  }
}

function lerLimite(bruto) {
  const valor = Number.parseInt(bruto, 10);
  if (!Number.isInteger(valor) || valor < 1) return LIMITE_PADRAO;
  return Math.min(valor, LIMITE_MAXIMO);
}

rotas.get('/api/fotos', exigirToken, (req, res) => {
  const limite = lerLimite(req.query.limit);
  const cursor = lerCursor(req.query.cursor);

  const fotos = cursor
    ? listarAposCursor.all({ ...cursor, limite })
    : listarPrimeiraPagina.all({ limite });

  // So ha proxima pagina se esta veio cheia. Se veio incompleta, chegamos ao
  // fim do acervo e o cliente para de pedir.
  const proximoCursor = fotos.length === limite ? montarCursor(fotos[fotos.length - 1]) : null;

  const { total } = contarPublicadas.get();

  res.json({ fotos, proximoCursor, total });
});

module.exports = rotas;
