// Conversao no cliente e envio das fotos.
//
// Movido de publico/app.js: a conversao no <canvas> e o envio sequencial por
// XMLHttpRequest foram validados com 27 fotos reais de celular, sem falha.
// A unica alteracao foi a URL do upload, que agora leva o token.

import { urlUpload } from './api.js';
import { lerDataDeCaptura } from './exif.js';

const LADO_MAXIMO = 2560;
const QUALIDADE = 0.9;

// --- Conversao para JPEG -------------------------------------------------

function calcularTamanho(largura, altura) {
  const maior = Math.max(largura, altura);
  // Nunca amplia: so reduz quando passa do limite.
  if (maior <= LADO_MAXIMO) return { largura: largura, altura: altura };
  const escala = LADO_MAXIMO / maior;
  return {
    largura: Math.round(largura * escala),
    altura: Math.round(altura * escala),
  };
}

// Caminho principal: createImageBitmap com imageOrientation 'from-image'
// resolve o EXIF antes de a imagem chegar ao canvas.
function carregarBitmap(arquivo) {
  if (typeof createImageBitmap !== 'function') return Promise.reject(new Error('sem createImageBitmap'));
  return createImageBitmap(arquivo, { imageOrientation: 'from-image' });
}

// Fallback para navegadores antigos. Um <img> renderizado respeita o EXIF por
// padrao nos navegadores atuais, entao desenhar no canvas ja sai na posicao
// certa; naturalWidth/naturalHeight tambem vem ja orientados.
function carregarImagem(arquivo) {
  return new Promise(function (resolve, reject) {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = function () {
      resolve({
        fonte: img,
        largura: img.naturalWidth,
        altura: img.naturalHeight,
        liberar: function () { URL.revokeObjectURL(url); },
      });
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      reject(new Error('não consegui abrir essa imagem'));
    };
    img.src = url;
  });
}

async function obterFonte(arquivo) {
  try {
    const bitmap = await carregarBitmap(arquivo);
    return {
      fonte: bitmap,
      largura: bitmap.width,
      altura: bitmap.height,
      liberar: function () { if (bitmap.close) bitmap.close(); },
    };
  } catch (erro) {
    return carregarImagem(arquivo);
  }
}

function paraBlob(canvas) {
  return new Promise(function (resolve, reject) {
    canvas.toBlob(
      function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('não consegui converter essa foto'));
      },
      'image/jpeg',
      QUALIDADE
    );
  });
}

async function converterParaJpeg(arquivo) {
  const origem = await obterFonte(arquivo);
  try {
    const tamanho = calcularTamanho(origem.largura, origem.altura);
    const canvas = document.createElement('canvas');
    canvas.width = tamanho.largura;
    canvas.height = tamanho.altura;

    const contexto = canvas.getContext('2d');
    if (!contexto) throw new Error('canvas indisponível');
    contexto.drawImage(origem.fonte, 0, 0, tamanho.largura, tamanho.altura);

    const blob = await paraBlob(canvas);

    // Libera a memoria do canvas: 30 fotos sem isso derruba a aba no celular.
    canvas.width = 0;
    canvas.height = 0;

    return blob;
  } finally {
    origem.liberar();
  }
}

// --- Envio ---------------------------------------------------------------

function nomeDeSaida(nomeOriginal) {
  const base = (nomeOriginal || 'foto').replace(/\.[^.]+$/, '');
  return base + '.jpg';
}

// XMLHttpRequest e nao fetch: o fetch nao expoe progresso de upload.
function enviarUm(blob, nome, autor, tiradaEm, aoProgredir) {
  return new Promise(function (resolve, reject) {
    const dados = new FormData();
    // O autor vai antes do arquivo para o servidor ja te-lo em maos.
    if (autor) dados.append('autor', autor);
    if (tiradaEm) dados.append('tirada_em', tiradaEm);
    dados.append('fotos', blob, nome);

    const requisicao = new XMLHttpRequest();
    requisicao.open('POST', urlUpload());
    requisicao.timeout = 120000;

    requisicao.upload.onprogress = function (evento) {
      if (evento.lengthComputable) aoProgredir(evento.loaded / evento.total);
    };

    requisicao.onload = function () {
      let corpo = null;
      try {
        corpo = JSON.parse(requisicao.responseText);
      } catch (erro) {
        corpo = null;
      }

      if (requisicao.status >= 200 && requisicao.status < 300 && corpo) {
        if (corpo.enviadas && corpo.enviadas.length > 0) {
          resolve(corpo);
        } else {
          const falha = corpo.falhas && corpo.falhas[0];
          reject(new Error((falha && falha.motivo) || 'não consegui enviar essa foto, tente de novo'));
        }
        return;
      }

      const falha = corpo && corpo.falhas && corpo.falhas[0];
      reject(new Error((falha && falha.motivo) || 'não consegui enviar essa foto, tente de novo'));
    };

    requisicao.onerror = function () {
      reject(new Error('a internet oscilou no meio do envio, tente de novo'));
    };
    requisicao.ontimeout = function () {
      reject(new Error('essa foto demorou demais para subir, tente de novo'));
    };

    requisicao.send(dados);
  });
}

// Envia os arquivos um a um. Sequencial de proposito: paralelo derruba o
// Wi-Fi do salao. Nao conhece a interface — avisa por callbacks.
//
// aoProgredir(indice, total, fracao)  — andamento do arquivo atual
// aoEnviar(fotos)                     — fotos aceitas pelo servidor
async function enviarTodos(arquivos, autor, { aoProgredir, aoEnviar } = {}) {
  const falhas = [];
  const enviadas = [];

  for (let i = 0; i < arquivos.length; i += 1) {
    const arquivo = arquivos[i];
    aoProgredir?.(i, arquivos.length, 0);

    try {
      // A data sai do arquivo original, antes de o canvas apagar o EXIF.
      const tiradaEm = await lerDataDeCaptura(arquivo);
      const blob = await converterParaJpeg(arquivo);

      const resposta = await enviarUm(blob, nomeDeSaida(arquivo.name), autor, tiradaEm, (fracao) => {
        aoProgredir?.(i, arquivos.length, fracao);
      });

      enviadas.push(...resposta.enviadas);
      // Cada foto aparece no grid assim que sobe, sem esperar o lote acabar.
      aoEnviar?.(resposta.enviadas);
    } catch (erro) {
      // Uma foto que falha nao interrompe as outras.
      console.error('falha ao enviar', arquivo.name, erro);
      falhas.push({ arquivo, motivo: erro.message });
    }

    aoProgredir?.(i, arquivos.length, 1);
  }

  return { enviadas, falhas };
}

export { converterParaJpeg, enviarUm, enviarTodos, nomeDeSaida };
