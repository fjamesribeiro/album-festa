// Amarra os modulos e cuida da interface do envio.

import { enviarTodos } from './envio.js';
import * as galeria from './galeria.js';
import * as lightbox from './lightbox.js';

const CHAVE_AUTOR = 'album.autor';
// Quem escolheu mandar sem nome nao pode ser perguntado de novo a cada envio.
// Insistir com quem ja disse nao e o tipo de atrito que faz o convidado
// desistir de mandar a proxima foto.
const CHAVE_JA_PERGUNTOU = 'album.autor.perguntado';

const elementos = {
  // Cabecalho e grid
  contador: document.getElementById('contador'),
  grade: document.getElementById('grade'),
  sentinela: document.getElementById('sentinela'),
  vazio: document.getElementById('vazio'),
  aviso: document.getElementById('aviso'),

  // Envio
  botao: document.getElementById('enviar'),
  rotulo: document.getElementById('rotulo-enviar'),
  barra: document.getElementById('progresso-barra'),
  entrada: document.getElementById('arquivos'),
  autor: document.getElementById('autor'),

  // Cartao do nome e assinatura
  cartao: document.getElementById('cartao-nome'),
  formNome: document.getElementById('form-nome'),
  pularNome: document.getElementById('pular-nome'),
  assinatura: document.getElementById('assinatura'),
  assinaturaNome: document.getElementById('assinatura-nome'),
  trocarNome: document.getElementById('trocar-nome'),
  status: document.getElementById('status'),
  falhas: document.getElementById('lista-falhas'),
  tentarDeNovo: document.getElementById('tentar-de-novo'),

  // Lightbox
  caixa: document.getElementById('lightbox'),
  palco: document.getElementById('lightbox-palco'),
  imagem: document.getElementById('lightbox-imagem'),
  legenda: document.getElementById('lightbox-legenda'),
  posicao: document.getElementById('lightbox-posicao'),
  baixar: document.getElementById('lightbox-baixar'),
  fechar: document.getElementById('lightbox-fechar'),
  anterior: document.getElementById('lightbox-anterior'),
  proxima: document.getElementById('lightbox-proxima'),
};

let enviando = false;
let arquivosQueFalharam = [];

// --- Nome do convidado: pedido uma vez, guardado no aparelho ---------------

// Fotos escolhidas esperando o nome. null quando o cartao foi aberto so para
// trocar o nome, sem envio pendente.
let pendentes = null;

function nomeGuardado() {
  return (localStorage.getItem(CHAVE_AUTOR) || '').trim();
}

// A assinatura confirma para o convidado sob que nome a foto vai — e da o
// caminho para corrigir, ja que o cartao so aparece uma vez.
function atualizarAssinatura() {
  const nome = nomeGuardado();
  elementos.assinaturaNome.textContent = nome;
  elementos.assinatura.hidden = nome === '';
}

function abrirCartao(arquivos) {
  pendentes = arquivos;
  elementos.autor.value = nomeGuardado();
  elementos.cartao.hidden = false;
  document.body.classList.add('sem-rolagem');
  // O foco tem que vir depois da pintura, senao o teclado do celular nao sobe.
  requestAnimationFrame(() => elementos.autor.focus());
}

// Fechar nunca pode perder as fotos que o convidado ja escolheu: se havia
// envio pendente, ele acontece de qualquer jeito, com ou sem nome.
function fecharCartao() {
  const arquivos = pendentes;
  pendentes = null;
  elementos.cartao.hidden = true;
  document.body.classList.remove('sem-rolagem');
  localStorage.setItem(CHAVE_JA_PERGUNTOU, '1');
  atualizarAssinatura();
  if (arquivos) processar(arquivos);
}

function guardarNome() {
  const valor = elementos.autor.value.trim();
  if (valor) localStorage.setItem(CHAVE_AUTOR, valor);
  else localStorage.removeItem(CHAVE_AUTOR);
}

elementos.formNome.addEventListener('submit', (evento) => {
  evento.preventDefault();
  guardarNome();
  fecharCartao();
});

elementos.pularNome.addEventListener('click', fecharCartao);

elementos.trocarNome.addEventListener('click', () => abrirCartao(null));

// Toque fora da caixa fecha, como o convidado espera de qualquer cartao.
elementos.cartao.addEventListener('click', (evento) => {
  if (evento.target === elementos.cartao) fecharCartao();
});

document.addEventListener('keydown', (evento) => {
  if (evento.key === 'Escape' && !elementos.cartao.hidden) fecharCartao();
});

