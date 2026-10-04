/* =====================================================================
   parser.js — Fitilho · leitor do "formato de texto 1"
   Versão do parser: 1.0.1 (02/10/2026)

   Sem DOM e sem rede. Entrada: o texto de um arquivo .txt (string).
   Saída: objeto JS puro. Funciona no navegador (window.FormatoTexto1),
   no Node (require) e no Google Apps Script (FormatoTexto1 global).
   Pode ser copiado tal qual para o outro projeto.

   API
     FormatoTexto1.analisar(texto, { nomeArquivo })  -> Capitulo
     FormatoTexto1.dividirFrases(texto)              -> [[ini, fim], ...]
     FormatoTexto1.chaveCapitulo(cabecalho)          -> "ESE:15" | "LE:1:2" | null
     FormatoTexto1.nomeArquivoEsperado(cabecalho)    -> "ese-cap-15.txt" | ...

   Capitulo = {
     formato, cabecalho: { formato, livro, edicao, parte, capitulo, titulo, ... },
     chave, secoes: [{ titulo, linha }],
     itens: [{
       numero, num, linha, secao, pagina, titulo, assinatura,
       apoio: { recap, palavrasChave, entendimento }   (só as chaves presentes;
                                                         "" = deixado em branco)
       campos: { outros @campos },
       paragrafos: [{ tipo: "texto"|"P"|"R"|"C"|"N", texto, italicos: [[a,b]],
                      paginas: [{ pos, n, entre }], pagina, linha }]
     }],
     conferir: [{ linha, texto, item }],
     avisos:   [{ linha, tipo, mensagem, item }],
     estatisticas: { itens, paragrafos, paginaInicial, paginaFinal }
   }
   Posições (pos, italicos, frases) são índices em "texto", fim exclusivo.
   ===================================================================== */
