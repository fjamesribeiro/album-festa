'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const config = require('./config');

fs.mkdirSync(path.dirname(config.dirBanco), { recursive: true });

const banco = new Database(config.dirBanco);

// WAL melhora a leitura concorrente durante os picos de acesso. Com WAL,
// synchronous = NORMAL e seguro e evita um fsync por transacao.
banco.pragma('journal_mode = WAL');
banco.pragma('synchronous = NORMAL');
banco.pragma('foreign_keys = ON');

banco.exec(`
  CREATE TABLE IF NOT EXISTS fotos (
    id           TEXT PRIMARY KEY,        -- uuid v4, tambem e o nome do arquivo
    autor        TEXT,                    -- opcional, pode ser NULL
    bytes        INTEGER NOT NULL,
    largura      INTEGER,
    altura       INTEGER,
    criado_em    TEXT NOT NULL,           -- ISO 8601 UTC, hora do envio
    tirada_em    TEXT,                    -- data/hora de captura lida do EXIF
    ip           TEXT,
    hidden       INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_fotos_ordem
    ON fotos (hidden, criado_em DESC, id DESC);
`);

// O <canvas> do navegador apaga todo o EXIF na conversao, entao a data de
// captura e lida no cliente ANTES de converter e enviada junto. Coluna
// acrescentada ao schema original do SPEC por decisao do James.
// Guardada como hora local do aparelho ("2026-08-17T21:30:00", sem fuso):
// o EXIF nao registra fuso e a festa acontece em um lugar so.
const colunas = banco.prepare('PRAGMA table_info(fotos)').all().map((c) => c.name);
if (!colunas.includes('tirada_em')) {
  banco.exec('ALTER TABLE fotos ADD COLUMN tirada_em TEXT');
  console.log('[banco] coluna tirada_em acrescentada ao banco existente');
}

const inserirFoto = banco.prepare(`
  INSERT INTO fotos (id, autor, bytes, largura, altura, criado_em, tirada_em, ip, hidden)
  VALUES (@id, @autor, @bytes, @largura, @altura, @criado_em, @tirada_em, @ip, 0)
`);

const contarPublicadas = banco.prepare(
  'SELECT COUNT(*) AS total FROM fotos WHERE hidden = 0'
);

// Paginacao por cursor composto, nunca por OFFSET: com OFFSET, uma foto nova
// chegando entre duas paginas empurra o acervo e o convidado ve a mesma foto
// duas vezes ou pula uma. As colunas e a ordem batem exatamente com o indice
// idx_fotos_ordem, entao o SQLite percorre o indice sem ordenar nada.
//
// O campo ip NUNCA entra na projecao: e o unico dado do schema que nao pode
// sair para o convidado.
const CAMPOS_PUBLICOS = 'id, autor, largura, altura, criado_em, tirada_em';

const listarPrimeiraPagina = banco.prepare(`
  SELECT ${CAMPOS_PUBLICOS}
    FROM fotos
   WHERE hidden = 0
   ORDER BY criado_em DESC, id DESC
   LIMIT @limite
`);

// Varias fotos podem cair no mesmo milissegundo de criado_em durante um pico.
// Por isso o desempate por id — sem ele a paginacao repete ou pula fotos.
const listarAposCursor = banco.prepare(`
  SELECT ${CAMPOS_PUBLICOS}
    FROM fotos
   WHERE hidden = 0
     AND (criado_em < @criado_em OR (criado_em = @criado_em AND id < @id))
   ORDER BY criado_em DESC, id DESC
   LIMIT @limite
`);

// Fecha o banco de forma limpa no shutdown, senao o WAL fica pendente.
function fechar() {
  try {
    banco.close();
  } catch (erro) {
    console.error('[banco] falha ao fechar', erro);
  }
}

module.exports = {
  banco,
  inserirFoto,
  contarPublicadas,
  listarPrimeiraPagina,
  listarAposCursor,
  fechar,
};