atualizarAssinatura();

// --- Interface do envio ----------------------------------------------------

function mostrarStatus(texto, classe) {
  elementos.status.textContent = texto;
  elementos.status.className = 'status' + (classe ? ' ' + classe : '');
}

function atualizarProgresso(indice, total, fracao) {
  // Cada foto ocupa uma fatia igual da barra.
  const percentual = ((indice + fracao) / total) * 100;
  elementos.barra.style.width = percentual.toFixed(1) + '%';
  elementos.rotulo.textContent = `Enviando foto ${indice + 1} de ${total}…`;
}

function mostrarFalhas(falhas) {
  arquivosQueFalharam = falhas.map((f) => f.arquivo);

  elementos.falhas.textContent = '';

  if (falhas.length === 0) {
    elementos.falhas.hidden = true;
    elementos.tentarDeNovo.hidden = true;
    return;
  }

  for (const falha of falhas) {
    const item = document.createElement('li');
    const nome = document.createElement('b');
    nome.textContent = falha.arquivo.name || 'foto';
    item.append(nome, document.createTextNode(' — ' + falha.motivo));
    elementos.falhas.appendChild(item);
  }

  elementos.falhas.hidden = false;
  elementos.tentarDeNovo.hidden = false;
}

// Durante o envio o botao flutuante nao sai do lugar: vira barra de progresso
// ali mesmo, para o convidado nao perder o que estava vendo no grid.
function entrarEmModoEnvio(ligado) {
  enviando = ligado;
  elementos.botao.disabled = ligado;
  elementos.botao.classList.toggle('enviando', ligado);
  if (!ligado) {
    elementos.rotulo.textContent = 'Enviar fotos';
    elementos.barra.style.width = '0%';
  }
}

function contar(quantidade, singular, plural) {
  return `${quantidade} ${quantidade === 1 ? singular : plural}`;
}

async function processar(arquivos) {
  if (enviando || arquivos.length === 0) return;

  entrarEmModoEnvio(true);
  mostrarFalhas([]);
  mostrarStatus('');

  // O nome vem do que esta guardado, nao do input: fora da primeira vez o
  // cartao nem abre, e o campo dentro dele continua vazio.
  const autor = nomeGuardado();

  const { enviadas, falhas } = await enviarTodos(arquivos, autor, {
    aoProgredir: atualizarProgresso,
    // Cada foto entra no topo do grid assim que sobe, sem recarregar a pagina.
    aoEnviar: (novas) => galeria.inserirEnviadas(novas),
  });

  entrarEmModoEnvio(false);
  mostrarFalhas(falhas);

  if (enviadas.length > 0 && falhas.length === 0) {
    mostrarStatus(`✓ ${contar(enviadas.length, 'foto enviada', 'fotos enviadas')}, obrigado!`, 'sucesso');
  } else if (enviadas.length > 0) {
    mostrarStatus(
      `✓ ${contar(enviadas.length, 'foto enviada', 'fotos enviadas')}. ` +
        `${contar(falhas.length, 'não subiu', 'não subiram')}:`,
      'sucesso'
    );
  } else {
    mostrarStatus('Não consegui enviar. Veja abaixo o que houve:', 'erro');
  }
}

elementos.botao.addEventListener('click', () => {
  if (enviando) return;
  elementos.entrada.click();
});

elementos.entrada.addEventListener('change', () => {
  const arquivos = Array.from(elementos.entrada.files || []);
  // Zera para permitir escolher o mesmo arquivo de novo depois.
  elementos.entrada.value = '';
  if (arquivos.length === 0) return;

  // Pergunta o nome no instante de maior compromisso: as fotos ja estao
  // escolhidas. So na primeira vez do aparelho — depois o nome esta guardado
  // e o envio segue direto, sem toque a mais.
  const primeiraVez = nomeGuardado() === '' && !localStorage.getItem(CHAVE_JA_PERGUNTOU);
  if (primeiraVez) abrirCartao(arquivos);
  else processar(arquivos);
});

elementos.tentarDeNovo.addEventListener('click', () => {
  const repetir = arquivosQueFalharam.slice();
  if (repetir.length > 0) processar(repetir);
});

// --- Montagem --------------------------------------------------------------

lightbox.iniciar({
  elementos,
  obterLista: galeria.listaAtual,
});

galeria.iniciar({
  elementos,
  aoAbrirFoto: lightbox.abrir,
});
