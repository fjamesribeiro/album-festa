'use strict';

// Paginacao por cursor composto, compartilhada pela galeria do convidado e
// pelo admin. Extraida de src/rotas/fotos.js quando o admin passou a precisar
// da mesma logica — duas copias divergiriam na primeira correcao.

const LIMITE_PADRAO = 30;
// Sem teto, um ?limit=99999 faz o servidor montar o acervo inteiro em memoria.
const LIMITE_MAXIMO = 100;

// O cursor e opaco para o cliente: ele so devolve o que recebeu. Por dentro
// sao as duas colunas que ordenam a listagem.
function montarCursor(foto) {
  return Buffer.from(`${foto.criado_em}|${foto.id}`, 'utf8').toString('base64url');
}

// Cursor corrompido, truncado pelo navegador ou inventado a mao volta como
// nulo: a listagem recomeca da primeira pagina. Nunca derruba a requisicao.
function lerCursor(bruto) {
  if (typeof bruto !== 'string' || bruto === '') return null;

  try {
    const texto = Buffer.from(bruto, 'base64url').toString('utf8');
    const separador = texto.indexOf('|');
    if (separador <= 0) return null;

    const criadoEm = texto.slice(0, separador);
    const id = texto.slice(separador + 1);
    if (criadoEm === '' || id === '') return null;

    return { criado_em: criadoEm, id };
  } catch {
    return null;
  }
}

function lerLimite(bruto) {
  const valor = Number.parseInt(bruto, 10);
  if (!Number.isInteger(valor) || valor < 1) return LIMITE_PADRAO;
  return Math.min(valor, LIMITE_MAXIMO);
}

// Monta a resposta paginada. So ha proxima pagina se esta veio cheia; se veio
// incompleta, chegamos ao fim do acervo e o cliente para de pedir.
function montarPagina(fotos, limite) {
  return {
    fotos,
    proximoCursor: fotos.length === limite ? montarCursor(fotos[fotos.length - 1]) : null,
  };
}

module.exports = { LIMITE_PADRAO, LIMITE_MAXIMO, montarCursor, lerCursor, lerLimite, montarPagina };
