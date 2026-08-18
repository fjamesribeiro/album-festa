#!/usr/bin/env bash
#
# Backup diario do album. Roda no host, pelo cron.
#
# ARMADILHA QUE ESTE SCRIPT EVITA: com WAL ligado, copiar album.db com `cp` ou
# `tar` pode produzir um arquivo corrompido — parte das transacoes vive no
# album.db-wal e a copia pega os dois em instantes diferentes. Por isso o banco
# sai pela API de backup do SQLite, que gera um arquivo consistente mesmo com o
# servidor gravando ao mesmo tempo. As fotos, essas sim, sao arquivos imutaveis
# e podem ir num tar comum.

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR_DADOS="${DIR_DADOS:-$RAIZ/dados}"
DIR_BACKUP="${DIR_BACKUP:-$RAIZ/backups}"
DIAS_PARA_GUARDAR="${DIAS_PARA_GUARDAR:-7}"

CARIMBO="$(date +%Y-%m-%d_%H%M)"
DESTINO="$DIR_BACKUP/$CARIMBO"

log() { echo "[backup $(date '+%Y-%m-%d %H:%M:%S')] $*"; }

if [ ! -f "$DIR_DADOS/album.db" ]; then
  log "ERRO: nao achei $DIR_DADOS/album.db"
  exit 1
fi

mkdir -p "$DESTINO"
cd "$RAIZ"

# --- Banco, pela API de backup do SQLite -----------------------------------
log "copiando o banco de forma consistente (API de backup, nao cp)..."
docker compose exec -T album node -e "
  const Database = require('better-sqlite3');
  const banco = new Database('/app/dados/album.db', { readonly: true });
  const fotos = banco.prepare('SELECT COUNT(*) c FROM fotos').get().c;
  banco.backup('/app/dados/.backup-temporario.db')
    .then(() => {
      const copia = new Database('/app/dados/.backup-temporario.db', { readonly: true });
      const ok = copia.pragma('integrity_check', { simple: true });
      const copiadas = copia.prepare('SELECT COUNT(*) c FROM fotos').get().c;
      copia.close();
      banco.close();
      // Confere a copia agora: backup corrompido descoberto so na restauracao
      // nao serve para nada.
      if (ok !== 'ok' || copiadas !== fotos) {
        console.error('copia inconsistente: integridade=' + ok + ' fotos=' + copiadas + '/' + fotos);
        process.exit(1);
      }
      console.log(fotos);
    })
    .catch((e) => { console.error(e.message); process.exit(1); });
" > "$DESTINO/.contagem"

FOTOS="$(tr -d '[:space:]' < "$DESTINO/.contagem")"
rm -f "$DESTINO/.contagem"

mv "$DIR_DADOS/.backup-temporario.db" "$DESTINO/album.db"
log "banco copiado e conferido: $FOTOS fotos"

# --- Midia -----------------------------------------------------------------
log "empacotando as fotos..."
tar -czf "$DESTINO/midia.tar.gz" -C "$DIR_DADOS" midia

# --- Rotacao ---------------------------------------------------------------
# Sem isso o disco enche em silencio: cada backup guarda o acervo inteiro.
log "removendo backups com mais de $DIAS_PARA_GUARDAR dias..."
find "$DIR_BACKUP" -maxdepth 1 -type d -name '20*' -mtime "+$DIAS_PARA_GUARDAR" \
  -exec rm -rf {} + 2>/dev/null || true

TAMANHO="$(du -sh "$DESTINO" | cut -f1)"
LIVRE="$(df -h "$DIR_BACKUP" | awk 'NR==2 {print $4}')"
log "pronto: $DESTINO ($TAMANHO, $FOTOS fotos) | disco livre: $LIVRE"
