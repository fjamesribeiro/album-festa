'use strict';

const fsp = require('node:fs/promises');

const config = require('./config');

// fs.statfs e nativo no Node 22 — espaco livre sem dependencia nenhuma.
// O painel usa isso para mostrar quanto sobra durante a festa; a Fase 4 vai
// usar o mesmo helper para recusar upload quando o disco apertar.
async function espacoLivre() {
  try {
    const info = await fsp.statfs(config.dirDados);

    // bavail (e nao bfree) e o que sobra para processo comum: parte do disco
    // fica reservada para o root e nao esta disponivel de verdade.
    const livreBytes = info.bavail * info.bsize;
    const totalBytes = info.blocks * info.bsize;

    return {
      livreBytes,
      totalBytes,
      livreGb: livreBytes / 1024 ** 3,
      totalGb: totalBytes / 1024 ** 3,
      percentualUsado: totalBytes > 0 ? (1 - livreBytes / totalBytes) * 100 : 0,
      apertado: livreBytes < config.discoMinimoGb * 1024 ** 3,
      disponivel: true,
    };
  } catch (erro) {
    // Nunca derruba a pagina por causa disso: sem a informacao, o painel
    // mostra "nao consegui medir" e o resto continua funcionando.
    console.error('[disco] nao consegui medir o espaco livre', { erro: erro.message });
    return { disponivel: false, apertado: false };
  }
}

module.exports = { espacoLivre };
