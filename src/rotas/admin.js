'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const yazl = require('yazl');

const config = require('../config');
const { exigirAdmin, exigirMesmaOrigem } = require('../admin-auth');
const { espacoLivre } = require('../disco');
const { lerCursor, lerLimite, montarPagina } = require('../paginacao');
const { caminhoDerivada } = require('../imagem');
const {
  listarTodasPrimeiraPagina,
  listarTodasAposCursor,
  contarPorVisibilidade,
  buscarFoto,
  alternarVisibilidade,
  listarParaZip,
} = require('../banco');

const rotas = express.Router();

const DIR_PRIVADO = path.join(__dirname, '..', '..', 'privado');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A pagina do painel fica em privado/, fora do diretorio servido como estatico
// — assim nem o HTML dela aparece para quem nao passou pelo basic auth.
const paginaAdmin = fs.readFileSync(path.join(DIR_PRIVADO, 'admin.html'), 'utf8');

// Todo o painel exige credencial, inclusive CSS e JS.
rotas.use('/admin', exigirAdmin);

rotas.get('/admin', (req, res) => {
  res.type('html').send(paginaAdmin);
});

rotas.get('/admin/admin.css', (req, res) => {
  res.type('css').sendFile(path.join(DIR_PRIVADO, 'admin.css'));
});

rotas.get('/admin/admin.js', (req, res) => {
  res.type('js').sendFile(path.join(DIR_PRIVADO, 'admin.js'));
});

// --- Listagem, incluindo as ocultas ----------------------------------------

rotas.get('/admin/api/fotos', (req, res) => {
  const limite = lerLimite(req.query.limit);
  const cursor = lerCursor(req.query.cursor);

  const fotos = cursor
    ? listarTodasAposCursor.all({ ...cursor, limite })
    : listarTodasPrimeiraPagina.all({ limite });

  res.json(montarPagina(fotos, limite));
});

// --- Resumo do topo do painel ----------------------------------------------

rotas.get('/admin/api/resumo', async (req, res) => {
  const contagem = contarPorVisibilidade.get();
  const disco = await espacoLivre();

  res.json({
    publicadas: contagem.publicadas ?? 0,
    ocultas: contagem.ocultas ?? 0,
    total: contagem.total ?? 0,
    disco,
  });
});

// --- Ocultar e reexibir -----------------------------------------------------

rotas.post('/admin/fotos/:id/hidden', exigirMesmaOrigem, (req, res) => {
  const { id } = req.params;

  if (!UUID.test(id)) {
    return res.status(400).json({ erro: 'identificador de foto inválido' });
  }

  const resultado = alternarVisibilidade.run(id);
  if (resultado.changes === 0) {
    return res.status(404).json({ erro: 'não encontrei essa foto' });
  }

  const foto = buscarFoto.get(id);
  const contagem = contarPorVisibilidade.get();

  console.log('[admin] visibilidade alterada', {
    id,
    hidden: foto.hidden,
    ip: req.ip,
  });

  res.json({
    id,
    hidden: foto.hidden,
    publicadas: contagem.publicadas ?? 0,
    ocultas: contagem.ocultas ?? 0,
  });
});

// --- ZIP de todos os originais ---------------------------------------------

// Nome de pasta legivel dentro do ZIP: data da foto na frente, para o arquivo
// abrir em ordem cronologica em qualquer gerenciador.
function nomeNoZip(foto, indice) {
  const pasta = foto.hidden ? 'ocultas' : 'publicadas';
  const quando = (foto.tirada_em ?? foto.criado_em).slice(0, 19).replace(/[:T]/g, '-');
  return `${pasta}/${quando}_${String(indice).padStart(4, '0')}_${foto.id}.jpg`;
}

rotas.get('/admin/zip', (req, res) => {
  const fotos = listarParaZip.all();

  if (fotos.length === 0) {
    return res.status(404).json({ erro: 'não há nenhuma foto para baixar ainda' });
  }

  const zip = new yazl.ZipFile();
  let incluidas = 0;
  let faltando = 0;

  fotos.forEach((foto, indice) => {
    // Toda derivada orig e JPEG na pratica (o cliente converte antes de
    // enviar), mas o PNG e aceito pelo servidor, entao os dois sao testados.
    const candidatos = [caminhoDerivada('orig', foto.id, 'jpg'), caminhoDerivada('orig', foto.id, 'png')];
    const caminho = candidatos.find((c) => fs.existsSync(c));

    if (!caminho) {
      faltando += 1;
      console.error('[admin] original ausente no zip', { id: foto.id });
      return;
    }

    // addFile le do disco sob demanda: o ZIP sai em streaming e a VPS nunca
    // segura o acervo inteiro na memoria.
    zip.addFile(caminho, nomeNoZip(foto, indice + 1), {
      // Sem compressao: JPEG ja e comprimido, entao deflate gastaria CPU da
      // VPS para economizar quase nada.
      compress: false,
      mtime: new Date(foto.tirada_em ?? foto.criado_em),
    });
    incluidas += 1;
  });

  if (incluidas === 0) {
    return res.status(500).json({ erro: 'não encontrei os arquivos das fotos no disco' });
  }

  const nomeArquivo = `album-${new Date().toISOString().slice(0, 10)}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);

  zip.outputStream.on('error', (erro) => {
    console.error('[admin] falha ao gerar o zip', { erro: erro.message });
    if (!res.headersSent) res.status(500).json({ erro: 'não consegui montar o arquivo' });
    else res.destroy();
  });

  console.log('[admin] zip iniciado', { incluidas, faltando, ip: req.ip });

  zip.outputStream.pipe(res);
  zip.end();
});

module.exports = rotas;
