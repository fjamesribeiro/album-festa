# SPEC.md — Álbum da Festa

Especificação de implementação. Trabalhe fase por fase.

---

## 1. Decisões já travadas

Não reabrir sem me perguntar:

- Apenas fotos. Nada de vídeo.
- Sem login. Acesso controlado por token na query string (`/?k=TOKEN`).
- A galeria é visível para quem tem o link. Fotos ocultadas não aparecem.
- Botão flutuante de upload sempre visível, inclusive durante o scroll.
- Contador de fotos visível no topo.
- Moderação **reativa**: a foto entra publicada e o admin oculta se necessário.
  Não implementar fila de aprovação.
- Convidado não baixa em lote. Só foto a foto, pelo lightbox.
- Nome do convidado é **opcional**: pedido uma única vez, guardado em
  `localStorage`, enviado junto com as fotos seguintes.

## 2. Conversão no cliente é obrigatória

Antes de enviar, o navegador converte cada arquivo via `<canvas>`:

- lê o `DateTimeOriginal` do EXIF **antes de converter** e envia no campo
  `tirada_em` — o `<canvas>` apaga todo o metadado, então essa é a única
  chance de saber quando a foto foi tirada
- redimensiona para no máximo **2560px** no lado maior (não amplia)
- exporta em **JPEG qualidade 0.90**
- corrige a orientação a partir do EXIF antes de desenhar no canvas

Motivo: o `sharp` não lê HEIC sem `libheif` compilada, e alguns celulares
enviam HEIC cru. Convertendo no cliente, o servidor só recebe JPEG e o problema
deixa de existir. O servidor deve mesmo assim rejeitar o que não for JPEG/PNG,
validando pelos **magic bytes** e não pela extensão.

## 3. Banco

```sql
CREATE TABLE fotos (
  id           TEXT PRIMARY KEY,        -- uuid v4, também é o nome do arquivo
  autor        TEXT,                    -- opcional, pode ser NULL
  bytes        INTEGER NOT NULL,
  largura      INTEGER,
  altura       INTEGER,
  criado_em    TEXT NOT NULL,           -- ISO 8601 UTC, hora do envio
  tirada_em    TEXT,                    -- captura, hora local sem fuso; NULL
                                        -- quando a foto não tem EXIF
  ip           TEXT,
  hidden       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_fotos_ordem ON fotos (hidden, criado_em DESC, id DESC);
```

Ative WAL (`PRAGMA journal_mode = WAL`) — melhora leitura concorrente durante os
picos de acesso.

## 4. Derivadas de imagem

No upload, o `sharp` gera e grava em disco:

| Nome    | Formato | Tamanho          | Uso                     |
|---------|---------|------------------|-------------------------|
| `thumb` | WebP    | 400px, q75       | grid da galeria         |
| `view`  | JPEG    | 1600px, q82      | lightbox                |
| `orig`  | como recebido | —          | botão de baixar         |

A derivada `view` recebe `.withExif()` com a data vinda de `tirada_em` e
`Orientation: 1` — não há EXIF de origem a preservar, porque o `<canvas>` do
cliente já o descartou. O arquivo `orig` não é reescrito, mas seu `mtime` é
ajustado para a data da foto, para o ZIP do admin sair na ordem certa.
Concorrência máxima de 2 no processamento.

Estrutura: `dados/midia/{thumb,view,orig}/{uuid}.{ext}` e `dados/album.db`.
Um único volume Docker cobre os dois.

## 5. Rotas

```
GET  /?k=TOKEN                    → galeria (token inválido = 404 genérico)
GET  /api/fotos?cursor=&limit=30  → lista, mais recentes primeiro, hidden=0
POST /api/upload                  → multipart, até 10 arquivos por requisição
GET  /media/:variante/:id         → thumb | view | orig
GET  /admin                       → basic auth
POST /admin/fotos/:id/hidden      → alterna visibilidade
GET  /admin/zip                   → ZIP de todos os originais (só admin)
```

Paginação por cursor composto (`criado_em` + `id`), nunca por OFFSET.
`/api/fotos` retorna também o total publicado, para o contador.

## 6. Interface do convidado

**Cabeçalho fixo:** nome da aniversariante e o contador ("247 fotos").

