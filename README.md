# Álbum da Festa

Álbum colaborativo de fotos. O convidado escaneia o QR code da mesa, vê as fotos
já enviadas e manda as dele. Sem app, sem login, sem cadastro.

- **Convidado:** `https://SEU-ENDERECO/?k=TOKEN`
- **Moderação:** `https://SEU-ENDERECO/admin` (usuário e senha do `.env`)

---

## Rodar na sua máquina

```bash
npm install
cp .env.example .env
```

Preencha no `.env` pelo menos `NOME_ANIVERSARIANTE`, `ALBUM_TOKEN`,
`ADMIN_USUARIO` e `ADMIN_SENHA` — o servidor **se recusa a subir** sem os três
últimos, de propósito. Para gerar segredos:

```bash
node -e "console.log(require('crypto').randomBytes(16).toString('base64url'))"
```

```bash
npm run dev     # recarrega ao salvar
npm start
```

Abra `http://localhost:3000/?k=SEU_TOKEN`. Sem o token a página devolve 404 —
isso é o esperado, não um defeito.

**Testar do celular na mesma Wi-Fi:** descubra o IP da máquina
(`hostname -I`) e abra `http://SEU_IP:3000/?k=TOKEN`. No WSL2 em modo
*mirrored*, as portas ficam bloqueadas por padrão; libere só a 3000 na LAN:

```powershell
# PowerShell como administrador, no Windows
New-NetFirewallRule -DisplayName "Album da Festa (3000)" -Direction Inbound `
  -Protocol TCP -LocalPort 3000 -RemoteAddress LocalSubnet -Action Allow
New-NetFirewallHyperVRule -Name "AlbumFesta3000" -DisplayName "Album da Festa (3000)" `
  -Direction Inbound -VMCreatorId "{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}" `
  -Protocol TCP -LocalPorts 3000 -Action Allow
```

---

## Subir na VPS

Esta VPS **já roda outra aplicação** (`movibes.pro`, Django atrás de
nginx/1.24.0) nas portas 80 e 443. Por isso o álbum **não** usa Caddy: ele sobe
em Docker escutando apenas em `127.0.0.1:3000`, e o nginx que já existe ganha um
`server` novo apontando para ele. Nada da configuração do `movibes.pro` é
alterado.

> SSH desta VPS está na **porta 22022**, não na 22.

### 1. Pré-voo (só leitura, não muda nada)

```bash
ssh -p 22022 root@103.199.184.110

docker --version && docker compose version   # se faltar, passo 2
systemctl is-enabled docker                  # precisa dizer "enabled"
nginx -v
ss -ltnp | grep -E ':(80|443|3000)'          # a 3000 tem que estar livre
df -h /                                      # espaço para as fotos
```

### 2. Docker, se ainda não houver

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
```

### 3. Código e configuração

```bash
mkdir -p /opt/album-festa && cd /opt/album-festa
# copie o projeto (git clone, scp -P 22022, ou rsync -e 'ssh -p 22022')

cp .env.example .env
nano .env    # NOME_ANIVERSARIANTE, ALBUM_TOKEN, ADMIN_USUARIO, ADMIN_SENHA
```

Use segredos **diferentes** dos de desenvolvimento.

### 4. Subir o container

```bash
mkdir -p dados
# O container roda como usuário sem privilégio (UID 1000). Sem este chown ele
# não consegue gravar no volume e sobe só para morrer em seguida.
chown -R 1000:1000 dados

docker compose up -d --build
docker compose logs -f          # espere "[boot] album no ar"
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/    # 404 = certo
```

### 5. nginx e certificado

```bash
cp deploy/nginx-album.conf /etc/nginx/sites-available/album
ln -s /etc/nginx/sites-available/album /etc/nginx/sites-enabled/album

nginx -t          # NUNCA recarregue sem este teste passar
systemctl reload nginx
```

O arquivo já aponta para certificados que ainda não existem, então o `nginx -t`
vai falhar até o certbot rodar. Emita primeiro:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d srv1325413.hstgr.cloud

