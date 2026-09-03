# Regulariza Brasil / Desenrola Brasil - Clone Idêntico

Clone completo e idêntico do site https://desenrolasbr2026.com/pre com todas as páginas, mídias (áudios e vídeos), fontes e backend integrado.

## 🚀 Como Iniciar

1. Certifique-se de ter o **Node.js** instalado.
2. Abra o terminal nesta pasta e execute:
```bash
npm start
```
ou
```bash
node server.js
```
3. Acesse no navegador:
**http://localhost:3000/pre**

---

## 📁 Estrutura de Páginas e Rotas

- **/pre**: Página inicial (Pre-lander do Desenrola Brasil com banners e botão de acesso)
- **/cpf**: Formulário de consulta de CPF (Gov.br)
- **/atendimento**: Entrada de atendimento e validação
- **/busca**: Busca de situação eleitoral e consulta por CPF
- **/consulta**: Página de notícia do Jornal da Band com vídeo (`news.mp4`) e botão de som interativo
- **/chat**: Chat interativo da analista Lucia Helena com áudios de voz automáticos (`audio1.mp3` a `audio5.mp3`), digitação animada, captura de telefone e modal PIX
- **/negociacao**: Painel de quitação da multa eleitoral com desconto de 81% e PIX
- **/upsell1**: Etapa de protocolo de unificação de dívidas com nova geração de PIX
- **/:cpf**: Rota dinâmica de CPF (ex: `/12345678901`)

---

## 🎵 Mídias e Recursos Incluídos

- **Vídeos**: `static/videos/news.mp4` (Vídeo jornalístico completo de 8.9 MB)
- **Áudios**: `static/audio/audio1.mp3` a `audio5.mp3` (Vozes originais da analista Lucia Helena)
- **Fontes**: Família completa Rawline WOFF2 (`rawline-400`, `rawline-400i`, `rawline-500`, `rawline-600`, `rawline-700`, `rawline-800`)
- **Imagens**: Todos os logos e banners em PNG e WebP de alta qualidade
- **APIs Integradas**:
  - `POST /api/check_cpf`: Validação e consulta de CPF
  - `POST /generate-pix`: Geração de código PIX Copia e Cola e QR Code
  - `POST /generate-pix-upsell`: Geração de PIX para a etapa de upsell
  - `GET /generate-qrcode`: Geração dinâmica de QR Code visual
  - `GET /check-payment/:id`: Monitoramento em tempo real do status do PIX
