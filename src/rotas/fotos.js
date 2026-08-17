'use strict';

const express = require('express');

const { exigirToken } = require('../token');
const { lerCursor, lerLimite, montarPagina } = require('../paginacao');
const { contarPublicadas, listarPrimeiraPagina, listarAposCursor } = require('../banco');

const rotas = express.Router();

rotas.get('/api/fotos', exigirToken, (req, res) => {
  const limite = lerLimite(req.query.limit);
  const cursor = lerCursor(req.query.cursor);

  const fotos = cursor
    ? listarAposCursor.all({ ...cursor, limite })
    : listarPrimeiraPagina.all({ limite });

  const { total } = contarPublicadas.get();

  res.json({ ...montarPagina(fotos, limite), total });
});

module.exports = rotas;
