'use strict';

const crypto = require('node:crypto');

const config = require('./config');

// Basic auth do painel. Feito a mao em vez de mais uma dependencia: sao ~40
// linhas e o formato do cabecalho e trivial.
//
// A vantagem pratica do basic auth aqui e que o proprio navegador guarda a
// credencial depois do primeiro acesso — durante a festa o admin abre /admin
// no celular e ja entra, sem tela de login para preencher no escuro.

const USUARIO = Buffer.from(config.adminUsuario, 'utf8');
const SENHA = Buffer.from(config.adminSenha, 'utf8');

// Comprimentos diferentes nao passam pelo timingSafeEqual. Comparar antes nao
// entrega nada: o tamanho da senha nao e o segredo.
function iguais(recebido, esperado) {
  const bufer = Buffer.from(recebido, 'utf8');
  if (bufer.length !== esperado.length) return false;
  return crypto.timingSafeEqual(bufer, esperado);
}

function credencialConfere(cabecalho) {
  if (typeof cabecalho !== 'string' || !cabecalho.startsWith('Basic ')) return false;

  let decodificado;
  try {
    decodificado = Buffer.from(cabecalho.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }

  // A senha pode conter ":", o usuario nao — por isso separa no primeiro.
  const separador = decodificado.indexOf(':');
  if (separador < 0) return false;

  const usuario = decodificado.slice(0, separador);
  const senha = decodificado.slice(separador + 1);

  // Os dois sao sempre avaliados: sair no primeiro que falha entregaria por
  // tempo de resposta se o usuario estava certo.
  const usuarioOk = iguais(usuario, USUARIO);
  const senhaOk = iguais(senha, SENHA);

  return usuarioOk && senhaOk;
}

function exigirAdmin(req, res, proximo) {
  if (credencialConfere(req.headers.authorization)) return proximo();

  console.warn('[admin] acesso recusado', {
    caminho: req.path,
    ip: req.ip,
    tinha_credencial: req.headers.authorization !== undefined,
  });

  // O WWW-Authenticate e o que faz o navegador abrir a caixa de usuario e
  // senha sozinho, em vez de mostrar um 401 cru.
  res.set('WWW-Authenticate', 'Basic realm="Album da festa", charset="UTF-8"');
  return res.status(401).json({ erro: 'preciso de usuário e senha para abrir isso' });
}

// Basic auth fica guardado no navegador, entao um site qualquer poderia
// disparar POST /admin/fotos/:id/hidden e o navegador anexaria a credencial
// sozinho. Exigir origem propria fecha isso sem inventar token de CSRF.
function exigirMesmaOrigem(req, res, proximo) {
  const origem = req.headers.origin;

  // Sem Origin (navegacao direta, curl) nao ha risco de CSRF: o ataque
  // depende de uma pagina de terceiro fazendo a requisicao.
  if (origem === undefined) return proximo();

  let mesma = false;
  try {
    mesma = new URL(origem).host === req.headers.host;
  } catch {
    mesma = false;
  }

  if (mesma) return proximo();

  console.warn('[admin] origem cruzada recusada', { origem, host: req.headers.host, ip: req.ip });
  return res.status(403).json({ erro: 'essa requisição não veio do painel' });
}

module.exports = { exigirAdmin, exigirMesmaOrigem };
