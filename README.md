# Fitilho

Leitor PWA dos livros do Evangelho no Lar: mostra o texto como está impresso,
com destaque frase por frase, e abre onde a leitura parou.

**Este repositório tem só código e fonte. Nenhum texto dos livros entra aqui.**
Os textos ficam no aparelho (IndexedDB), importados pelo próprio app.

## Arquivos

| Arquivo | Função |
|---|---|
| `index.html` | estrutura das telas |
| `app.js` | leitor, destaque, fitilho, índice, importação, tela acesa |
| `parser.js` | lê o formato de texto 1; sem DOM, copiável para outro projeto |
| `style.css` | aparência |
| `manifest.webmanifest` | instalação como app |
| `sw.js` | funcionamento sem internet |
| `fonts/` | Atkinson Hyperlegible (SIL OFL 1.1, ver `fonts/OFL.txt`) |
| `icons/` | ícones do app |
| `media/` | vídeo mudo de 2 s, alternativa para manter a tela acesa |

## Publicar no GitHub Pages

1. No repositório `fitilho` (público, vazio): **Add file → Upload files**,
   arraste todo o conteúdo desta pasta (não a pasta em si) e clique em
   **Commit changes**.
2. **Settings → Pages → Branch: main / (root) → Save**.
3. Em 1 a 2 minutos o endereço aparece no alto da página de Pages:
   `https://SEU-USUARIO.github.io/fitilho/`.

## Atualizar depois

Ao trocar qualquer arquivo, aumente `VERSAO` no topo do `sw.js`
(ex.: `fitilho-v1.0.1`). Sem isso o celular continua usando a versão
guardada. O app avisa quando baixou a versão nova; fechar e abrir de novo
aplica.

## Proteção contra subir texto por engano

O `.gitignore` bloqueia `*.txt` (menos `fonts/OFL.txt`) quando se usa git.
O upload pelo navegador ignora o `.gitignore`: nesse caso, conferir que
nenhum `.txt` de capítulo foi arrastado junto.
