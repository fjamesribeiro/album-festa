// Leitura da data de captura do EXIF.
//
// Movido de publico/app.js sem alteracao de logica: este parser foi validado
// em 9 casos (big-endian do iPhone, little-endian de Android, DateTime da
// IFD0 como ultimo recurso, e entradas corrompidas devolvendo null sem
// excecao) e em fotos reais enviadas de celular. Mexer nele e risco sem ganho.

// --- Leitura da data de captura ------------------------------------------
// Precisa acontecer ANTES da conversao: o <canvas> descarta todo o EXIF.
// Parser minimo de JPEG/EXIF, so o suficiente para achar DateTimeOriginal —
// nao vale uma dependencia nova por causa disso.

var CABECALHO_BYTES = 256 * 1024; // o bloco EXIF fica no inicio do arquivo

// Percorre uma IFD procurando uma etiqueta. Devolve tipo, contagem e onde
// esta o campo de valor.
function acharEtiqueta(dados, ifd, etiquetaAlvo, littleEndian) {
  if (ifd + 2 > dados.byteLength) return null;
  var quantas = dados.getUint16(ifd, littleEndian);
  for (var i = 0; i < quantas; i += 1) {
    var entrada = ifd + 2 + i * 12;
    if (entrada + 12 > dados.byteLength) return null;
    if (dados.getUint16(entrada, littleEndian) !== etiquetaAlvo) continue;
    return {
      tipo: dados.getUint16(entrada + 2, littleEndian),
      contagem: dados.getUint32(entrada + 4, littleEndian),
      campo: entrada + 8,
    };
  }
  return null;
}

function lerTexto(dados, base, ifd, etiqueta, littleEndian) {
  var achado = acharEtiqueta(dados, ifd, etiqueta, littleEndian);
  if (!achado || achado.tipo !== 2 || achado.contagem === 0) return null;
  // Valor de ate 4 bytes cabe no proprio campo; acima disso, o campo guarda
  // um deslocamento a partir do inicio do bloco TIFF.
  var inicio = achado.contagem <= 4 ? achado.campo : base + dados.getUint32(achado.campo, littleEndian);
  if (inicio + achado.contagem > dados.byteLength) return null;
  var texto = '';
  for (var j = 0; j < achado.contagem; j += 1) {
    var codigo = dados.getUint8(inicio + j);
    if (codigo === 0) break;
    texto += String.fromCharCode(codigo);
  }
  return texto || null;
}

function lerBlocoTiff(dados, base) {
  if (base + 8 > dados.byteLength) return null;

  var ordem = dados.getUint16(base);
  var littleEndian;
  if (ordem === 0x4949) littleEndian = true;        // "II"
  else if (ordem === 0x4d4d) littleEndian = false;  // "MM"
  else return null;

  if (dados.getUint16(base + 2, littleEndian) !== 0x002a) return null;
  var ifd0 = base + dados.getUint32(base + 4, littleEndian);

  // DateTimeOriginal (0x9003) mora na sub-IFD apontada por 0x8769.
  var ponteiro = acharEtiqueta(dados, ifd0, 0x8769, littleEndian);
  if (ponteiro && ponteiro.tipo === 4) {
    var sub = base + dados.getUint32(ponteiro.campo, littleEndian);
    var data =
      lerTexto(dados, base, sub, 0x9003, littleEndian) ||
      lerTexto(dados, base, sub, 0x9004, littleEndian);
    if (data) return data;
  }
  // Ultimo recurso: DateTime (0x0132) na IFD0.
  return lerTexto(dados, base, ifd0, 0x0132, littleEndian);
}

function extrairDataDoJpeg(buffer) {
  var dados = new DataView(buffer);
  if (dados.byteLength < 4 || dados.getUint16(0) !== 0xffd8) return null; // nao e JPEG

  var posicao = 2;
  while (posicao + 4 <= dados.byteLength) {
    if (dados.getUint8(posicao) !== 0xff) return null; // fora de sincronia
    var marcador = dados.getUint8(posicao + 1);

    // Marcadores sem carga.
    if (marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd9)) {
      posicao += 2;
      continue;
    }
    // Comecou a imagem: nao ha mais metadado adiante.
    if (marcador === 0xda) return null;

    var tamanho = dados.getUint16(posicao + 2);
    if (tamanho < 2) return null;

    if (marcador === 0xe1) {
      var carga = posicao + 4;
      // Confere a assinatura "Exif\0\0".
      if (
        carga + 6 <= dados.byteLength &&
        dados.getUint32(carga) === 0x45786966 &&
        dados.getUint16(carga + 4) === 0x0000
      ) {
        return lerBlocoTiff(dados, carga + 6);
      }
    }
    posicao += 2 + tamanho;
  }
  return null;
}

// "2026:08:17 21:30:00" -> "2026-08-17T21:30:00". Hora local do aparelho:
// o EXIF nao registra fuso, e a festa acontece em um lugar so.
function normalizarData(bruta) {
  var partes = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(bruta || '');
  if (!partes) return null;
  if (partes[1] === '0000' || partes[2] === '00' || partes[3] === '00') return null;
  return partes[1] + '-' + partes[2] + '-' + partes[3] + 'T' + partes[4] + ':' + partes[5] + ':' + partes[6];
}

async function lerDataDeCaptura(arquivo) {
  try {
    var pedaco = arquivo.slice(0, CABECALHO_BYTES);
    var buffer = await pedaco.arrayBuffer();
    return normalizarData(extrairDataDoJpeg(buffer));
  } catch (erro) {
    // Sem data a foto sobe do mesmo jeito. Nunca derrubar o envio por isso.
    return null;
  }
}

export { lerDataDeCaptura, extrairDataDoJpeg, normalizarData };
