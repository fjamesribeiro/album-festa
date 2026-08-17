'use strict';

const helmet = require('helmet');

const config = require('./config');

// Cabecalhos de seguranca. O helmet traz padroes bons, mas dois deles
// quebrariam este projeto se ficassem como vem de fabrica — estao ajustados
// abaixo com o motivo.

const seguranca = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],

      // blob: e obrigatorio aqui. O caminho reserva da conversao no cliente
      // (publico/js/envio.js, funcao carregarImagem) usa URL.createObjectURL
      // e coloca o resultado num <img>. Sem blob:, o envio quebraria
      // justamente nos Safari antigos, que sao quem depende desse caminho.
      imgSrc: ["'self'", 'blob:', 'data:'],

      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],

      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],

      // upgrade-insecure-requests fica de fora de proposito: ligado, o
      // navegador troca http por https sozinho e a pagina para de abrir em
      // desenvolvimento e no teste pela rede local. O Caddy ja redireciona
      // http para https em producao, que e onde isso importa.
    },
  },

  // HSTS so atras de TLS de verdade. Ligado sem https, nao faz nada de util e
  // atrapalha o teste local.
  strictTransportSecurity: config.tlsAtivo
    ? { maxAge: 15552000, includeSubDomains: true }
    : false,

  // Nao vaza o token da query string (/?k=TOKEN) em nenhum Referer.
  referrerPolicy: { policy: 'no-referrer' },

  // nosniff: mesmo aceitando so JPEG e PNG validados por magic bytes, impede
  // que o navegador resolva interpretar um arquivo de /media como HTML.
  xContentTypeOptions: true,

  // Nao ha uso legitimo do album dentro de um iframe de terceiro.
  xFrameOptions: { action: 'deny' },
});

module.exports = { seguranca };
