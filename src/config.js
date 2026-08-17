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

function textoObrigatorio(nome, explicacao) {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto.trim() === '') {
    throw new Error(
      `Variavel de ambiente ${nome} nao foi definida. ${explicacao}\n` +
        'Copie o .env.example para .env e preencha antes de subir o servidor.'
    );
  }
  return bruto.trim();
}

const dirDados = path.resolve(texto('DIR_DADOS', './dados'));
const maxArquivoMb = inteiro('MAX_ARQUIVO_MB', 12);

const config = {
  porta: inteiro('PORTA', 3000),

  // Aparece no cabecalho da pagina do convidado.
  nomeAniversariante: texto('NOME_ANIVERSARIANTE', 'a aniversariante'),

  // Unica coisa entre o album e a internet inteira. Obrigatoria de proposito:
  // um album que sobe desprotegido porque alguem esqueceu de definir a
  // variavel e falha silenciosa, e o pior lugar para descobrir isso e a festa.
  albumToken: textoObrigatorio(
    'ALBUM_TOKEN',
    'E o segredo que da acesso ao album, usado em /?k=TOKEN e no QR code da mesa.'
  ),

  // Painel de moderacao. Obrigatorias pelo mesmo motivo do token: um /admin
  // sem senha e pior do que nao ter admin nenhum.
  adminUsuario: textoObrigatorio('ADMIN_USUARIO', 'E o usuario do painel em /admin.'),
  adminSenha: textoObrigatorio('ADMIN_SENHA', 'E a senha do painel em /admin.'),

  // Piso de espaco livre. Abaixo disso o upload passa a ser recusado (Fase 4);
  // o painel ja mostra o numero para dar tempo de reagir durante a festa.
  discoMinimoGb: inteiro('DISCO_MINIMO_GB', 2),

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
