// Painel de moderacao: grid com todas as fotos e alternancia de um toque.

const POR_PAGINA = 60;

const elementos = {
  grade: document.getElementById('grade'),
  sentinela: document.getElementById('sentinela'),
  vazio: document.getElementById('vazio'),
  aviso: document.getElementById('aviso'),
  publicadas: document.getElementById('chip-publicadas'),
  ocultas: document.getElementById('chip-ocultas'),
  disco: document.getElementById('chip-disco'),
};

let proximoCursor = null;
let acabou = false;
let carregando = false;
const celulas = new Map();

function mostrarAviso(texto) {
  elementos.aviso.textContent = texto;
  elementos.aviso.hidden = !texto;
}

// --- Resumo do topo --------------------------------------------------------

function formatarGb(valor) {
  return `${valor.toFixed(valor < 10 ? 1 : 0)} GB`;
}

async function carregarResumo() {
  try {
    const resposta = await fetch('/admin/api/resumo', { headers: { Accept: 'application/json' } });
    if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
    const dados = await resposta.json();

    atualizarContagens(dados.publicadas, dados.ocultas);

    if (dados.disco?.disponivel) {
      elementos.disco.textContent = `${formatarGb(dados.disco.livreGb)} livre`;
      elementos.disco.classList.toggle('apertado', dados.disco.apertado);
    } else {
      elementos.disco.textContent = 'espaço: não medi';
    }
  } catch (erro) {
    console.error('falha ao carregar o resumo', erro);
  }
}

function atualizarContagens(publicadas, ocultas) {
  elementos.publicadas.textContent = `${publicadas} publicadas`;
  elementos.ocultas.textContent = `${ocultas} ocultas`;
}

// --- Celulas ---------------------------------------------------------------

function aplicarEstado(celula, hidden) {
  celula.classList.toggle('oculta', hidden === 1);
  celula.setAttribute(
    'aria-label',
    hidden === 1 ? 'Foto oculta. Tocar para reexibir' : 'Foto publicada. Tocar para ocultar'
  );
  celula.setAttribute('aria-pressed', hidden === 1 ? 'true' : 'false');
}

async function alternar(celula, foto) {
  if (celula.dataset.pendente === 'sim') return;
  celula.dataset.pendente = 'sim';
  celula.classList.add('pendente');

  // Estado otimista: o admin ve o resultado no mesmo toque, sem esperar a
  // rede. Se o servidor recusar, voltamos ao estado anterior.
  const anterior = foto.hidden;
  foto.hidden = anterior === 1 ? 0 : 1;
  aplicarEstado(celula, foto.hidden);

  try {
    const resposta = await fetch(`/admin/fotos/${foto.id}/hidden`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    if (!resposta.ok) throw new Error('HTTP ' + resposta.status);

    const dados = await resposta.json();
    foto.hidden = dados.hidden;
    aplicarEstado(celula, foto.hidden);
    atualizarContagens(dados.publicadas, dados.ocultas);
    mostrarAviso('');
  } catch (erro) {
    console.error('falha ao alternar visibilidade', erro);
    foto.hidden = anterior;
    aplicarEstado(celula, anterior);
    mostrarAviso('não consegui mudar essa foto. Tente de novo.');
  } finally {
    celula.dataset.pendente = 'nao';
    celula.classList.remove('pendente');
  }
}

function criarCelula(foto) {
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'celula';
  botao.dataset.id = foto.id;

  const img = document.createElement('img');
  img.src = `/media/thumb/${foto.id}`;
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  botao.appendChild(img);

  const selo = document.createElement('span');
  selo.className = 'selo';
  selo.textContent = 'oculta';
  botao.appendChild(selo);

  // Ver a foto grande sem alternar: o clique na lupa nao pode borbulhar para
  // o botao, senao abrir a foto tambem a ocultaria.
  const lupa = document.createElement('a');
  lupa.className = 'lupa';
  lupa.href = `/media/view/${foto.id}`;
  lupa.target = '_blank';
  lupa.rel = 'noopener';
  lupa.textContent = '🔍';
  lupa.setAttribute('aria-label', 'Ver a foto grande');
  lupa.addEventListener('click', (evento) => evento.stopPropagation());
  botao.appendChild(lupa);

  aplicarEstado(botao, foto.hidden);
  botao.addEventListener('click', () => alternar(botao, foto));

  celulas.set(foto.id, botao);
  return botao;
}

// --- Carregamento ----------------------------------------------------------

async function carregarMais() {
  if (carregando || acabou) return;
  carregando = true;

  try {
    const url = new URL('/admin/api/fotos', location.origin);
    url.searchParams.set('limit', String(POR_PAGINA));
    if (proximoCursor) url.searchParams.set('cursor', proximoCursor);

    const resposta = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resposta.ok) throw new Error('HTTP ' + resposta.status);

    const dados = await resposta.json();
    proximoCursor = dados.proximoCursor;
    acabou = dados.proximoCursor === null;

    for (const foto of dados.fotos) {
      if (celulas.has(foto.id)) continue;
      elementos.grade.appendChild(criarCelula(foto));
    }

    elementos.vazio.hidden = celulas.size > 0 || !acabou;
    mostrarAviso('');
  } catch (erro) {
    console.error('falha ao carregar as fotos', erro);
    mostrarAviso('não consegui carregar as fotos. Role a tela para tentar de novo.');
  } finally {
    carregando = false;
  }
}

const observador = new IntersectionObserver(
  (entradas) => {
    if (entradas.some((e) => e.isIntersecting)) carregarMais();
  },
  { rootMargin: '600px 0px' }
);
observador.observe(elementos.sentinela);

carregarResumo();
carregarMais();

// Durante a festa o painel fica aberto no celular: o espaco em disco precisa
// continuar atual sem ninguem recarregar a pagina.
setInterval(() => {
  if (document.visibilityState === 'visible') carregarResumo();
}, 60000);
