'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const express = require('express');

const config = require('./config');
const banco = require('./banco');
const { seguranca } = require('./seguranca');
const { exigirToken, NAO_ENCONTRADO } = require('./token');
const rotasUpload = require('./rotas/upload');
const rotasMidia = require('./rotas/midia');
const rotasFotos = require('./rotas/fotos');
const rotasAdmin = require('./rotas/admin');

const DIR_PUBLICO = path.join(__dirname, '..', 'publico');

// Escapa o nome antes de injetar no HTML — vem de variavel de ambiente, mas
// interpolar texto cru em HTML e habito ruim mesmo quando a fonte e confiavel.
function escaparHtml(texto) {
  return String(texto)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const paginaConvidado = fs
  .readFileSync(path.join(DIR_PUBLICO, 'index.html'), 'utf8')
  .replaceAll('{{NOME_ANIVERSARIANTE}}', escaparHtml(config.nomeAniversariante))
  .replaceAll('{{SUBTITULO}}', escaparHtml(config.subtitulo));

// Sobrou temporario de um upload interrompido por queda do processo? Limpa no
// boot, senao o disco enche em silencio ao longo da festa.
async function limparTemporariosOrfaos() {
  try {
    const arquivos = await fsp.readdir(config.dirTemporario);
    await Promise.all(
      arquivos.map((nome) => fsp.rm(path.join(config.dirTemporario, nome), { force: true }))
    );
    if (arquivos.length > 0) {
      console.log('[boot] temporarios orfaos removidos', { quantidade: arquivos.length });
    }
  } catch (erro) {
    console.error('[boot] nao consegui limpar temporarios', { erro: erro.message });
  }
}

const app = express();

app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');
app.disable('etag');

// Cabecalhos de seguranca antes de qualquer rota, para valerem inclusive nas
// respostas de erro e nos 404.
app.use(seguranca);

app.get('/', exigirToken, (req, res) => {
  res.type('html').send(paginaConvidado);
});

// CSS e JS ficam livres de token: sao codigo, nao revelam foto nenhuma nem a
// existencia do album. Exigir token neles so quebraria o cache do navegador.
app.use(
  express.static(DIR_PUBLICO, {
    index: false,
    dotfiles: 'ignore',
    redirect: false,
  })
);

app.use(rotasAdmin);
app.use(rotasFotos);
app.use(rotasUpload);
app.use(rotasMidia);

app.use((req, res) => {
  res.status(404).json(NAO_ENCONTRADO);
});

// Erro nao tratado em qualquer rota: loga com contexto, responde em linguagem
// humana e nunca vaza stack para o convidado.
app.use((erro, req, res, next) => {
  console.error('[erro] requisicao falhou', {
    metodo: req.method,
    caminho: req.originalUrl,
    ip: req.ip,
    erro: erro.message,
    stack: erro.stack,
  });
  if (res.headersSent) return next(erro);
  res.status(500).json({ erro: 'algo deu errado aqui do nosso lado, tente de novo' });
});

async function iniciar() {
  await limparTemporariosOrfaos();

  const servidor = app.listen(config.porta, () => {
    const { total } = banco.contarPublicadas.get();
    console.log('[boot] album no ar', {
      porta: config.porta,
      dados: config.dirDados,
      fotos_publicadas: total,
      concorrencia_imagem: config.concorrenciaImagem,
      max_arquivo_mb: config.maxArquivoMb,
    });
  });

  function encerrar(sinal) {
    console.log('[shutdown] encerrando', { sinal });
    servidor.close(() => {
      banco.fechar();
      process.exit(0);
    });
    // Se as conexoes nao fecharem em 10s, sai de qualquer jeito.
    setTimeout(() => {
      banco.fechar();
      process.exit(0);
    }, 10000).unref();
  }

  process.on('SIGTERM', () => encerrar('SIGTERM'));
  process.on('SIGINT', () => encerrar('SIGINT'));
}

iniciar();
