'use strict';

const path = require('node:path');

// Toda configuracao vem do ambiente. Se algo obrigatorio faltar ou vier
// invalido, o processo morre aqui no boot com mensagem clara — melhor do que
// descobrir durante a festa.

function inteiro(nome, padrao, { minimo = 1 } = {}) {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto === '') return padrao;

  const valor = Number(bruto);
  if (!Number.isInteger(valor) || valor < minimo) {
    throw new Error(
      `Variavel de ambiente ${nome} invalida: "${bruto}". ` +
        `Esperado um numero inteiro maior ou igual a ${minimo}.`
    );
  }
  return valor;
}

function texto(nome, padrao) {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto.trim() === '') return padrao;
  return bruto.trim();
}

const dirDados = path.resolve(texto('DIR_DADOS', './dados'));
const maxArquivoMb = inteiro('MAX_ARQUIVO_MB', 12);

const config = {
  porta: inteiro('PORTA', 3000),

  // Aparece no cabecalho da pagina do convidado.
  nomeAniversariante: texto('NOME_ANIVERSARIANTE', 'a aniversariante'),

  dirDados,
  dirBanco: path.join(dirDados, 'album.db'),
  dirMidia: path.join(dirDados, 'midia'),
  dirTemporario: path.join(dirDados, 'tmp'),

  maxArquivoMb,
  maxArquivoBytes: maxArquivoMb * 1024 * 1024,
  maxArquivosPorRequisicao: inteiro('MAX_ARQUIVOS_POR_REQUISICAO', 10),

  // A VPS tem 2 vCPU. Mais que isso e o sharp satura a CPU num pico de uploads.
  concorrenciaImagem: inteiro('CONCORRENCIA_IMAGEM', 2),

  // Atras do Caddy o IP real vem no X-Forwarded-For. 'loopback' cobre o proxy
  // rodando no mesmo host; em dev, sem proxy nenhum, e inofensivo.
  trustProxy: texto('TRUST_PROXY', 'loopback'),
};

module.exports = config;
