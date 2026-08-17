'use strict';

const fsp = require('node:fs/promises');
const express = require('express');

const { VARIANTES, caminhoDerivada } = require('../imagem');

const rotas = express.Router();

// Os nomes em disco sao sempre UUID v4 gerados por nos. Exigir o formato
// exato fecha qualquer tentativa de path traversal no parametro.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function primeiroQueExiste(caminhos) {
  for (const caminho of caminhos) {
    try {
      await fsp.access(caminho);
      return caminho;
    } catch {
      // segue para o proximo
    }
  }
  return null;
}

rotas.get('/media/:variante/:id', async (req, res) => {
  const { variante, id } = req.params;

  if (!VARIANTES.includes(variante) || !UUID.test(id)) {
    return res.status(400).json({ erro: 'endereço de foto inválido' });
  }

  // thumb e view tem extensao fixa. O original pode ser JPEG ou PNG e o schema
  // do banco nao guarda extensao, entao testamos as duas.
  const candidatos =
    variante === 'thumb'
      ? [caminhoDerivada('thumb', id, 'webp')]
      : variante === 'view'
        ? [caminhoDerivada('view', id, 'jpg')]
        : [caminhoDerivada('orig', id, 'jpg'), caminhoDerivada('orig', id, 'png')];

  const caminho = await primeiroQueExiste(candidatos);
  if (!caminho) {
    return res.status(404).json({ erro: 'foto não encontrada' });
  }

  return res.sendFile(caminho, (erro) => {
    if (erro && !res.headersSent) {
      console.error('[midia] falha ao enviar arquivo', { caminho, erro: erro.message });
      res.status(500).end();
    }
  });
});

module.exports = rotas;
