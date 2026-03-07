# Rainbow Safe Uberlândia (MVP local)
Slogan: **“Hoje eu não quero voltar sozinho.”**

Este é um **MVP** (prova de conceito) para rodar **localmente** no seu computador.
Ele inclui:
- Botão **SOS** (pega geolocalização do navegador e registra um alerta)
- **Contatos de confiança** (cadastro simples)
- **Mapa colaborativo** de lugares (seguro / neutro / hostil)
- **Modo Voltar para Casa** (compartilhamento local + envio de “check-ins”)
- Painel **Admin Local** (somente para você ver logs/alertas e exportar)

> ⚠️ Privacidade: este MVP grava dados em um SQLite local (`rainbow_safe.db`).  
> Para uso real, é essencial melhorar: autenticação forte, criptografia, consentimento, LGPD, moderação de conteúdo e políticas de abuso.

## 1) Requisitos
- Python 3.10+

## 2) Instalação
```bash
cd rainbow-safe-uberlandia
python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
```

## 3) Rodar
```bash
flask --app app run --debug
```
Abra:
- http://127.0.0.1:5000

## 4) Enviar alertas por email (opcional)
Por padrão, ao criar um SOS o app **apenas registra no console**.  
Para enviar email, preencha no `.env`:
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

## 5) Estrutura
- `app.py` servidor Flask
- `templates/` HTML
- `static/` JS/CSS
- `instance/` (criado automaticamente) logs/exportações

## 6) Próximos passos (para virar app real)
- Login (OAuth/UFU), perfis, permissões e audit trail
- Criptografia ponta a ponta no chat
- Notificações push (FCM/APNs)
- Integração com serviços oficiais (ouvidoria, DCE/coletivos, 190/193, etc.)
- Moderação e prevenção de uso malicioso (spam, stalking, doxxing)
- LGPD: base legal, retenção, transparência, DPO e DPIA


## Admin / Aprovação de perfis (Dá uma caroninha)
- Defina `ADMIN_PASSWORD` no `.env`
- Login: `http://127.0.0.1:5000/admin/login`
- Aprovações: `http://127.0.0.1:5000/admin/approvals`
