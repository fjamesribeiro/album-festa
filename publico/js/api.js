// Conversa com o servidor. Concentra o token num lugar so.

// O token vem do link que o convidado escaneou no QR code da mesa e fica so
// aqui. Nao gravamos em localStorage: quem perder o link escaneia de novo, e
// o QR esta na mesa a noite inteira.
const TOKEN = new URLSearchParams(location.search).get('k') || '';

function comToken(caminho, parametros = {}) {
  const url = new URL(caminho, location.origin);
  url.searchParams.set('k', TOKEN);
  for (const [chave, valor] of Object.entries(parametros)) {
    if (valor !== null && valor !== undefined && valor !== '') {
      url.searchParams.set(chave, valor);
    }
  }
  return url.toString();
}

// As derivadas nao levam token: o nome e UUID v4, impossivel de adivinhar ou
// listar. Assim o link de uma foto continua abrindo quando alguem compartilha,
// e o token nao vai parar em todo log de acesso de imagem.
function urlMidia(variante, id) {
  return `/media/${variante}/${id}`;
}

function urlUpload() {
  return comToken('/api/upload');
}

async function buscarFotos({ cursor = null, limite = 30 } = {}) {
  const resposta = await fetch(comToken('/api/fotos', { cursor, limit: limite }), {
    headers: { Accept: 'application/json' },
  });

  if (!resposta.ok) {
    const erro = new Error('não consegui carregar as fotos');
    erro.status = resposta.status;
    throw erro;
  }

  return resposta.json();
}

export { urlMidia, urlUpload, buscarFotos };
