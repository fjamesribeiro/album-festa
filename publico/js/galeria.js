// Grid de fotos: listagem paginada, scroll infinito, contador e atualizacao.

import { buscarFotos, urlMidia } from './api.js';

const POR_PAGINA = 30;
const INTERVALO_ATUALIZACAO = 30000;

// Estado da galeria. `fotos` fica sempre ordenada da mais recente para a mais
// antiga, igual a resposta do servidor.
let fotos = [];
let proximoCursor = null;
let acabou = false;
let carregando = false;
let total = 0;

let elementos = {};
let aoAbrirFoto = null;
const celulas = new Map(); // id -> elemento, para nao reconstruir o grid todo

// --- Ordenacao -------------------------------------------------------------

// Mesma ordem do servidor: criado_em decrescente, id como desempate. Positivo
// quando `a` e mais recente que `b`.
function comparar(a, b) {
  if (a.criado_em !== b.criado_em) return a.criado_em < b.criado_em ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

// --- Montagem de uma celula ------------------------------------------------

function criarCelula(foto) {
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'celula';
  botao.dataset.id = foto.id;
  botao.setAttribute('aria-label', 'Abrir foto');

  const img = document.createElement('img');
  img.src = urlMidia('thumb', foto.id);
  img.alt = '';
  // Lazy loading nativo: com 300 fotos, o navegador so busca o que aparece.
  img.loading = 'lazy';
  img.decoding = 'async';

  botao.appendChild(img);
  botao.addEventListener('click', () => aoAbrirFoto?.(foto.id));

  celulas.set(foto.id, botao);
  return botao;
}

// --- Desenho ---------------------------------------------------------------

function textoContador(quantidade) {
  if (quantidade === 0) return 'nenhuma foto ainda';
  if (quantidade === 1) return '1 foto';
  return `${quantidade} fotos`;
}

function desenharContador() {
  elementos.contador.textContent = textoContador(total);
}

function desenharVazio() {
  // Sem estado vazio generico: quando nao ha foto, o texto convida a mandar a
  // primeira em vez de anunciar que nao ha nada.
  const vazio = fotos.length === 0 && acabou;
  elementos.vazio.hidden = !vazio;
}

// Aplica a lista nova no DOM mexendo so no que mudou. Reconstruir o grid
// inteiro faria as imagens recarregarem e piscarem a cada atualizacao.
function sincronizarGrade(novaLista) {
  const novosIds = new Set(novaLista.map((f) => f.id));

  for (const [id, elemento] of celulas) {
    if (!novosIds.has(id)) {
      elemento.remove();
      celulas.delete(id);
    }
  }

  // Percorre de tras para frente: cada foto e inserida antes da que ja ocupa
  // a posicao seguinte, entao a ordem sai correta sem mover nada de lugar.
  let seguinte = null;
  for (let i = novaLista.length - 1; i >= 0; i -= 1) {
    const foto = novaLista[i];
    let celula = celulas.get(foto.id);
    if (!celula) {
      celula = criarCelula(foto);
      elementos.grade.insertBefore(celula, seguinte);
    }
    seguinte = celula;
  }

  fotos = novaLista;
  desenharVazio();
}

// --- Carregamento ----------------------------------------------------------

async function carregarMais() {
  if (carregando || acabou) return;
  carregando = true;

  try {
    const dados = await buscarFotos({ cursor: proximoCursor, limite: POR_PAGINA });

    total = dados.total;
    proximoCursor = dados.proximoCursor;
    acabou = dados.proximoCursor === null;

    // Ignora o que ja esta na tela: a foto que o convidado acabou de enviar
    // pode voltar na pagina seguinte e apareceria duas vezes.
    const novas = dados.fotos.filter((f) => !celulas.has(f.id));
    sincronizarGrade([...fotos, ...novas]);
    desenharContador();
  } catch (erro) {
    console.error('nao consegui carregar as fotos', erro);
    elementos.aviso.textContent = 'não consegui carregar as fotos. Puxe a tela para tentar de novo.';
    elementos.aviso.hidden = false;
    // Sem `acabou`, o observer tentaria de novo em rajada; o proximo scroll
    // ou a atualizacao periodica retomam.
  } finally {
    carregando = false;
  }
}

// Rebusca a primeira pagina e reconcilia: foto nova entra no topo, foto que o
// admin ocultou sai do grid.
async function atualizar() {
  if (carregando) return;
  if (document.visibilityState !== 'visible') return;

  try {
    const dados = await buscarFotos({ limite: POR_PAGINA });
    total = dados.total;

    if (dados.fotos.length === 0) {
      acabou = true;
      proximoCursor = null;
      sincronizarGrade([]);
      desenharContador();
      return;
    }

    // A primeira pagina manda no trecho que ela cobre. Abaixo do mais antigo
    // que ela devolveu, o que ja esta carregado continua valendo.
    const maisAntigaDaPagina = dados.fotos[dados.fotos.length - 1];
    const cauda = fotos.filter((f) => comparar(f, maisAntigaDaPagina) < 0);

    sincronizarGrade([...dados.fotos, ...cauda]);
    desenharContador();

    elementos.aviso.hidden = true;
  } catch (erro) {
    // Falha de atualizacao e silenciosa: o grid que ja esta na tela continua
    // valendo e a proxima tentativa vem em 30s.
    console.error('falha ao atualizar a galeria', erro);
  }
}

// Insere no topo as fotos que o convidado acabou de enviar, sem recarregar.
function inserirEnviadas(novas) {
  if (!novas || novas.length === 0) return;

  const desconhecidas = novas.filter((f) => !celulas.has(f.id));
  if (desconhecidas.length === 0) return;

  // O servidor devolve id, largura e altura; o resto so importa na ordenacao,
  // e como acabaram de chegar, sao as mais recentes de todas.
  const agora = new Date().toISOString();
  const comOrdem = desconhecidas.map((f) => ({ criado_em: agora, autor: null, tirada_em: null, ...f }));

  total += comOrdem.length;
  sincronizarGrade([...comOrdem.reverse(), ...fotos]);
  desenharContador();
}

// --- Inicializacao ---------------------------------------------------------

function iniciar(config) {
  elementos = config.elementos;
  aoAbrirFoto = config.aoAbrirFoto;

  // rootMargin folgado: a proxima pagina comeca a chegar bem antes de o
  // convidado alcancar o fim, entao o scroll nao trava esperando rede.
  const observador = new IntersectionObserver(
    (entradas) => {
      if (entradas.some((e) => e.isIntersecting)) carregarMais();
    },
    { rootMargin: '600px 0px' }
  );
  observador.observe(elementos.sentinela);

  carregarMais();

  // Sem websocket: so consulta quando a aba esta visivel de verdade. Sem essa
  // guarda, 200 celulares no bolso ficariam batendo no servidor a noite toda.
  setInterval(atualizar, INTERVALO_ATUALIZACAO);
  window.addEventListener('focus', atualizar);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') atualizar();
  });
}

function listaAtual() {
  return fotos;
}

export { iniciar, inserirEnviadas, atualizar, listaAtual };
