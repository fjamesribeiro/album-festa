// Visualizacao de uma foto: swipe, teclado e botao de baixar.

import { urlMidia } from './api.js';

// Distancia minima para valer como swipe. Abaixo disso e toque tremido de quem
// esta segurando o celular com uma mao so.
const LIMIAR_SWIPE = 50;

let elementos = {};
let obterLista = null;
let indice = -1;
let toqueX = null;
let toqueY = null;

function fotoAtual() {
  const lista = obterLista();
  return lista[indice] ?? null;
}

function formatarData(tiradaEm) {
  if (!tiradaEm) return '';
  const partes = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(tiradaEm);
  if (!partes) return '';
  const [, ano, mes, dia, hora, minuto] = partes;
  return `${dia}/${mes}/${ano} às ${hora}:${minuto}`;
}

// Busca a foto vizinha em segundo plano. No 4G do salao, sem isso cada swipe
// abre numa tela preta esperando a imagem.
function precarregar(posicao) {
  const lista = obterLista();
  const foto = lista[posicao];
  if (!foto) return;
  const img = new Image();
  img.src = urlMidia('view', foto.id);
}

function desenhar() {
  const foto = fotoAtual();
  if (!foto) return;

  const lista = obterLista();

  elementos.imagem.src = urlMidia('view', foto.id);
  elementos.imagem.alt = foto.autor ? `Foto enviada por ${foto.autor}` : 'Foto do álbum';

  const autor = foto.autor ? `enviada por ${foto.autor}` : '';
  const data = formatarData(foto.tirada_em);
  elementos.legenda.textContent = [autor, data].filter(Boolean).join(' · ');

  elementos.baixar.href = urlMidia('orig', foto.id);
  elementos.baixar.setAttribute('download', `foto-${foto.id}.jpg`);

  elementos.posicao.textContent = `${indice + 1} de ${lista.length}`;
  elementos.anterior.disabled = indice <= 0;
  elementos.proxima.disabled = indice >= lista.length - 1;

  precarregar(indice + 1);
  precarregar(indice - 1);
}

function irPara(novoIndice) {
  const lista = obterLista();
  if (novoIndice < 0 || novoIndice >= lista.length) return;
  indice = novoIndice;
  desenhar();
}

function abrir(id) {
  const lista = obterLista();
  const posicao = lista.findIndex((f) => f.id === id);
  if (posicao < 0) return;

  indice = posicao;
  elementos.caixa.hidden = false;
  document.body.classList.add('sem-rolagem');
  desenhar();
  elementos.fechar.focus();
}

function fechar() {
  elementos.caixa.hidden = true;
  document.body.classList.remove('sem-rolagem');
  // Solta a imagem grande da memoria ao fechar.
  elementos.imagem.src = '';
  indice = -1;
}

function estaAberto() {
  return !elementos.caixa.hidden;
}

function iniciar(config) {
  elementos = config.elementos;
  obterLista = config.obterLista;

  elementos.fechar.addEventListener('click', fechar);
  elementos.anterior.addEventListener('click', () => irPara(indice - 1));
  elementos.proxima.addEventListener('click', () => irPara(indice + 1));

  // Clique no fundo fecha; clique na foto ou nos controles, nao.
  elementos.caixa.addEventListener('click', (evento) => {
    if (evento.target === elementos.caixa || evento.target === elementos.palco) fechar();
  });

  document.addEventListener('keydown', (evento) => {
    if (!estaAberto()) return;
    if (evento.key === 'Escape') fechar();
    else if (evento.key === 'ArrowLeft') irPara(indice - 1);
    else if (evento.key === 'ArrowRight') irPara(indice + 1);
  });

  elementos.palco.addEventListener(
    'touchstart',
    (evento) => {
      const toque = evento.changedTouches[0];
      toqueX = toque.clientX;
      toqueY = toque.clientY;
    },
    { passive: true }
  );

  elementos.palco.addEventListener(
    'touchend',
    (evento) => {
      if (toqueX === null) return;
      const toque = evento.changedTouches[0];
      const deltaX = toque.clientX - toqueX;
      const deltaY = toque.clientY - toqueY;
      toqueX = null;
      toqueY = null;

      // So conta como swipe se for mais horizontal que vertical — senao o
      // gesto de rolar a pagina trocaria de foto sem querer.
      if (Math.abs(deltaX) < LIMIAR_SWIPE || Math.abs(deltaX) < Math.abs(deltaY)) return;
      irPara(deltaX < 0 ? indice + 1 : indice - 1);
    },
    { passive: true }
  );
}

export { iniciar, abrir, fechar };