nginx -t && systemctl reload nginx
```

`srv1325413.hstgr.cloud` é o hostname que a Hostinger já aponta para o IP desta
VPS — não é preciso comprar domínio. Ele está na Public Suffix List, então tem
cota própria no Let's Encrypt.

**Confirme que o `movibes.pro` continua no ar** depois do reload:

```bash
curl -sI https://movibes.pro/ | head -1
curl -sI https://srv1325413.hstgr.cloud/ | head -1
```

### 6. Backup diário

```bash
crontab -e
```

```cron
30 4 * * * cd /opt/album-festa && ./scripts/backup.sh >> /var/log/album-backup.log 2>&1
```

Rode uma vez à mão antes de confiar nele:

```bash
./scripts/backup.sh
```

Guarda 7 dias por padrão (`DIAS_PARA_GUARDAR`). O banco sai pela API de backup
do SQLite, não por `cp` — com WAL ligado, copiar o arquivo direto pode gerar uma
cópia corrompida.

---

## QR code da mesa

```bash
ENDERECO_PUBLICO=https://srv1325413.hstgr.cloud npm run qr
```

Gera `qr/album.svg` (vetorial, para imprimir em qualquer tamanho) e
`qr/album.png`, e desenha o código no terminal para você conferir escaneando
antes de mandar imprimir.

**O QR contém o token, que é a senha do álbum.** Por isso ele é gerado aqui e
não num site de QR code — colar essa URL num serviço de terceiro entrega o
acesso ao álbum. A pasta `qr/` está no `.gitignore`.

Imprima grande, teste no escuro e com o celular a uns 30 cm.

---

## Depois da festa

Baixar tudo, pelo painel:

```
https://srv1325413.hstgr.cloud/admin  →  "Baixar tudo (.zip)"
```

O ZIP traz os originais como recebidos, separados em `publicadas/` e `ocultas/`,
com a data da foto no nome e no arquivo — abre em ordem cronológica em qualquer
gerenciador. Em álbum grande, prefira o computador ao celular.

Direto pelo servidor, se preferir:

```bash
scp -P 22022 -r root@103.199.184.110:/opt/album-festa/dados/midia/orig ./fotos-da-festa
```

---

## Operação

```bash
docker compose logs -f --tail=100     # acompanhar
docker compose restart                # reiniciar
docker compose up -d --build          # atualizar depois de mudar o código
docker compose down                   # parar (os dados ficam em ./dados)
```

O container tem `restart: unless-stopped`: volta sozinho depois de queda e
depois de reboot da VPS. Se você parar com `docker compose down` ou
`docker stop`, ele **não** volta sozinho — isso é intencional.

### Quando algo der errado

| Sintoma | O que olhar |
|---|---|
| Convidado vê 404 na galeria | O `k=` da URL bate com o `ALBUM_TOKEN` do `.env`? |
| "essa foto passa de 12 MB" | `MAX_ARQUIVO_MB` e `client_max_body_size` do nginx têm que ser iguais |
| "o álbum ficou sem espaço" | `df -h /` — abaixo de `DISCO_MINIMO_GB` o upload é recusado de propósito |
| "muita foto ao mesmo tempo" | Rate limit; suba `UPLOADS_POR_JANELA` e `docker compose up -d` |
| Container sobe e morre | `docker compose logs`; quase sempre é permissão em `dados/` (veja o `chown`) |
| Página não abre por https | `nginx -t`, `certbot certificates`, `systemctl status nginx` |

### Antes do dia

- [ ] Enviar 8 fotos por um iPhone e por um Android, pelo endereço real
- [ ] Foto tirada em retrato aparece em pé no grid
- [ ] Botão de enviar continua acessível depois de rolar até o fim
- [ ] Ocultar uma foto no `/admin` e ver ela sumir da galeria
- [ ] `./scripts/backup.sh` roda e o ZIP do admin baixa
- [ ] `reboot` na VPS e o álbum volta sozinho — **teste isto antes, não no dia**
- [ ] QR code impresso, escaneado no escuro, por um celular que não é o seu
