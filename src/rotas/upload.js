'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const multer = require('multer');

const config = require('../config');
const { inserirFoto, contarPublicadas } = require('../banco');
const { detectarFormato, gerarDerivadas, apagarSilencioso } = require('../imagem');

const rotas = express.Router();

// Disco, nao memoria: 10 arquivos de 12 MB dariam 120 MB de RAM por requisicao
// e a VPS e pequena. O sharp lendo do arquivo tambem gasta menos memoria.
const armazenamento = multer.diskStorage({
  destination: (req, arquivo, callback) => callback(null, config.dirTemporario),
  filename: (req, arquivo, callback) => callback(null, `${crypto.randomUUID()}.bin`),
});

const receber = multer({
  storage: armazenamento,
  limits: {
    fileSize: config.maxArquivoBytes,
    files: config.maxArquivosPorRequisicao,
    fields: 10,
  },
}).array('fotos', config.maxArquivosPorRequisicao);

// Mensagens de erro do multer em linguagem humana. O convidado nunca deve ver
// "LIMIT_FILE_SIZE".
function mensagemDoMulter(erro) {
  switch (erro.code) {
    case 'LIMIT_FILE_SIZE':
      return `essa foto passa de ${config.maxArquivoMb} MB, tente enviar de novo`;
    case 'LIMIT_FILE_COUNT':
      return `dá para enviar no máximo ${config.maxArquivosPorRequisicao} fotos de cada vez`;
    case 'LIMIT_UNEXPECTED_FILE':
      return 'não reconheci esse envio, tente de novo';
    default:
      return 'não consegui receber essa foto, tente de novo';
  }
}

function receberComTratamento(req, res, proximo) {
  receber(req, res, (erro) => {
    if (!erro) return proximo();

    console.error('[upload] multer recusou o envio', {
      codigo: erro.code,
      mensagem: erro.message,
      ip: req.ip,
    });

    // Multer aborta a requisicao no meio: limpa o que ja tinha caido no disco.
    for (const arquivo of req.files ?? []) {
      apagarSilencioso(arquivo.path);
    }

    const status = erro instanceof multer.MulterError ? 413 : 400;
    return res.status(status).json({
      enviadas: [],
      falhas: [{ nome: null, motivo: mensagemDoMulter(erro) }],
    });
  });
}

// Data de captura lida do EXIF pelo cliente. Chega como hora local do
// aparelho, sem fuso. Nunca confiar: valida formato e faixa antes de gravar.
const FORMATO_DATA = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

function validarTiradaEm(bruto) {
  if (typeof bruto !== 'string') return null;

  const partes = FORMATO_DATA.exec(bruto.trim());
  if (!partes) return null;

  const [, ano, mes, dia, hora, minuto, segundo] = partes.map(Number);

  // Camera sem relogio ajustado grava 0000:00:00. Data no futuro ou anterior
  // ao ano 2000 tambem e relogio errado, nao informacao util.
  const agora = new Date();
  const quando = new Date(ano, mes - 1, dia, hora, minuto, segundo);
  if (Number.isNaN(quando.getTime())) return null;
  if (quando.getFullYear() !== ano || quando.getMonth() !== mes - 1 || quando.getDate() !== dia) return null;
  if (ano < 2000) return null;
  // Um dia de folga cobre celular com fuso adiantado em relacao ao servidor.
  if (quando.getTime() > agora.getTime() + 24 * 60 * 60 * 1000) return null;

  return bruto.trim();
}

rotas.post('/api/upload', receberComTratamento, async (req, res) => {
  const arquivos = req.files ?? [];

  if (arquivos.length === 0) {
    return res.status(400).json({
      enviadas: [],
      falhas: [{ nome: null, motivo: 'nenhuma foto chegou no envio' }],
    });
  }

  // Nome do convidado e opcional e pode vir vazio.
  const autorBruto = typeof req.body?.autor === 'string' ? req.body.autor.trim() : '';
  const autor = autorBruto === '' ? null : autorBruto.slice(0, 80);

  // Uma data por arquivo, na mesma ordem em que os arquivos chegaram: o campo
  // tirada_em pode se repetir no multipart. O cliente manda um arquivo por
  // requisicao, mas a rota aceita ate 10 e cada um tem a sua propria data.
  // Sem data valida a foto entra assim mesmo — captura de tela e imagem
  // baixada nao tem EXIF, e isso nao e motivo para recusar o envio.
  const datasBrutas = req.body?.tirada_em;
  const datas = (Array.isArray(datasBrutas) ? datasBrutas : [datasBrutas]).map(validarTiradaEm);

  const enviadas = [];
  const falhas = [];

  for (let indice = 0; indice < arquivos.length; indice += 1) {
    const arquivo = arquivos[indice];
    const tiradaEm = datas[indice] ?? null;
    const nomeOriginal = arquivo.originalname || 'foto';
    const inicio = process.hrtime.bigint();
    const id = crypto.randomUUID();

    try {
      // Magic bytes, nunca a extensao.
      const formato = await detectarFormato(arquivo.path);
      if (!formato) {
        await apagarSilencioso(arquivo.path);
        console.warn('[upload] arquivo recusado por formato', { nome: nomeOriginal, ip: req.ip });
        falhas.push({ nome: nomeOriginal, motivo: 'esse arquivo não é uma foto JPEG ou PNG' });
        continue;
      }

      const derivada = await gerarDerivadas(arquivo.path, id, formato, tiradaEm);

      // Banco por ultimo: nunca deve existir linha sem arquivo em disco.
      inserirFoto.run({
        id,
        autor,
        bytes: derivada.bytes,
        largura: derivada.largura,
        altura: derivada.altura,
        criado_em: new Date().toISOString(),
        tirada_em: tiradaEm,
        ip: req.ip ?? null,
      });

      const duracaoMs = Number((process.hrtime.bigint() - inicio) / 1000000n);
      console.log('[upload] foto publicada', {
        id,
        autor,
        bytes: derivada.bytes,
        largura: derivada.largura,
        altura: derivada.altura,
        tirada_em: tiradaEm,
        ip: req.ip,
        duracao_ms: duracaoMs,
      });

      enviadas.push({ id, largura: derivada.largura, altura: derivada.altura });
    } catch (erro) {
      await apagarSilencioso(arquivo.path);
      console.error('[upload] falha ao processar foto', {
        id,
        nome: nomeOriginal,
        ip: req.ip,
        erro: erro.message,
        stack: erro.stack,
      });
      falhas.push({ nome: nomeOriginal, motivo: 'não consegui processar essa foto, tente de novo' });
    }
  }

  const { total } = contarPublicadas.get();
  return res.json({ enviadas, falhas, total });
});

module.exports = rotas;
