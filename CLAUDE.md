# CLAUDE.md — Álbum da Festa

Contexto permanente deste repositório. Leia antes de qualquer alteração.

## O que é

Álbum colaborativo de fotos para uma festa de 15 anos. Convidados escaneiam um
QR code na mesa, abrem uma página no navegador do celular, veem as fotos já
enviadas e enviam as suas. Sem app, sem login, sem cadastro.

O evento é único e tem data marcada. Isso define todas as prioridades abaixo.

## Prioridades, nesta ordem

1. **Não falhar no dia.** Um recurso a mais que quebra vale menos que um recurso
   a menos que funciona. Se houver dúvida entre robusto e sofisticado, robusto.
2. **Zero fricção para o convidado.** Público leigo, celular na mão, ambiente
   escuro, rede ruim. Qualquer passo extra derruba a taxa de envio.
3. **Simplicidade operacional.** Roda numa VPS pequena, sem ninguém de plantão.

## Stack — não substituir sem pedir

- Node.js LTS + Express
- SQLite (`better-sqlite3`) — banco em arquivo, sem servidor de banco
- `multer` para multipart, `sharp` para derivadas de imagem
- Frontend: HTML, CSS e JavaScript puros. **Sem React, sem framework, sem build
  step.** São duas telas.
- Caddy como reverse proxy (TLS automático)
- Deploy: Docker Compose na VPS

Evite dependências novas. Cada pacote a mais é uma superfície de falha. Se
precisar de uma, justifique antes de instalar.

## Restrições de ambiente

- VPS Hostinger KVM 2, Linux. Recursos modestos: **limite a concorrência de
  processamento de imagem a 2**, senão o sharp satura a CPU durante um pico de
  uploads.
- Armazenamento em disco local. Nada de S3 ou serviço externo.
- Desenvolvimento em WSL2 no Windows 11 com VS Code.
- Custo zero: nenhuma dependência de serviço pago.

## Convenções

- Código, comentários, mensagens de commit e textos de interface em
  **português do Brasil**.
- Nomes de arquivo salvos em disco são UUID v4. Nunca confie no nome enviado
  pelo cliente.
- Toda configuração vem de variáveis de ambiente, com `.env.example` versionado
  e `.env` no `.gitignore`. Nenhum segredo hardcoded.
- Erros de servidor sempre logados com contexto; erros mostrados ao convidado
  sempre em linguagem humana ("não consegui enviar essa foto, tente de novo").

## Como trabalhar aqui

- Implemente **uma fase por vez**, conforme o `SPEC.md`. Não avance para a
  próxima sem que a anterior rode.
- Ao fim de cada fase: suba o servidor, exercite o fluxo de verdade e me mostre
  o resultado. Não declare pronto sem ter executado.
- Ao concluir uma fase, liste o que ficou fora e o que precisa de decisão minha.

## Fora de escopo — não implemente

- Vídeos (apenas fotos)
- Login, contas ou autenticação de convidado
- Mural ao vivo em telão
- Gamificação por mesa
- Download em lote pelos convidados
- Notificações, e-mail, integrações externas