**Grid:** `repeat(auto-fill, minmax(110px, 1fr))`, `aspect-ratio: 1`,
`object-fit: cover`, `loading="lazy"` nativo. Scroll infinito via
`IntersectionObserver`. Sem estado vazio genérico: quando não houver fotos,
convide a enviar a primeira.

**Botão flutuante:**
- `position: fixed; bottom: calc(20px + env(safe-area-inset-bottom))`
  — sem o `env()` ele fica atrás da barra do Safari no iPhone
- `z-index` acima de tudo, permanece visível durante o scroll infinito
- dispara um `<input type="file" accept="image/*" multiple hidden>` via `.click()`
- o container do grid precisa de `padding-bottom` para a última fileira não
  ficar coberta

**Upload:**
- **sequencial, um arquivo por vez.** Paralelo derruba o Wi-Fi do salão
- progresso via `XMLHttpRequest` (`fetch` não expõe progresso de upload)
- durante o envio o botão flutuante vira barra de progresso no mesmo lugar,
  para o convidado não perder o que estava vendo
- ao terminar, confirmação explícita ("✓ 8 fotos enviadas, obrigado!") e as
  novas fotos aparecem no topo do grid sem recarregar a página
- se um arquivo falhar, os demais continuam; ofereça tentar de novo só o que
  falhou

**Lightbox:** abre a derivada `view`, navegação por swipe e por teclado, botão
de baixar apontando para `orig` com atributo `download`.

**Atualização:** ao ganhar foco e a cada 30s, apenas com
`document.visibilityState === 'visible'`. Sem websocket.

## 7. Admin

Basic auth com usuário e senha vindos do ambiente. Grid das fotos incluindo as
ocultas, visualmente diferenciadas, com botão de ocultar/reexibir de um toque —
precisa ser rápido de usar num celular durante a festa. Mostrar contagem de
publicadas e ocultas, e espaço em disco livre.

## 8. Robustez

- `express-rate-limit`: 30 uploads por IP a cada 15 minutos
- limite de 12 MB por arquivo no multer, alinhado com o `request_body max_size`
  do Caddy — se divergirem, o erro que chega ao convidado é incompreensível
- antes de aceitar upload, verificar espaço livre em disco; abaixo de 2 GB,
  recusar com mensagem clara e logar em nível de alerta
- `Cache-Control: public, max-age=31536000, immutable` em `/media` (nomes são
  UUID, portanto imutáveis)
- `helmet`, sem directory listing, sem execução no diretório de mídia
- log estruturado de cada upload: id, autor, bytes, ip, duração

## 9. Operação

- `docker-compose.yml` com `restart: unless-stopped`
- `Caddyfile` com TLS automático
- `.env.example` completo e comentado
- script de backup diário: `tar` da pasta de dados + cópia do SQLite
- `README.md` curto: subir local, subir na VPS, gerar o QR code, baixar tudo
  depois da festa

## 10. Fases

Uma por vez, cada uma rodando antes da seguinte.

1. **Esqueleto e upload.** Servidor, SQLite, rota de upload, derivadas do sharp,
   página mínima que envia e confirma. Sem galeria ainda.
2. **Galeria.** Listagem paginada, grid, lazy loading, lightbox, contador,
   botão flutuante com progresso.
3. **Admin e moderação.** Basic auth, ocultar/reexibir, ZIP, espaço em disco.
4. **Robustez.** Rate limit, limites de tamanho, verificação de disco, cache,
   helmet, logs.
5. **Deploy.** Docker Compose, Caddyfile, backup, README.

## 11. Critérios de aceite

Verificáveis, num celular real:

- [ ] Enviar 8 fotos de uma vez pelo iPhone e pelo Android, com progresso visível
- [ ] Foto tirada em modo retrato aparece na orientação correta no grid
- [ ] Grid com 300 fotos carrega em menos de 3 segundos no 4G
- [ ] Botão flutuante permanece acessível depois de rolar até o fim
- [ ] Contador reflete o número real de fotos publicadas
- [ ] Ocultar uma foto no admin a remove da galeria do convidado ao atualizar
- [ ] Derrubar o container e ele volta sozinho, sem perder dados
- [ ] Reiniciar a VPS e o serviço volta sozinho
- [ ] Acessar sem token ou com token errado não revela nada