(function (raiz, fabrica) {
  var api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.FormatoTexto1 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSAO = '1.0.1';

  var CAMPOS_APOIO = { 'recap': 'recap', 'palavras-chave': 'palavrasChave', 'entendimento': 'entendimento' };
  var CAMPOS_ITEM = { 'pagina': 1, 'titulo': 1, 'assinatura': 1 };
  var CAMPOS_CABECALHO = { 'formato': 1, 'livro': 1, 'edicao': 1, 'parte': 1, 'capitulo': 1, 'titulo': 1 };
  var LIVROS = { 'ESE': 1, 'LE': 1 };

  var RE_COMENTARIO = /^#(?!#)/;
  var RE_CONFERIR = /^#\s*CONFERIR\s*:?\s*(.*)$/i;
  var RE_ITEM = /^###(?!#)\s*(.*)$/;
  var RE_SECAO = /^##(?!#)\s*(.*)$/;
  var RE_TITULO_DEMAIS = /^####/;
  var RE_CAMPO = /^@([A-Za-zÀ-ÿ0-9_-]+)\s*:\s?(.*)$/;
  var RE_MARCA_G = /\[\[\s*(\d+)\s*\]\]/g;
  var RE_SO_MARCAS = /^(\[\[\s*\d+\s*\]\]\s*)+$/;
  var RE_PREFIXO = /^((?:\[\[\s*\d+\s*\]\]\s*)*)([PRCN]):[ \t]*/;
  var RE_TERMINA_BEM = /[.!?…:;]["'”’»)\]]*$/;
  var RE_PLACEHOLDER = /^\[[^\]\d][^\]]*\]$/;

  /* ---------- utilidades ---------- */

  function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

  function inteiro(v) {
    if (v === undefined || v === null) return null;
    var s = String(v).trim();
    return /^\d+$/.test(s) ? parseInt(s, 10) : null;
  }

  function chaveCapitulo(cab) {
    if (!cab) return null;
    var livro = (cab.livro || '').trim().toUpperCase();
    var cap = inteiro(cab.capitulo);
    if (!livro || cap === null) return null;
    if (livro === 'LE') {
      var parte = inteiro(cab.parte);
      if (parte === null) return null;
      return 'LE:' + parte + ':' + cap;
    }
    return livro + ':' + cap;
  }

  function nomeArquivoEsperado(cab) {
    if (!cab) return null;
    var livro = (cab.livro || '').trim().toUpperCase();
    var cap = inteiro(cab.capitulo);
    if (cap === null) return null;
    if (livro === 'ESE') return 'ese-cap-' + pad2(cap) + '.txt';
    if (livro === 'LE') {
      var parte = inteiro(cab.parte);
      if (parte === null) return null;
      return 'le-parte-' + parte + '-cap-' + pad2(cap) + '.txt';
    }
    return null;
  }

  // "ese-cap-14 (1).txt" (cópia do Android/WhatsApp) -> "ese-cap-14.txt"
  function normalizarNome(nome) {
    return String(nome || '').trim().toLowerCase()
      .replace(/^.*[\\/]/, '')
      .replace(/\s*\(\d+\)(?=\.[^.]+$)/, '');
  }

  /* ---------- texto em linha: itálico e marcas de página ---------- */

  function processarInline(s) {
    var out = '';
    var espaco = false;
    var italicos = [];
    var paginas = [];
    var marcasPend = [];
    var itAberto = false, itIniPend = false, itIni = -1, asteriscos = 0;
    var i = 0, n = s.length;
    var re = /\[\[\s*(\d+)\s*\]\]/y;

    while (i < n) {
      re.lastIndex = i;
      var m = re.exec(s);
      if (m) { marcasPend.push(parseInt(m[1], 10)); i = re.lastIndex; continue; }
      var c = s.charAt(i);
      if (/\s/.test(c)) { if (out.length) espaco = true; i++; continue; }
      if (c === '*') {
        asteriscos++;
        if (!itAberto) { itAberto = true; itIniPend = true; }
        else {
          itAberto = false;
          if (!itIniPend) italicos.push([itIni, out.length]);
          itIniPend = false;
        }
        i++; continue;
      }
      if (espaco) { out += ' '; espaco = false; }
      var pos = out.length;
      for (var k = 0; k < marcasPend.length; k++) paginas.push({ pos: pos, n: marcasPend[k], entre: false });
      marcasPend = [];
      if (itIniPend) { itIni = pos; itIniPend = false; }
      out += c; i++;
    }
    for (var j = 0; j < marcasPend.length; j++) paginas.push({ pos: out.length, n: marcasPend[j], entre: false });
    var aberto = itAberto;
    if (itAberto && !itIniPend) italicos.push([itIni, out.length]);
    return { texto: out, italicos: italicos, paginas: paginas, italicoAberto: aberto, asteriscos: asteriscos };
  }

  /* ---------- divisão em frases ---------- */

  // Abreviações que não encerram frase (comparação em minúsculas, sem o ponto).
  // "etc" fica de fora de propósito: encerra frase quando a seguinte começa
  // com maiúscula; se começar com minúscula, a regra geral já não quebra.
  var ABREVIACOES = {};
  ('cap caps v vv n nº n° s ss sr sra srs sras srta dr dra drs dras ' +
   'p pp pág págs pag pags ed eds vol vols t tt cf cfr op cit ib ibid id ' +
   'obs fl fls art arts séc sec sto sta pe fr dª mons exmo exma prof profa ' +
   'i.e e.g a.c d.c ex av ' +
   'mt mat mc mr marc lc luc jo rm rom gn gên êx lv nm dt js jz rt ' +
   'sl pr ecl ct jr lm ez dn jl ab ob jn mq hc sf ag zc ml ' +
   'gl gál ef fp cl ts tm fm hb tg pd jd ap apoc')
    .split(/\s+/).forEach(function (a) { if (a) ABREVIACOES[a] = 1; });

  var RE_TERM = /[.!?…]/;
  var RE_TERM_OU_FECHA = /[.!?…"'”’»)\]]/;
  var RE_ESPACO = /\s/;
  var RE_MINUSCULA = /^[a-zà-öø-ÿ]/;

  function ehAbreviacao(t, i) {
    // palavra imediatamente antes do ponto em t[i]
    var s = i;
    while (s > 0 && !/[\s(\[“"«'—–]/.test(t.charAt(s - 1))) s--;
    var tok = t.slice(s, i);
    if (!tok) return false;
    if (tok.length === 1 && /[A-Za-zÀ-ÿ]/.test(tok)) return true; // inicial: "S.", "A."
    return ABREVIACOES[tok.toLowerCase()] === 1;
  }

  function acharFechamento(t, k) {
    var abre = t.charAt(k), fecha = abre === '(' ? ')' : ']';
    var prof = 0;
    for (var i = k; i < t.length; i++) {
      var c = t.charAt(i);
      if (c === abre) prof++;
      else if (c === fecha) { prof--; if (prof === 0) return i; }
    }
    return -1;
  }

  function dividirFrases(t) {
    var res = [];
    var n = t.length;
    var ini = 0;
    while (ini < n && RE_ESPACO.test(t.charAt(ini))) ini++;
    var i = ini, prof = 0;

    function candidata(j, ehPonto, iPonto) {
      // j = primeiro índice depois do bloco de pontuação. Devolve o índice
      // de início da próxima frase, ou -1 se não for fronteira.
      if (j < n && !RE_ESPACO.test(t.charAt(j))) return -1;
      if (ehPonto && ehAbreviacao(t, iPonto)) return -1;
      var k = j;
      while (k < n && RE_ESPACO.test(t.charAt(k))) k++;
      if (k >= n) return -2; // fim do texto
      if (RE_MINUSCULA.test(t.charAt(k))) return -1;
      var fim = j;
      // referência entre parênteses logo depois fica com a frase anterior
      while (k < n && (t.charAt(k) === '(' || t.charAt(k) === '[')) {
        var f = acharFechamento(t, k);
        if (f < 0) break;
        var m = f + 1;
        while (m < n && RE_TERM_OU_FECHA.test(t.charAt(m))) m++;
        fim = m; k = m;
        while (k < n && RE_ESPACO.test(t.charAt(k))) k++;
      }
      if (k >= n) return -2;
      res.push([ini, fim]);
      return k;
    }

    while (i < n) {
      var c = t.charAt(i);
      if (c === '(' || c === '[') { prof++; i++; continue; }
      if ((c === ')' || c === ']') && prof > 0) {
        prof--; i++;
        if (prof === 0) {
          // "(Frase inteira entre parênteses.)" seguida de nova frase
          var a = i - 2;
          while (a >= 0 && /["'”’»]/.test(t.charAt(a))) a--;
          if (a >= 0 && RE_TERM.test(t.charAt(a))) {
            var jj = i;
            while (jj < n && RE_TERM_OU_FECHA.test(t.charAt(jj))) jj++;
            var r0 = candidata(jj, false, -1);
            if (r0 === -2) break;
            if (r0 >= 0) { ini = r0; i = r0; continue; }
          }
        }
        continue;
      }
      if (prof === 0 && RE_TERM.test(c)) {
        var j = i + 1;
        while (j < n && RE_TERM_OU_FECHA.test(t.charAt(j))) j++;
        // interjeição curta ("Mas, ah! Muitos...") não vira frase sozinha
        if (c === '!' && t.slice(ini, i).trim().split(/\s+/).length <= 2) { i = j; continue; }
        var ehPonto = c === '.' && (j === i + 1 || !/[.…]/.test(t.charAt(i + 1)));
        var r = candidata(j, ehPonto, i);
        if (r === -2) break;
        if (r >= 0) { ini = r; i = r; continue; }
        i = j; continue;
      }
      i++;
    }
    if (ini < n) {
      var fimT = n;
      while (fimT > ini && RE_ESPACO.test(t.charAt(fimT - 1))) fimT--;
      if (fimT > ini) res.push([ini, fimT]);
    }
    return res;
  }

  /* ---------- análise do arquivo ---------- */

  function analisar(textoBruto, opcoes) {
    opcoes = opcoes || {};
    var texto = String(textoBruto || '');
    if (texto.charCodeAt(0) === 0xFEFF) texto = texto.slice(1);
    texto = texto.replace(/\r\n?/g, '\n');
    var linhas = texto.split('\n');

    var cap = {
      versaoParser: VERSAO,
      formato: null,
      cabecalho: {},
      chave: null,
      secoes: [],
      itens: [],
      conferir: [],
      avisos: [],
      estatisticas: null
    };

    var item = null;             // item corrente
    var buffer = [];             // linhas do parágrafo corrente: { t, linha }
    var ultimoCampo = null;      // { obj, chave } para continuação de campo de apoio
    var paginaAtual = null;
    var paginaPendente = null;   // marca sozinha entre parágrafos -> próximo parágrafo
    var marcaSozinha = null;     // { n, linha, anteriorRuim, linhaAnterior }
    var ultimoNum = null;
    var numerosVistos = {};
    var avisouSolto = {};

    function aviso(linha, tipo, mensagem) {
      cap.avisos.push({ linha: linha, tipo: tipo, mensagem: mensagem, item: item ? item.numero : null });
    }

    function registrarPagina(n, linha, origem) {
      if (paginaAtual !== null) {
        if (n < paginaAtual) aviso(linha, 'pagina', 'A página diminui: ' + origem + ' ' + n + ' vem depois da página ' + paginaAtual + '.');
        else if (n === paginaAtual && origem === 'marca') aviso(linha, 'pagina', 'A marca [[' + n + ']] repete a página em que o texto já está.');
        else if (n > paginaAtual + 1) aviso(linha, 'pagina', 'Salto de página: de ' + paginaAtual + ' para ' + n + '. Faltou alguma marca [[N]]?');
      }
      paginaAtual = n;
    }

    function fecharParagrafo() {
      if (!buffer.length) return;
      var linhasP = buffer;
      buffer = [];
      var linha0 = linhasP[0].linha;
      var linhaN = linhasP[linhasP.length - 1].linha;

      if (!item) {
        if (!avisouSolto[linha0]) {
          aviso(linha0, 'solto', 'Texto fora de item (antes do primeiro ###), linhas ' + linha0 + (linhaN !== linha0 ? '–' + linhaN : '') + '. Foi ignorado.');
          avisouSolto[linha0] = 1;
        }
        return;
      }

      // Marca de página sozinha entre parágrafos
      var tudoMarcas = linhasP.every(function (l) { return RE_SO_MARCAS.test(l.t); });
      if (tudoMarcas) {
        linhasP.forEach(function (l) {
          var m; RE_MARCA_G.lastIndex = 0;
          while ((m = RE_MARCA_G.exec(l.t))) {
            var n = parseInt(m[1], 10);
            registrarPagina(n, l.linha, 'a marca');
            paginaPendente = n;
            var ant = item.paragrafos[item.paragrafos.length - 1];
            marcaSozinha = {
              n: n, linha: l.linha,
              anteriorRuim: !!(ant && ant.texto && !RE_TERMINA_BEM.test(ant.texto)),
              linhaAnterior: ant ? ant.linha : null
            };
          }
        });
        return;
      }

      // Validação das marcas, linha a linha (para saber a linha exata)
      var paginaAntes = paginaAtual;
      linhasP.forEach(function (l) {
        var m; RE_MARCA_G.lastIndex = 0;
        while ((m = RE_MARCA_G.exec(l.t))) registrarPagina(parseInt(m[1], 10), l.linha, 'a marca');
        var semMarcas = l.t.replace(RE_MARCA_G, '');
        if (/\[\[|\]\]/.test(semMarcas) || /\[\[\[|\]\]\]/.test(l.t)) aviso(l.linha, 'marca', 'Marca de página malformada (use [[N]], com dois colchetes de cada lado e só o número).');
        else if (/\[\s*\d{1,4}\s*\](?!\])/.test(semMarcas)) aviso(l.linha, 'marca', 'Número entre colchetes simples: se for virada de página, use [[N]].');
      });

      var junto = linhasP.map(function (l) { return l.t; }).join('\n');

      // Prefixo P:/R:/C:/N:
      var tipo = null;
      var mp = RE_PREFIXO.exec(junto);
      if (mp) {
        tipo = mp[2];
        junto = mp[1] + junto.slice(mp[0].length);
      }
      var anterior = item.paragrafos[item.paragrafos.length - 1];
      var livro = (cap.cabecalho.livro || '').toUpperCase();
      if (!tipo) {
        if (livro === 'LE') {
          tipo = anterior ? anterior.tipo : 'texto';
          if (!anterior) aviso(linha0, 'bloco', 'Pergunta ' + item.numero + ' começa sem "P:".');
        } else {
          tipo = (anterior && anterior.tipo === 'N') ? 'N' : 'texto';
        }
      }

      var r = processarInline(junto);

      if (!r.texto) {
        aviso(linha0, 'vazio', 'Parágrafo vazio' + (mp ? ' depois de "' + mp[2] + ':"' : '') + '.');
        return;
      }
      if (r.italicoAberto) {
        aviso(linha0, 'italico', 'Itálico aberto com * e não fechado até o fim do parágrafo (linhas ' + linha0 + (linhaN !== linha0 ? '–' + linhaN : '') + '). Ficou em itálico até o fim do parágrafo.');
      }
      if (RE_PLACEHOLDER.test(r.texto)) {
        aviso(linha0, 'modelo', 'Parece texto do modelo não substituído: ' + r.texto.slice(0, 50));
      }

      // Página em que o parágrafo começa
      var pagina;
      if (r.paginas.length && r.paginas[0].pos === 0) pagina = r.paginas[0].n;
      else if (paginaPendente !== null) pagina = paginaPendente;
      else pagina = paginaAntes;
      if (paginaPendente !== null) {
        r.paginas.unshift({ pos: 0, n: paginaPendente, entre: true });
      }

      // Conferência da marca sozinha anterior
      if (marcaSozinha) {
        var comecaMinuscula = /^[a-zà-öø-ÿ]/.test(r.texto);
        if (marcaSozinha.anteriorRuim || comecaMinuscula) {
          var motivo = marcaSozinha.anteriorRuim && comecaMinuscula
            ? 'o parágrafo anterior termina sem pontuação final e o seguinte começa com minúscula'
            : marcaSozinha.anteriorRuim
              ? 'o parágrafo anterior (linha ' + marcaSozinha.linhaAnterior + ') termina sem pontuação final'
              : 'o parágrafo seguinte começa com minúscula';
          aviso(marcaSozinha.linha, 'marca', 'Marca [[' + marcaSozinha.n + ']] sozinha entre linhas em branco, mas ' + motivo + '. Se a página virou no meio do parágrafo, tire as linhas em branco em volta da marca.');
        }
      }
      marcaSozinha = null;
      paginaPendente = null;

      item.paragrafos.push({
        tipo: tipo,
        texto: r.texto,
        italicos: r.italicos,
        paginas: r.paginas,
        pagina: pagina,
        linha: linha0
      });
    }

    function fecharItem(linhaFim) {
      if (!item) return;
      if (marcaSozinha && marcaSozinha.anteriorRuim) {
        aviso(marcaSozinha.linha, 'marca', 'Marca [[' + marcaSozinha.n + ']] sozinha no fim do item, depois de parágrafo sem pontuação final. Confira se a página virou no meio do parágrafo.');
      }
      marcaSozinha = null;
      if (!item.paragrafos.length) {
        cap.avisos.push({ linha: item.linha, tipo: 'vazio', mensagem: 'Item ' + item.numero + ' sem texto.', item: item.numero });
      }
    }

    function abrirItem(rotulo, linha) {
      fecharItem(linha);
      var num = inteiro(rotulo);
      item = {
        numero: rotulo, num: num, linha: linha,
        secao: cap.secoes.length - 1,
        pagina: null, titulo: null, assinatura: null,
        apoio: {}, campos: {}, paragrafos: []
      };
      cap.itens.push(item);
      if (!rotulo) aviso(linha, 'item', 'Linha ### sem número de item.');
      else if (num === null) aviso(linha, 'item', 'Número de item não é um número inteiro: "' + rotulo + '".');
      else {
        if (numerosVistos[num]) aviso(linha, 'repetido', 'Item ' + num + ' repetido (já aparece na linha ' + numerosVistos[num] + ').');
        else if (ultimoNum !== null && num < ultimoNum) aviso(linha, 'ordem', 'Item ' + num + ' fora de ordem: vem depois do item ' + ultimoNum + '.');
        else if (ultimoNum !== null && num > ultimoNum + 1) {
          aviso(linha, 'ordem', 'Do item ' + ultimoNum + ' pulou para o ' + num + ': ' + (num - ultimoNum === 2 ? 'falta o item ' + (ultimoNum + 1) : 'faltam os itens ' + (ultimoNum + 1) + (num - ultimoNum === 3 ? ' e ' : ' a ') + (num - 1)) + '?');
        }
        if (!numerosVistos[num]) numerosVistos[num] = linha;
        if (ultimoNum === null || num > ultimoNum) ultimoNum = num;
      }
    }

    function campo(nome, valor, linha) {
      var nomeL = nome.toLowerCase();
      valor = valor.trim();
      if (!item) {
        if (cap.secoes.length) {
          aviso(linha, 'campo', 'Campo @' + nome + ' entre o ## e o primeiro ###: fica sem item e foi ignorado.');
          return;
        }
        if (cap.cabecalho.hasOwnProperty(nomeL)) aviso(linha, 'campo', 'Campo @' + nome + ' repetido no cabeçalho; vale o último.');
        if (!CAMPOS_CABECALHO[nomeL]) aviso(linha, 'campo', 'Campo de cabeçalho desconhecido: @' + nome + ' (guardado, sem efeito).');
        cap.cabecalho[nomeL] = valor;
        return;
      }
      if (nomeL === 'pagina') {
        var n = inteiro(valor);
        if (n === null) { aviso(linha, 'pagina', '@pagina sem número válido: "' + valor + '".'); return; }
        if (item.paragrafos.length) aviso(linha, 'campo', '@pagina depois do texto do item; deveria vir logo abaixo do ###.');
        registrarPagina(n, linha, '@pagina');
        item.pagina = n;
        paginaPendente = null;
        marcaSozinha = null;
        return;
      }
      if (CAMPOS_APOIO[nomeL]) {
        item.apoio[CAMPOS_APOIO[nomeL]] = valor;
        ultimoCampo = { obj: item.apoio, chave: CAMPOS_APOIO[nomeL] };
        return;
      }
      if (nomeL === 'titulo' || nomeL === 'assinatura') {
        if (item[nomeL]) aviso(linha, 'campo', '@' + nome + ' repetido no item ' + item.numero + '; vale o último.');
        if (!valor) aviso(linha, 'campo', '@' + nome + ' vazio no item ' + item.numero + ' (campo opcional vazio: apague a linha).');
        else if (RE_PLACEHOLDER.test(valor)) aviso(linha, 'modelo', '@' + nome + ' parece texto do modelo: ' + valor);
        item[nomeL] = valor ? processarInline(valor).texto : null;
        if (valor && /\*/.test(valor)) item[nomeL + 'Italicos'] = processarInline(valor).italicos;
        return;
      }
      aviso(linha, 'campo', 'Campo desconhecido no item ' + item.numero + ': @' + nome + ' (guardado, sem efeito).');
      item.campos[nomeL] = valor;
    }

    for (var idx = 0; idx < linhas.length; idx++) {
      var numLinha = idx + 1;
      var bruta = linhas[idx].replace(/\s+$/, '');
      var t = bruta.replace(/^\s+/, '');

      if (RE_TITULO_DEMAIS.test(t)) {
        aviso(numLinha, 'estrutura', 'Linha com #### (quatro ou mais #) não existe no formato; foi ignorada.');
        continue;
      }
      if (RE_COMENTARIO.test(t)) {
        var mc = RE_CONFERIR.exec(t);
        if (mc) cap.conferir.push({ linha: numLinha, texto: mc[1].trim(), item: item ? item.numero : null });
        else if (!/^#(\s|$)/.test(t)) aviso(numLinha, 'estrutura', 'Linha começa com # sem espaço depois; foi tratada como comentário.');
        continue; // comentário não interrompe parágrafo
      }
      if (t === '') { fecharParagrafo(); ultimoCampo = null; continue; }

      var m;
      if ((m = RE_ITEM.exec(t))) {
        fecharParagrafo(); ultimoCampo = null;
        abrirItem(m[1].trim(), numLinha);
        continue;
      }
      if ((m = RE_SECAO.exec(t))) {
        fecharParagrafo(); ultimoCampo = null;
        fecharItem(numLinha);
        item = null;
        var tit = m[1].trim();
        if (!tit) aviso(numLinha, 'estrutura', 'Linha ## sem texto de subtítulo.');
        else if (RE_PLACEHOLDER.test(tit)) aviso(numLinha, 'modelo', 'Subtítulo parece texto do modelo: ' + tit);
        cap.secoes.push({ titulo: processarInline(tit).texto, linha: numLinha });
        continue;
      }
      if ((m = RE_CAMPO.exec(t))) {
        fecharParagrafo();
        ultimoCampo = null;
        campo(m[1], m[2], numLinha);
        continue;
      }
      // linha de texto
      if (ultimoCampo && !buffer.length) {
        var o = ultimoCampo.obj, ch = ultimoCampo.chave;
        o[ch] = o[ch] ? o[ch] + ' ' + t : t;
        continue;
      }
      buffer.push({ t: t, linha: numLinha });
    }
    fecharParagrafo();
    fecharItem(linhas.length);

    /* ---- validação do cabeçalho ---- */
    var cab = cap.cabecalho;
    cap.formato = inteiro(cab.formato);
    if (cab.formato === undefined) cap.avisos.unshift({ linha: 1, tipo: 'formato', mensagem: 'Falta @formato: 1 no cabeçalho.', item: null });
    else if (cap.formato !== 1) cap.avisos.unshift({ linha: 1, tipo: 'formato', mensagem: '@formato: ' + cab.formato + ' — este leitor conhece só o formato 1.', item: null });
    if (cab.livro) cab.livro = cab.livro.trim().toUpperCase();
    if (!cab.livro) cap.avisos.unshift({ linha: 1, tipo: 'cabecalho', mensagem: 'Falta @livro (ESE ou LE).', item: null });
    else if (!LIVROS[cab.livro]) cap.avisos.unshift({ linha: 1, tipo: 'cabecalho', mensagem: 'Livro desconhecido: "' + cab.livro + '" (esperado ESE ou LE).', item: null });
    if (inteiro(cab.capitulo) === null) cap.avisos.unshift({ linha: 1, tipo: 'cabecalho', mensagem: 'Falta @capitulo com número.', item: null });
    if (cab.livro === 'LE' && inteiro(cab.parte) === null) cap.avisos.unshift({ linha: 1, tipo: 'cabecalho', mensagem: 'O Livro dos Espíritos precisa de @parte com número.', item: null });
    if (!cab.titulo) cap.avisos.push({ linha: 1, tipo: 'cabecalho', mensagem: 'Falta @titulo do capítulo.', item: null });
    else if (RE_PLACEHOLDER.test(cab.titulo)) cap.avisos.push({ linha: 1, tipo: 'modelo', mensagem: '@titulo do capítulo parece texto do modelo: ' + cab.titulo, item: null });
    if (cab.titulo) cab.titulo = processarInline(cab.titulo).texto;
    cap.chave = chaveCapitulo(cab);

    if (opcoes.nomeArquivo) {
      var esperado = nomeArquivoEsperado(cab);
      if (esperado && normalizarNome(opcoes.nomeArquivo) !== esperado) {
        cap.avisos.push({ linha: 1, tipo: 'arquivo', mensagem: 'Nome do arquivo "' + opcoes.nomeArquivo + '" não bate com o cabeçalho; o esperado é "' + esperado + '".', item: null });
      }
    }
    if (texto.indexOf('\uFFFD') >= 0) {
      cap.avisos.push({ linha: 1, tipo: 'codificacao', mensagem: 'O arquivo tem caracteres ilegíveis (�). Salve em UTF-8.', item: null });
    }
    if (!cap.itens.length) cap.avisos.push({ linha: 1, tipo: 'estrutura', mensagem: 'Nenhum item (###) encontrado.', item: null });

    /* ---- herança de página ---- */
    var pg = null, nPar = 0;
    cap.itens.forEach(function (it) {
      if (it.pagina === null) {
        var p0 = it.paragrafos.length ? it.paragrafos[0].pagina : null;
        it.pagina = p0 !== null && p0 !== undefined ? p0 : pg;
        if (it.pagina === null) cap.avisos.push({ linha: it.linha, tipo: 'pagina', mensagem: 'Item ' + it.numero + ' sem @pagina e sem página anterior conhecida.', item: it.numero });
      }
      it.paragrafos.forEach(function (p) {
        if (p.pagina === null || p.pagina === undefined) p.pagina = it.pagina;
        var ult = p.paginas.length ? p.paginas[p.paginas.length - 1].n : p.pagina;
        if (ult !== null) pg = ult;
        nPar++;
      });
      if (it.pagina !== null && pg === null) pg = it.pagina;
    });

    var paginasTodas = [];
    cap.itens.forEach(function (it) {
      if (it.pagina !== null) paginasTodas.push(it.pagina);
      it.paragrafos.forEach(function (p) { p.paginas.forEach(function (x) { paginasTodas.push(x.n); }); });
    });
    cap.estatisticas = {
      itens: cap.itens.length,
      paragrafos: nPar,
      paginaInicial: paginasTodas.length ? Math.min.apply(null, paginasTodas) : null,
      paginaFinal: paginasTodas.length ? Math.max.apply(null, paginasTodas) : null
    };

    cap.avisos.sort(function (a, b) { return (a.linha || 0) - (b.linha || 0); });
    return cap;
  }

  return {
    VERSAO: VERSAO,
    analisar: analisar,
    dividirFrases: dividirFrases,
    chaveCapitulo: chaveCapitulo,
    nomeArquivoEsperado: nomeArquivoEsperado,
    _processarInline: processarInline
  };
});
