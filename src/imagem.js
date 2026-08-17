'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const config = require('./config');

// A VPS tem 2 vCPU. O semaforo abaixo limita quantas fotos sao processadas ao
// mesmo tempo; este ajuste limita quantas threads o libvips usa dentro de cada
// uma delas. Sem os dois, um pico de uploads satura a CPU e tudo trava.
sharp.concurrency(1);

const VARIANTES = ['thumb', 'view', 'orig'];

for (const variante of VARIANTES) {
  fs.mkdirSync(path.join(config.dirMidia, variante), { recursive: true });
}
fs.mkdirSync(config.dirTemporario, { recursive: true });

// --- Deteccao de formato por magic bytes -----------------------------------
// Nunca confiar na extensao nem no content-type enviados pelo cliente.

const ASSINATURAS = [
  { tipo: 'jpeg', extensao: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { tipo: 'png', extensao: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

async function detectarFormato(caminho) {
  let arquivo;
  try {
    arquivo = await fsp.open(caminho, 'r');
    const buffer = Buffer.alloc(8);
    const { bytesRead } = await arquivo.read(buffer, 0, 8, 0);

    for (const assinatura of ASSINATURAS) {
      if (bytesRead < assinatura.bytes.length) continue;
      const bate = assinatura.bytes.every((byte, i) => buffer[i] === byte);
      if (bate) return assinatura;
    }
    return null;
  } finally {
    await arquivo?.close();
  }
}

// --- Semaforo de concorrencia ----------------------------------------------
// Fila propria de ~20 linhas em vez de mais uma dependencia.

function criarSemaforo(limite) {
  let ativos = 0;
  const espera = [];

  function liberar() {
    ativos -= 1;
    const proximo = espera.shift();
    if (proximo) proximo();
  }

  return async function executar(tarefa) {
    if (ativos >= limite) {
      await new Promise((resolve) => espera.push(resolve));
    }
    ativos += 1;
    try {
      return await tarefa();
    } finally {
      liberar();
    }
  };
}

const comLimite = criarSemaforo(config.concorrenciaImagem);

// --- Geracao das derivadas --------------------------------------------------

function caminhoDerivada(variante, id, extensao) {
  return path.join(config.dirMidia, variante, `${id}.${extensao}`);
}

// O EXIF usa "2026:08:17 21:30:00"; nos guardamos "2026-08-17T21:30:00".
function paraFormatoExif(tiradaEm) {
  return tiradaEm.replace('T', ' ').replaceAll('-', ':');
}

/**
 * Gera thumb e view a partir do arquivo temporario e move o temporario para
 * orig. Roda sob o semaforo de concorrencia.
 *
 * Devolve { largura, altura, bytes, extensao } da imagem original.
 */
async function gerarDerivadas(caminhoTemporario, id, formato, tiradaEm) {
  return comLimite(async () => {
    const metadados = await sharp(caminhoTemporario).metadata();

    // autoOrient grava os pixels ja girados conforme o EXIF e normaliza a tag
    // de orientacao para 1. Sem isso, o thumb WebP — que nao carrega EXIF de
    // forma confiavel — sairia deitado no grid.
    await sharp(caminhoTemporario)
      .autoOrient()
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toFile(caminhoDerivada('thumb', id, 'webp'));

    // O <canvas> do cliente apaga o EXIF, entao nao ha o que "preservar": a
    // data de captura vem do proprio cliente, que a leu antes de converter, e
    // e regravada aqui. Orientation 1 porque o autoOrient ja girou os pixels.
    const exif = { IFD0: { Orientation: '1' } };
    if (tiradaEm) exif.IFD2 = { DateTimeOriginal: paraFormatoExif(tiradaEm) };

    await sharp(caminhoTemporario)
      .autoOrient()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .withExif(exif)
      .toFile(caminhoDerivada('view', id, 'jpg'));

    const { size } = await fsp.stat(caminhoTemporario);

    // Por ultimo: o original so sai da area temporaria depois que as duas
    // derivadas existem em disco.
    const caminhoOriginal = caminhoDerivada('orig', id, formato.extensao);
    await fsp.rename(caminhoTemporario, caminhoOriginal);

    // Data do arquivo = data da foto. O original nao e reescrito (fica "como
    // recebido"), mas o ZIP do admin carrega o mtime, entao depois da festa as
    // fotos aparecem na ordem certa em qualquer gerenciador de arquivos.
    if (tiradaEm) {
      const quando = new Date(tiradaEm);
      if (!Number.isNaN(quando.getTime())) {
        try {
          await fsp.utimes(caminhoOriginal, quando, quando);
        } catch (erro) {
          console.error('[imagem] nao consegui ajustar a data do arquivo', {
            id,
            erro: erro.message,
          });
        }
      }
    }

    // Dimensoes conforme exibidas, ja considerando a orientacao EXIF.
    const girada = metadados.orientation >= 5 && metadados.orientation <= 8;
    return {
      largura: girada ? metadados.height : metadados.width,
      altura: girada ? metadados.width : metadados.height,
      bytes: size,
      extensao: formato.extensao,
    };
  });
}

async function apagarSilencioso(caminho) {
  try {
    await fsp.rm(caminho, { force: true });
  } catch (erro) {
    console.error('[imagem] nao consegui apagar temporario', { caminho, erro: erro.message });
  }
}

module.exports = {
  VARIANTES,
  detectarFormato,
  gerarDerivadas,
  caminhoDerivada,
  apagarSilencioso,
};
