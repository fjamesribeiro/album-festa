'use strict';

// Album da festa — envio de fotos.
// A conversao no cliente e obrigatoria: alguns celulares mandam HEIC cru, e o
// sharp no servidor nao le HEIC. Convertendo aqui para JPEG, o servidor so
// recebe formato que ele sabe processar.

(function () {
  const LADO_MAXIMO = 2560;
  const QUALIDADE = 0.9;
  const CHAVE_AUTOR = 'album.autor';

  const elementos = {
    botao: document.getElementById('enviar'),
    rotulo: document.getElementById('rotulo-enviar'),
    progresso: document.getElementById('progresso'),
    barra: document.getElementById('progresso-barra'),
    entrada: document.getElementById('arquivos'),
    autor: document.getElementById('autor'),
    status: document.getElementById('status'),
    falhas: document.getElementById('lista-falhas'),
    tentarDeNovo: document.getElementById('tentar-de-novo'),
  };

  let enviando = false;
  let arquivosQueFalharam = [];

  // --- Nome do convidado: pedido uma vez, guardado no aparelho --------------

  elementos.autor.value = localStorage.getItem(CHAVE_AUTOR) || '';

  elementos.autor.addEventListener('change', function () {
    const valor = elementos.autor.value.trim();
    if (valor) {
      localStorage.setItem(CHAVE_AUTOR, valor);
    } else {
      localStorage.removeItem(CHAVE_AUTOR);
    }
  });

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
      requisicao.open('POST', '/api/upload');
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

  // --- Interface -----------------------------------------------------------

  function mostrarStatus(texto, classe) {
    elementos.status.textContent = texto;
    elementos.status.className = 'status' + (classe ? ' ' + classe : '');
  }

  function atualizarProgresso(indice, total, fracao) {
    // Cada foto ocupa uma fatia igual da barra.
    const percentual = ((indice + fracao) / total) * 100;
    elementos.barra.style.width = percentual.toFixed(1) + '%';
    elementos.rotulo.textContent = 'Enviando foto ' + (indice + 1) + ' de ' + total + '…';
  }

  function mostrarFalhas(falhas) {
    arquivosQueFalharam = falhas.map(function (f) { return f.arquivo; });

    if (falhas.length === 0) {
      elementos.falhas.hidden = true;
      elementos.tentarDeNovo.hidden = true;
      elementos.falhas.textContent = '';
      return;
    }

    elementos.falhas.textContent = '';
    falhas.forEach(function (falha) {
      const item = document.createElement('li');
      const nome = document.createElement('b');
      nome.textContent = falha.arquivo.name || 'foto';
      item.appendChild(nome);
      item.appendChild(document.createTextNode(' — ' + falha.motivo));
      elementos.falhas.appendChild(item);
    });

    elementos.falhas.hidden = false;
    elementos.tentarDeNovo.hidden = false;
  }

  function entrarEmModoEnvio(ligado) {
    enviando = ligado;
    elementos.botao.disabled = ligado;
    elementos.progresso.hidden = !ligado;
    if (!ligado) {
      elementos.rotulo.textContent = 'Enviar fotos';
      elementos.barra.style.width = '0%';
    }
  }

  // Sequencial, um arquivo por vez: paralelo derruba o Wi-Fi do salao.
  async function enviarTodos(arquivos) {
    if (enviando || arquivos.length === 0) return;

    entrarEmModoEnvio(true);
    mostrarFalhas([]);

    const autor = elementos.autor.value.trim();
    if (autor) localStorage.setItem(CHAVE_AUTOR, autor);

    const falhas = [];
    let enviadas = 0;

    for (let i = 0; i < arquivos.length; i += 1) {
      const arquivo = arquivos[i];
      atualizarProgresso(i, arquivos.length, 0);

      try {
        // A data sai do arquivo original, antes de o canvas apagar o EXIF.
        const tiradaEm = await lerDataDeCaptura(arquivo);
        const blob = await converterParaJpeg(arquivo);
        await enviarUm(blob, nomeDeSaida(arquivo.name), autor, tiradaEm, function (fracao) {
          atualizarProgresso(i, arquivos.length, fracao);
        });
        enviadas += 1;
      } catch (erro) {
        // Uma foto que falha nao interrompe as outras.
        console.error('falha ao enviar', arquivo.name, erro);
        falhas.push({ arquivo: arquivo, motivo: erro.message });
      }

      atualizarProgresso(i, arquivos.length, 1);
    }

    entrarEmModoEnvio(false);
    mostrarFalhas(falhas);

    if (enviadas > 0 && falhas.length === 0) {
      mostrarStatus(
        '✓ ' + enviadas + (enviadas === 1 ? ' foto enviada' : ' fotos enviadas') + ', obrigado!',
        'sucesso'
      );
    } else if (enviadas > 0) {
      mostrarStatus(
        '✓ ' + enviadas + (enviadas === 1 ? ' foto enviada' : ' fotos enviadas') + '. ' +
          falhas.length + (falhas.length === 1 ? ' não subiu:' : ' não subiram:'),
        'sucesso'
      );
    } else {
      mostrarStatus('Não consegui enviar. Veja abaixo o que houve:', 'erro');
    }
  }

  elementos.botao.addEventListener('click', function () {
    if (enviando) return;
    elementos.entrada.click();
  });

  elementos.entrada.addEventListener('change', function () {
    const arquivos = Array.from(elementos.entrada.files || []);
    // Zera para permitir escolher o mesmo arquivo de novo depois.
    elementos.entrada.value = '';
    enviarTodos(arquivos);
  });

  elementos.tentarDeNovo.addEventListener('click', function () {
    const repetir = arquivosQueFalharam.slice();
    if (repetir.length > 0) enviarTodos(repetir);
  });
})();
