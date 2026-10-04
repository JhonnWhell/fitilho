/* =====================================================================
   app.js — Fitilho · leitor PWA
   Depende de parser.js (window.FormatoTexto1). Sem rede na etapa 1.
   ===================================================================== */
(function () {
  'use strict';

  var VERSAO_APP = '1.2.1';
  var P = window.FormatoTexto1;
  var NOMES_LIVRO = { ESE: 'O Evangelho segundo o Espiritismo', LE: 'O Livro dos Espíritos' };
  var CURTO_LIVRO = { ESE: 'Evangelho', LE: 'Livro dos Espíritos' };
  var ORDEM_LIVRO = { ESE: 1, LE: 2 };
  var TAM_MIN = 15, TAM_MAX = 36;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, texto) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto !== undefined && texto !== null) e.textContent = texto;
    return e;
  }

  /* ---------------- localStorage (com proteção) ---------------- */
  var LS = {
    ler: function (k, padrao) {
      try { var v = localStorage.getItem('fitilho.' + k); return v ? JSON.parse(v) : padrao; }
      catch (e) { return padrao; }
    },
    gravar: function (k, v) {
      try { localStorage.setItem('fitilho.' + k, JSON.stringify(v)); return true; }
      catch (e) { return false; }
    }
  };

  var PREF_PADRAO = { tamanho: 21, unidade: 'frase', telaAcesa: true };
  var prefs = Object.assign({}, PREF_PADRAO, LS.ler('prefs', {}));
  delete prefs.paginas; // versão 1.0.0 tinha números de página na tela
  var posicoes = LS.ler('posicoes', null) || { ultima: null, porCapitulo: {} };
  if (!posicoes.porCapitulo) posicoes.porCapitulo = {};
  var fitas = LS.ler('fitas', null) || {};

  function salvarPrefs() { LS.gravar('prefs', prefs); }
  function salvarPosicoes() { LS.gravar('posicoes', posicoes); }
  function salvarFitas() { LS.gravar('fitas', fitas); }

  /* ---------------- IndexedDB ---------------- */
  var DB = {
    db: null,
    abrir: function () {
      if (DB.db) return Promise.resolve(DB.db);
      return new Promise(function (ok, erro) {
        if (!('indexedDB' in window)) { erro(new Error('Este navegador não tem IndexedDB.')); return; }
        var req = indexedDB.open('fitilho', 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains('capitulos')) db.createObjectStore('capitulos', { keyPath: 'chave' });
          if (!db.objectStoreNames.contains('anteriores')) db.createObjectStore('anteriores', { keyPath: 'chave' });
        };
        req.onsuccess = function () { DB.db = req.result; ok(DB.db); };
        req.onerror = function () { erro(req.error); };
      });
    },
    _tx: function (store, modo, fn) {
      return DB.abrir().then(function (db) {
        return new Promise(function (ok, erro) {
          var tx = db.transaction(store, modo);
          var st = tx.objectStore(store);
          var res;
          var r = fn(st);
          if (r) r.onsuccess = function () { res = r.result; };
          tx.oncomplete = function () { ok(res); };
          tx.onerror = function () { erro(tx.error); };
          tx.onabort = function () { erro(tx.error); };
        });
      });
    },
    todos: function () { return DB._tx('capitulos', 'readonly', function (st) { return st.getAll(); }); },
    obter: function (chave) { return DB._tx('capitulos', 'readonly', function (st) { return st.get(chave); }); },
    gravar: function (reg) { return DB._tx('capitulos', 'readwrite', function (st) { return st.put(reg); }); },
    apagar: function (chave) { return DB._tx('capitulos', 'readwrite', function (st) { return st.delete(chave); }); },
    guardarAnterior: function (reg) { return DB._tx('anteriores', 'readwrite', function (st) { return st.put(reg); }); }
  };

  /* ---------------- utilidades ---------------- */
  function romano(n) {
    n = parseInt(n, 10);
    if (!(n > 0 && n < 4000)) return String(n);
    var v = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
    var s = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
    var r = '';
    for (var i = 0; i < v.length; i++) while (n >= v[i]) { r += s[i]; n -= v[i]; }
    return r;
  }
  function rotuloCapitulo(reg, curto) {
    if (!reg) return '';
    var c = 'Capítulo ' + romano(reg.capitulo);
    if (reg.livro === 'LE') c = (curto ? 'Parte ' + reg.parte + ' · ' : 'Parte ' + reg.parte + ' · ') + c;
    return c;
  }
  function ordenarCapitulos(a, b) {
    var la = ORDEM_LIVRO[a.livro] || 9, lb = ORDEM_LIVRO[b.livro] || 9;
    if (la !== lb) return la - lb;
    if (a.livro !== b.livro) return a.livro < b.livro ? -1 : 1;
    if ((a.parte || 0) !== (b.parte || 0)) return (a.parte || 0) - (b.parte || 0);
    return a.capitulo - b.capitulo;
  }
  function mesmaPosicao(a, b) {
    return !!(a && b && a.chave === b.chave && a.item === b.item && a.par === b.par && a.frase === b.frase);
  }
  function descreverAncora(a) {
    if (!a) return '';
    var reg = estado.capitulos.filter(function (c) { return c.chave === a.chave; })[0];
    var s = reg ? (CURTO_LIVRO[reg.livro] || reg.livro) + ' · ' + rotuloCapitulo(reg, true) : a.chave;
    if (a.item && a.item.charAt(0) !== '_') s += ' · item ' + a.item;
    if (a.inicio) s += ' · “' + (a.inicio.length > 28 ? a.inicio.slice(0, 28).replace(/\s+\S*$/, '') + '…' : a.inicio) + '”';
    return s;
  }

  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('aviso-flutuante');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 2600);
  }

  /* ---------------- estado ---------------- */
  var estado = {
    capitulos: [],   // registros do IndexedDB
    reg: null,       // capítulo aberto (registro)
    cap: null,       // capítulo analisado (parser)
    blocos: [],
    unidades: [],    // [{ b, f }]  (f = -1 no modo parágrafo)
    idx: -1,
    vista: 'biblioteca'
  };

  /* ---------------- vistas ---------------- */
  function mostrarVista(nome) {
    estado.vista = nome;
    ['biblioteca', 'relatorio', 'leitor'].forEach(function (v) { $(v).hidden = v !== nome; });
    document.body.className = document.body.className.replace(/\bvista-\S+/g, '').trim() + ' vista-' + nome;
    aplicarClassesCorpo();
    if (nome === 'leitor') Tela.pedir(); else Tela.soltar();
    window.scrollTo(0, 0);
  }
  function aplicarClassesCorpo() {
    document.documentElement.style.setProperty('--tam', prefs.tamanho + 'px');
  }

  /* ---------------- biblioteca ---------------- */
  function carregarCapitulos() {
    return DB.todos().then(function (lista) {
      estado.capitulos = (lista || []).sort(ordenarCapitulos);
      return estado.capitulos;
    });
  }

  function renderBiblioteca() {
    var cont = $('lista-livros');
    cont.textContent = '';
    if (!estado.capitulos.length) {
      var v = el('div', 'vazio');
      v.appendChild(el('p', null, 'Nenhum capítulo ainda.'));
      v.appendChild(el('p', null, 'Toque em “Importar arquivo .txt” e escolha um arquivo no formato de texto 1 (por exemplo, ese-cap-14.txt). O texto fica guardado só neste aparelho.'));
      cont.appendChild(v);
    }
    var porLivro = {};
    estado.capitulos.forEach(function (c) { (porLivro[c.livro] = porLivro[c.livro] || []).push(c); });
    Object.keys(porLivro).sort(function (a, b) { return (ORDEM_LIVRO[a] || 9) - (ORDEM_LIVRO[b] || 9); }).forEach(function (livro) {
      var sec = el('section', 'livro');
      sec.appendChild(el('h2', null, NOMES_LIVRO[livro] || livro));
      var ul = el('ul', 'cap-lista');
      porLivro[livro].forEach(function (c) {
        var li = el('li', 'cap-cartao');
        var b = el('button', 'cap-abrir');
        b.type = 'button';
        b.appendChild(el('span', 'cap-nome', rotuloCapitulo(c) + (c.titulo ? ' — ' + c.titulo : '')));
        var sub = el('span', 'cap-sub');
        var partes = [];
        if (c.itensDe !== null && c.itensDe !== undefined) partes.push(c.itensDe === c.itensAte ? 'item ' + c.itensDe : 'itens ' + c.itensDe + ' a ' + c.itensAte);
        partes.push(c.nAvisos ? c.nAvisos + (c.nAvisos === 1 ? ' aviso' : ' avisos') : 'sem avisos');
        sub.textContent = partes.join(' · ');
        var f = fitas[c.livro];
        if (f && f.chave === c.chave) { sub.appendChild(document.createTextNode(' · ')); sub.appendChild(el('span', 'cap-fita', 'fitilho aqui')); }
        b.appendChild(sub);
        b.addEventListener('click', function () { abrirCapitulo(c.chave, null); });
        li.appendChild(b);
        var extra = el('div', 'cap-extra');
        var ba = el('button', 'btn btn-pequeno', 'Ver avisos');
        ba.type = 'button';
        ba.addEventListener('click', function () { mostrarRelatorioDe(c); });
        var br = el('button', 'btn btn-pequeno btn-perigo', 'Remover');
        br.type = 'button';
        br.addEventListener('click', function () { removerCapitulo(c); });
        extra.appendChild(ba); extra.appendChild(br);
        li.appendChild(extra);
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      cont.appendChild(sec);
    });
    atualizarEstadoBib();
  }

  function atualizarEstadoBib() {
    var instalado = estaInstalado();
    $('estado-bib').textContent = 'Versão ' + VERSAO_APP + ' · ' + (instalado ? 'aberto como app instalado' : 'aberto no navegador');
  }

  function removerCapitulo(c) {
    var ok = window.confirm('Remover ' + rotuloCapitulo(c) + ' deste aparelho? O arquivo .txt original não é afetado.');
    if (!ok) return;
    DB.apagar(c.chave).then(function () {
      delete posicoes.porCapitulo[c.chave];
      if (posicoes.ultima && posicoes.ultima.chave === c.chave) posicoes.ultima = null;
      salvarPosicoes();
      if (fitas[c.livro] && fitas[c.livro].chave === c.chave) { delete fitas[c.livro]; salvarFitas(); }
      return carregarCapitulos();
    }).then(renderBiblioteca).then(function () { toast('Capítulo removido.'); });
  }

  /* ---------------- importação ---------------- */
  function decodificar(buf) {
    var bytes = new Uint8Array(buf);
    try {
      return { texto: new TextDecoder('utf-8', { fatal: true }).decode(bytes), latin: false };
    } catch (e) {
      return { texto: new TextDecoder('windows-1252').decode(bytes), latin: true };
    }
  }

  function lerArquivo(arq) {
    if (arq.arrayBuffer) return arq.arrayBuffer();
    return new Promise(function (ok, erro) {
      var fr = new FileReader();
      fr.onload = function () { ok(fr.result); };
      fr.onerror = function () { erro(fr.error); };
      fr.readAsArrayBuffer(arq);
    });
  }

  function importarTexto(texto, nomeArquivo, latin) {
    var cap = P.analisar(texto, { nomeArquivo: nomeArquivo || null });
    if (latin) cap.avisos.unshift({ linha: 1, tipo: 'codificacao', mensagem: 'O arquivo não estava em UTF-8; foi lido como Windows-1252. Confira os acentos e salve em UTF-8.', item: null });
    var resultado = { nome: nomeArquivo || 'texto colado', cap: cap, gravado: false, erro: null };
    if (!cap.chave) {
      resultado.erro = 'Não deu para identificar o capítulo: o cabeçalho precisa de @livro e @capitulo' + ((cap.cabecalho.livro || '').toUpperCase() === 'LE' ? ' e @parte' : '') + '. Nada foi guardado.';
      return Promise.resolve(resultado);
    }
    var cab = cap.cabecalho;
    var nums = cap.itens.map(function (i) { return i.num; }).filter(function (n) { return n !== null; });
    var reg = {
      chave: cap.chave,
      livro: cab.livro,
      parte: cab.parte ? parseInt(cab.parte, 10) : null,
      capitulo: parseInt(cab.capitulo, 10),
      titulo: cab.titulo || '',
      edicao: cab.edicao || '',
      nomeArquivo: nomeArquivo || null,
      texto: texto,
      importadoEm: new Date().toISOString(),
      nAvisos: cap.avisos.length + cap.conferir.length,
      itensDe: nums.length ? Math.min.apply(null, nums) : null,
      itensAte: nums.length ? Math.max.apply(null, nums) : null
    };
    return DB.obter(reg.chave).then(function (antigo) {
      if (antigo) return DB.guardarAnterior(antigo);
    }).then(function () {
      return DB.gravar(reg);
    }).then(function () {
      resultado.gravado = true;
      resultado.reg = reg;
      return resultado;
    }).catch(function (e) {
      resultado.erro = 'Falha ao guardar no aparelho: ' + (e && e.message ? e.message : e);
      return resultado;
    });
  }

  function importarArquivos(lista) {
    var arquivos = Array.prototype.slice.call(lista || []);
    if (!arquivos.length) return;
    pedirPersistencia();
    var resultados = [];
    var seq = Promise.resolve();
    arquivos.forEach(function (arq) {
      seq = seq.then(function () {
        return lerArquivo(arq).then(function (buf) {
          var d = decodificar(buf);
          if (/\u0000/.test(d.texto.slice(0, 2000))) {
            resultados.push({ nome: arq.name, cap: null, gravado: false, erro: 'Este arquivo não parece ser texto (.txt).' });
            return;
          }
          return importarTexto(d.texto, arq.name, d.latin).then(function (r) { resultados.push(r); });
        }).catch(function (e) {
          resultados.push({ nome: arq.name, cap: null, gravado: false, erro: 'Não deu para ler o arquivo: ' + (e && e.message ? e.message : e) });
        });
      });
    });
    seq.then(carregarCapitulos).then(function () { mostrarRelatorio(resultados); });
  }

  function mostrarRelatorioDe(reg) {
    var cap = P.analisar(reg.texto, { nomeArquivo: reg.nomeArquivo });
    mostrarRelatorio([{ nome: reg.nomeArquivo || rotuloCapitulo(reg), cap: cap, gravado: true, reg: reg, erro: null }], true);
  }

  function linhaAviso(a) {
    var li = el('li');
    li.appendChild(el('span', 'ln', 'Linha ' + a.linha + (a.item ? ' · item ' + a.item : '') + ':'));
    li.appendChild(document.createTextNode(a.mensagem || a.texto || ''));
    return li;
  }

  function mostrarRelatorio(resultados, soConsulta) {
    var cont = $('rel-conteudo');
    cont.textContent = '';
    $('rel-titulo').textContent = soConsulta ? 'Avisos do capítulo' : 'Importação';
    resultados.forEach(function (r) {
      var box = el('article', 'rel-arquivo' + (r.erro ? ' rel-erro' : ''));
      if (r.erro) {
        box.appendChild(el('h2', null, r.nome));
        box.appendChild(el('p', null, r.erro));
      } else {
        var reg = r.reg;
        box.appendChild(el('h2', null, (NOMES_LIVRO[reg.livro] ? CURTO_LIVRO[reg.livro] + ' · ' : '') + rotuloCapitulo(reg) + (reg.titulo ? ' — ' + reg.titulo : '')));
        var st = r.cap.estatisticas;
        var resumo = st.itens + (st.itens === 1 ? ' item' : ' itens') + ', ' + st.paragrafos + ' parágrafos';
        if (st.paginaInicial !== null) resumo += ', páginas ' + st.paginaInicial + (st.paginaFinal !== st.paginaInicial ? ' a ' + st.paginaFinal : '');
        resumo += ' · arquivo: ' + r.nome;
        box.appendChild(el('p', 'rel-resumo', resumo));
        if (!r.cap.avisos.length && !r.cap.conferir.length) box.appendChild(el('p', 'rel-ok', 'Nenhum problema encontrado.'));
        if (r.cap.avisos.length) {
          box.appendChild(el('h3', null, r.cap.avisos.length + (r.cap.avisos.length === 1 ? ' aviso' : ' avisos') + ' (a leitura funciona mesmo assim)'));
          var ul = el('ul', 'rel-lista');
          r.cap.avisos.forEach(function (a) { ul.appendChild(linhaAviso(a)); });
          box.appendChild(ul);
        }
        if (r.cap.conferir.length) {
          box.appendChild(el('h3', null, r.cap.conferir.length + ' pendência(s) marcadas com # CONFERIR'));
          var ul2 = el('ul', 'rel-lista conferir');
          r.cap.conferir.forEach(function (a) { ul2.appendChild(linhaAviso(a)); });
          box.appendChild(ul2);
        }
        var bl = el('button', 'btn btn-grande btn-primario', 'Ler este capítulo');
        bl.type = 'button';
        bl.addEventListener('click', function () { abrirCapitulo(reg.chave, null); });
        box.appendChild(bl);
      }
      cont.appendChild(box);
    });
    mostrarVista('relatorio');
  }

  function pedirPersistencia() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().then(function () { atualizarDiag(); });
      }
    } catch (e) { /* sem suporte */ }
  }

  /* ---------------- montagem do documento ---------------- */
  function montarBlocos(cap) {
    var blocos = [];
    function add(b) {
      b.id = blocos.length;
      b.italicos = b.italicos || [];
      b.navegavel = b.navegavel !== false && !!b.texto;
      b.frases = !b.navegavel ? [] : (b.dividir ? P.dividirFrases(b.texto) : [[0, b.texto.length]]);
      if (b.navegavel && !b.frases.length) b.frases = [[0, b.texto.length]];
      blocos.push(b);
      return b;
    }
    var cab = cap.cabecalho;
    add({ tipo: 'cap', texto: cab.titulo || rotuloCapitulo(estado.reg), item: '_cap', par: '0', dividir: false });

    // A tela mostra o texto item a item. As marcas de página do arquivo
    // servem para juntar os parágrafos e conferir a digitação, não aparecem.
    var secaoAtual = -1;
    cap.itens.forEach(function (it) {
      while (secaoAtual < it.secao) {
        secaoAtual++;
        var s = cap.secoes[secaoAtual];
        if (s) add({ tipo: 'secao', texto: s.titulo, item: '_s' + secaoAtual, par: '0', dividir: false });
      }
      var primeiro = true;
      function depois(b) {
        if (!primeiro) return;
        primeiro = false;
        b.numeroItem = it.numero;
        b.inicioItem = true;
      }
      if (it.titulo) {
        depois(add({ tipo: 'titulo', texto: it.titulo, italicos: it.tituloItalicos || [], item: it.numero, par: 't', dividir: false }));
      }
      var corpo = [], notas = [];
      it.paragrafos.forEach(function (p, k) { (p.tipo === 'N' ? notas : corpo).push({ p: p, k: k }); });
      function addPar(o, extraCls) {
        var p = o.p;
        depois(add({
          tipo: 'par', subtipo: p.tipo, texto: p.texto, italicos: p.italicos,
          item: it.numero, par: 'p' + o.k, dividir: true, extraCls: extraCls || ''
        }));
      }
      corpo.forEach(function (o) { addPar(o); });
      if (it.assinatura) {
        depois(add({ tipo: 'assin', texto: it.assinatura, italicos: it.assinaturaItalicos || [], item: it.numero, par: 'a', dividir: false }));
      }
      notas.forEach(function (o, i) { addPar(o, i === 0 ? 'nota-inicio' : ''); });
    });
    return blocos;
  }

  function montarUnidades() {
    var u = [];
    estado.blocos.forEach(function (b) {
      if (!b.navegavel) return;
      if (prefs.unidade === 'paragrafo') u.push({ b: b.id, f: -1 });
      else b.frases.forEach(function (fr, i) { u.push({ b: b.id, f: i }); });
    });
    estado.unidades = u;
  }

  function preencherBloco(node, b) {
    var t = b.texto;
    var cortes = {};
    cortes[0] = 1; cortes[t.length] = 1;
    b.frases.forEach(function (fr) { cortes[fr[0]] = 1; cortes[fr[1]] = 1; });
    b.italicos.forEach(function (it) { cortes[it[0]] = 1; cortes[it[1]] = 1; });
    var pts = Object.keys(cortes).map(Number).sort(function (a, c) { return a - c; });
    b.spans = b.frases.map(function () { return []; });
    var fi = 0;
    for (var k = 0; k < pts.length; k++) {
      var pos = pts[k];
      if (k === pts.length - 1) break;
      var a = pos, z = pts[k + 1];
      if (a === z) continue;
      var s = t.slice(a, z);
      while (fi < b.frases.length && b.frases[fi][1] <= a) fi++;
      var dentro = fi < b.frases.length && b.frases[fi][0] <= a && z <= b.frases[fi][1];
      var ital = b.italicos.some(function (it) { return it[0] <= a && z <= it[1]; });
      var conteudo = ital ? el('em', null, s) : document.createTextNode(s);
      if (dentro) {
        var sp = el('span', 'f');
        sp.setAttribute('data-b', b.id);
        sp.setAttribute('data-f', fi);
        sp.appendChild(conteudo);
        b.spans[fi].push(sp);
        node.appendChild(sp);
      } else {
        node.appendChild(conteudo);
      }
    }
  }

  function renderTexto() {
    var main = $('texto');
    main.textContent = '';
    var reg = estado.reg;
    estado.blocos.forEach(function (b) {
      var node;
      if (b.tipo === 'cap') {
        main.appendChild(el('p', 'b-cap-rotulo', (CURTO_LIVRO[reg.livro] || reg.livro) + ' · ' + rotuloCapitulo(reg)));
        node = el('h1', 'b b-cap');
      } else if (b.tipo === 'secao') node = el('h2', 'b b-secao');
      else if (b.tipo === 'titulo') node = el('h3', 'b b-titulo');
      else if (b.tipo === 'assin') node = el('p', 'b b-assin');
      else node = el('p', 'b b-par t-' + b.subtipo + (b.extraCls ? ' ' + b.extraCls : ''));
      if (b.inicioItem) node.classList.add('item-inicio');
      node.setAttribute('data-bloco', b.id);
      if (b.inicioItem) node.id = 'item-' + b.numeroItem;
      if (b.numeroItem !== undefined && b.numeroItem !== null && b.tipo !== 'assin') {
        node.appendChild(el('span', 'num', b.numeroItem + '.'));
      }
      preencherBloco(node, b);
      b.node = node;
      main.appendChild(node);
    });
    main.appendChild(el('p', 'fim-capitulo', '— fim do capítulo ' + romano(reg.capitulo) + ' —'));
    var marcador = el('div');
    marcador.id = 'marcador';
    marcador.hidden = true;
    main.appendChild(marcador);
    var fita = el('div');
    fita.id = 'fita';
    fita.hidden = true;
    fita.setAttribute('aria-hidden', 'true');
    main.appendChild(fita);
  }

  /* ---------------- âncoras ---------------- */
  function ancoraDe(idx) {
    var u = estado.unidades[idx];
    if (!u) return null;
    var b = estado.blocos[u.b];
    var f = u.f < 0 ? 0 : u.f;
    var fr = b.frases[f] || [0, b.texto.length];
    return {
      livro: estado.reg.livro,
      chave: estado.reg.chave,
      item: b.item,
      par: b.par,
      frase: f,
      inicio: b.texto.slice(fr[0], fr[0] + 40)
    };
  }

  function indiceDeBlocoFrase(bId, f) {
    for (var i = 0; i < estado.unidades.length; i++) {
      var u = estado.unidades[i];
      if (u.b === bId && (u.f === f || u.f === -1)) return i;
    }
    return -1;
  }

  function localizar(a) {
    if (!a || !estado.blocos.length) return 0;
    var blocos = estado.blocos;
    var i, b, fr;
    // 1) mesmo item, parágrafo e frase, com o mesmo começo
    for (i = 0; i < blocos.length; i++) {
      b = blocos[i];
      if (b.item === a.item && b.par === a.par && b.navegavel) {
        fr = b.frases[a.frase];
        if (fr && b.texto.slice(fr[0], fr[0] + 40) === a.inicio) return Math.max(0, indiceDeBlocoFrase(b.id, a.frase));
      }
    }
    // 2) mesmo começo de frase: primeiro no mesmo item, depois no capítulo inteiro
    if (a.inicio) {
      var achado = -1;
      for (var passo = 0; passo < 2 && achado < 0; passo++) {
        for (i = 0; i < blocos.length && achado < 0; i++) {
          b = blocos[i];
          if (!b.navegavel || (passo === 0 && b.item !== a.item)) continue;
          for (var k = 0; k < b.frases.length; k++) {
            if (b.texto.slice(b.frases[k][0], b.frases[k][0] + 40) === a.inicio) { achado = indiceDeBlocoFrase(b.id, k); break; }
          }
        }
      }
      if (achado >= 0) return achado;
    }
    // 3) mesmo item e parágrafo (frase limitada ao que existe)
    for (i = 0; i < blocos.length; i++) {
      b = blocos[i];
      if (b.item === a.item && b.par === a.par && b.navegavel) {
        return Math.max(0, indiceDeBlocoFrase(b.id, Math.min(a.frase, b.frases.length - 1)));
      }
    }
    // 4) começo do mesmo item
    for (i = 0; i < blocos.length; i++) {
      b = blocos[i];
      if (b.item === a.item && b.navegavel) return Math.max(0, indiceDeBlocoFrase(b.id, 0));
    }
    return 0;
  }

  /* ---------------- leitor ---------------- */
  function abrirCapitulo(chave, ancora, opcoes) {
    opcoes = opcoes || {};
    return DB.obter(chave).then(function (reg) {
      if (!reg) { toast('Capítulo não encontrado neste aparelho.'); return false; }
      estado.reg = reg;
      estado.cap = P.analisar(reg.texto, { nomeArquivo: reg.nomeArquivo });
      estado.blocos = montarBlocos(estado.cap);
      montarUnidades();
      mostrarVista('leitor');
      $('topo-titulo').textContent = (CURTO_LIVRO[reg.livro] || reg.livro) + ' · ' + rotuloCapitulo(reg, true) + (reg.titulo ? ' — ' + reg.titulo : '');
      renderTexto();
      var a = ancora || posicoes.porCapitulo[chave] || null;
      var idx = a ? localizar(a) : 0;
      estado.idx = -1;
      // espera a fonte para medir posições corretamente
      var pronto = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
      return pronto.then(function () {
        irPara(idx, { rolar: 'instantaneo', origem: 'abrir' });
        atualizarFita();
        return true;
      });
    });
  }

  function irPara(idx, op) {
    op = op || {};
    if (!estado.unidades.length) return;
    idx = Math.max(0, Math.min(estado.unidades.length - 1, idx));
    var anterior = estado.unidades[estado.idx];
    if (anterior) desmarcar(anterior);
    estado.idx = idx;
    var u = estado.unidades[idx];
    marcar(u);
    posicionarMarcador(u);
    if (op.rolar !== 'nao') rolarPara(u, op.rolar === 'instantaneo', op.origem === 'toque');
    atualizarBotoesNav();
    var a = ancoraDe(idx);
    posicoes.ultima = a;
    posicoes.porCapitulo[a.chave] = a;
    salvarPosicoes();
  }

  function spansDe(u) {
    var b = estado.blocos[u.b];
    if (u.f < 0) return [];
    return b.spans[u.f] || [];
  }

  function marcar(u) {
    var b = estado.blocos[u.b];
    if (u.f < 0) b.node.classList.add('bloco-ativo');
    else spansDe(u).forEach(function (s) { s.classList.add('ativa'); });
  }
  function desmarcar(u) {
    var b = estado.blocos[u.b];
    if (!b) return;
    b.node.classList.remove('bloco-ativo');
    if (u.f >= 0) spansDe(u).forEach(function (s) { s.classList.remove('ativa'); });
  }

  function alvoDe(u) {
    var b = estado.blocos[u.b];
    var sp = u.f < 0 ? (b.spans && b.spans[0]) || [] : spansDe(u);
    return sp.length ? sp[0] : b.node;
  }

  function topoRelativoAoTexto(node) {
    var main = $('texto');
    var r = node.getBoundingClientRect();
    var rm = main.getBoundingClientRect();
    var rects = node.getClientRects();
    var top = rects.length ? rects[0].top : r.top;
    return top - rm.top;
  }

  function posicionarMarcador(u) {
    var m = $('marcador');
    if (!m || !u) return;
    var alvo = alvoDe(u);
    var rects = alvo.getClientRects();
    var rm = $('texto').getBoundingClientRect();
    var top = (rects.length ? rects[0].top : alvo.getBoundingClientRect().top) - rm.top;
    var h = rects.length ? rects[0].height : 24;
    m.style.top = (top + Math.max(0, (h - m.offsetHeight) / 2)) + 'px';
    m.hidden = false;
  }

  function rolarPara(u, instantaneo, porToque) {
    var alvo = alvoDe(u);
    var rects = alvo.getClientRects();
    var top = rects.length ? rects[0].top : alvo.getBoundingClientRect().top;
    var vh = window.innerHeight;
    var topoBarra = $('barra-topo').getBoundingClientRect().bottom;
    var desejado = topoBarra + (vh - topoBarra) * 0.22;
    if (porToque) {
      // por toque: só rola se a frase estiver fora da faixa superior
      if (top >= topoBarra + 8 && top <= vh * 0.5) return;
    }
    var reduzir = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: Math.max(0, window.scrollY + top - desejado), behavior: (instantaneo || reduzir) ? 'auto' : 'smooth' });
  }

  function proximoCapitulo(delta) {
    var lista = estado.capitulos.filter(function (c) { return c.livro === estado.reg.livro; });
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].chave === estado.reg.chave) return lista[i + delta] || null;
    }
    return null;
  }

  function atualizarBotoesNav() {
    var fim = estado.idx >= estado.unidades.length - 1;
    var inicio = estado.idx <= 0;
    var prox = proximoCapitulo(1);
    var ant = proximoCapitulo(-1);
    $('btn-anterior').disabled = inicio && !ant;
    $('btn-anterior').querySelector('span').textContent = inicio && ant ? 'Cap. anterior' : 'Anterior';
    $('btn-proxima').disabled = fim && !prox;
    $('rotulo-proxima').textContent = fim ? (prox ? 'Próx. capítulo' : 'Fim') : 'Próxima';
  }

  function avancar(delta) {
    if (estado.vista !== 'leitor') return;
    var n = estado.idx + delta;
    if (n >= estado.unidades.length) {
      var prox = proximoCapitulo(1);
      if (prox) abrirCapitulo(prox.chave, null).then(function (ok) { if (ok) irPara(0, { rolar: 'instantaneo' }); });
      return;
    }
    if (n < 0) {
      var ant = proximoCapitulo(-1);
      if (ant) abrirCapitulo(ant.chave, null).then(function (ok) { if (ok) irPara(estado.unidades.length - 1, { rolar: 'instantaneo' }); });
      return;
    }
    irPara(n, {});
  }

  /* ---------------- fitilho ---------------- */
  function atualizarFita() {
    var f = estado.reg ? fitas[estado.reg.livro] : null;
    var btn = $('btn-fitilho');
    var aqui = !!(f && f.chave === estado.reg.chave);
    btn.classList.toggle('com-fita', !!f);
    btn.setAttribute('aria-label', 'Pôr o fitilho aqui');
    var fita = $('fita');
    if (!fita) return;
    if (!aqui) { fita.hidden = true; return; }
    var idx = localizar(f);
    var u = estado.unidades[idx];
    if (!u) { fita.hidden = true; return; }
    var alvo = alvoDe(u);
    fita.style.top = (topoRelativoAoTexto(alvo) - 4) + 'px';
    fita.hidden = false;
  }

  function porFitilho() {
    if (!estado.reg || estado.idx < 0) return;
    var a = ancoraDe(estado.idx);
    var antes = fitas[a.livro];
    fitas[a.livro] = a;
    salvarFitas();
    atualizarFita();
    toast(antes && antes.chave !== a.chave ? 'Fitilho movido para cá (era em ' + descreverAncora(antes) + ').' : 'Fitilho colocado aqui: paramos aqui.');
  }

  function irAoFitilho() {
    var f = estado.reg ? fitas[estado.reg.livro] : null;
    if (!f) { toast('Ainda não há fitilho neste livro.'); return; }
    fecharPaineis();
    if (f.chave === estado.reg.chave) irPara(localizar(f), {});
    else abrirCapitulo(f.chave, f);
  }

  function tirarFitilho() {
    if (!estado.reg) return;
    delete fitas[estado.reg.livro];
    salvarFitas();
    atualizarFita();
    fecharPaineis();
    toast('Fitilho retirado deste livro.');
  }

  /* ---------------- índice ---------------- */
  function renderIndice() {
    var corpo = $('ind-corpo');
    corpo.textContent = '';
    var reg = estado.reg, cap = estado.cap;
    var botoes = el('div', 'ind-botoes');
    var f = fitas[reg.livro];
    if (f) {
      var bf = el('button', 'btn btn-grande btn-fita', 'Ir ao fitilho');
      bf.type = 'button';
      bf.appendChild(el('span', 'esc-onde', ' ' + descreverAncora(f)));
      bf.style.flexDirection = 'column';
      bf.addEventListener('click', irAoFitilho);
      botoes.appendChild(bf);
    }
    var bb = el('button', 'btn btn-grande', 'Biblioteca (todos os capítulos)');
    bb.type = 'button';
    bb.addEventListener('click', function () { fecharPaineis(); voltarBiblioteca(); });
    botoes.appendChild(bb);
    corpo.appendChild(botoes);

    corpo.appendChild(el('p', 'ind-cap-rot', (CURTO_LIVRO[reg.livro] || reg.livro) + ' · ' + rotuloCapitulo(reg)));
    corpo.appendChild(el('h3', 'ind-cap', reg.titulo || ''));

    var uAtual = estado.unidades[estado.idx];
    var itemAtual = uAtual ? estado.blocos[uAtual.b].item : null;
    var secaoAtual = -2;
    var ul = el('ul', 'ind-lista');
    corpo.appendChild(ul);
    cap.itens.forEach(function (it) {
      if (it.secao !== secaoAtual) {
        secaoAtual = it.secao;
        if (it.secao >= 0 && cap.secoes[it.secao]) {
          corpo.appendChild(el('p', 'ind-secao', cap.secoes[it.secao].titulo));
          ul = el('ul', 'ind-lista');
          corpo.appendChild(ul);
        }
      }
      var li = el('li');
      var b = el('button', 'ind-item' + (it.numero === itemAtual ? ' atual' : ''));
      b.type = 'button';
      b.appendChild(el('span', 'ind-num', it.numero));
      var tit = it.titulo;
      var span;
      if (tit) span = el('span', 'ind-tit', tit);
      else {
        var p0 = it.paragrafos[0];
        var t0 = p0 ? p0.texto : '';
        span = el('span', 'ind-tit sem-titulo', t0.length > 70 ? t0.slice(0, 70).replace(/\s+\S*$/, '') + '…' : t0);
      }
      b.appendChild(span);
      if (f && f.chave === reg.chave && f.item === it.numero) b.appendChild(el('span', 'ind-fita', 'fitilho'));
      b.addEventListener('click', function () {
        fecharPaineis();
        for (var i = 0; i < estado.blocos.length; i++) {
          var bl = estado.blocos[i];
          if (bl.item === it.numero && bl.navegavel) { irPara(indiceDeBlocoFrase(bl.id, 0), {}); return; }
        }
      });
      li.appendChild(b);
      ul.appendChild(li);
    });

    var ant = proximoCapitulo(-1), prox = proximoCapitulo(1);
    if (ant || prox) {
      var nav = el('div', 'ind-botoes');
      nav.style.marginTop = '20px';
      if (ant) {
        var ba = el('button', 'btn', '← ' + rotuloCapitulo(ant, true));
        ba.type = 'button';
        ba.addEventListener('click', function () { fecharPaineis(); abrirCapitulo(ant.chave, null); });
        nav.appendChild(ba);
      }
      if (prox) {
        var bp = el('button', 'btn', rotuloCapitulo(prox, true) + ' →');
        bp.type = 'button';
        bp.addEventListener('click', function () { fecharPaineis(); abrirCapitulo(prox.chave, null); });
        nav.appendChild(bp);
      }
      corpo.appendChild(nav);
    }
  }

  /* ---------------- painéis ---------------- */
  var painelAberto = null;
  function abrirPainel(id) {
    fecharPaineis();
    if (id === 'painel-indice') renderIndice();
    if (id === 'painel-config') renderConfig();
    $('painel-fundo').hidden = false;
    $(id).hidden = false;
    painelAberto = id;
    if (id === 'painel-indice') {
      var atual = $(id).querySelector('.ind-item.atual');
      if (atual) atual.scrollIntoView({ block: 'center' });
    }
  }
  function fecharPaineis() {
    ['painel-indice', 'painel-config', 'painel-colar'].forEach(function (p) { $(p).hidden = true; });
    $('painel-fundo').hidden = true;
    painelAberto = null;
  }

  function renderConfig() {
    var radios = document.querySelectorAll('input[name="unidade"]');
    Array.prototype.forEach.call(radios, function (r) { r.checked = r.value === prefs.unidade; });
    $('cfg-tela').checked = !!prefs.telaAcesa;
    $('cfg-tamanho').textContent = prefs.tamanho + ' px';
    var cc = $('cfg-capitulo');
    cc.textContent = '';
    if (estado.vista === 'leitor' && estado.reg) {
      cc.appendChild(el('h3', null, 'Este capítulo'));
      var b1 = el('button', 'btn', 'Ver avisos da importação');
      b1.type = 'button';
      b1.addEventListener('click', function () { fecharPaineis(); mostrarRelatorioDe(estado.reg); });
      cc.appendChild(b1);
      if (fitas[estado.reg.livro]) {
        var b2 = el('button', 'btn btn-perigo', 'Tirar o fitilho deste livro');
        b2.type = 'button';
        b2.style.marginLeft = '8px';
        b2.addEventListener('click', tirarFitilho);
        cc.appendChild(b2);
      }
    }
    atualizarDiag();
  }

  function linhaDiag(dl, rotulo, valor, ok) {
    dl.appendChild(el('dt', null, rotulo));
    var dd = el('dd', ok === true ? 'sim' : ok === false ? 'nao' : null, valor);
    dl.appendChild(dd);
  }

  function atualizarDiag() {
    var dl = $('cfg-diag');
    if (!dl) return;
    dl.textContent = '';
    var t = Tela.estado();
    linhaDiag(dl, 'Tela acesa', t.texto, t.ok);
    linhaDiag(dl, 'Aberto como', estaInstalado() ? 'app instalado' : 'página no navegador', estaInstalado());
    linhaDiag(dl, 'Funciona sem internet', navigator.serviceWorker && navigator.serviceWorker.controller ? 'sim' : 'ainda não (abra de novo)', !!(navigator.serviceWorker && navigator.serviceWorker.controller));
    var ddPers = { texto: 'verificando…', ok: null };
    linhaDiag(dl, 'Textos protegidos', ddPers.texto, ddPers.ok);
    var alvo = dl.lastChild;
    if (navigator.storage && navigator.storage.persisted) {
      navigator.storage.persisted().then(function (p) {
        alvo.textContent = p ? 'sim (armazenamento persistente)' : 'não garantido pelo navegador';
        alvo.className = p ? 'sim' : 'nao';
      }).catch(function () { alvo.textContent = 'sem informação'; });
    } else { alvo.textContent = 'sem informação'; }
    linhaDiag(dl, 'Capítulos guardados', String(estado.capitulos.length), null);
    linhaDiag(dl, 'Versão', 'app ' + VERSAO_APP + ' · parser ' + P.VERSAO, null);
  }

  function mudarTamanho(delta) {
    var antes = estado.idx;
    prefs.tamanho = Math.max(TAM_MIN, Math.min(TAM_MAX, prefs.tamanho + delta));
    salvarPrefs();
    aplicarClassesCorpo();
    $('cfg-tamanho').textContent = prefs.tamanho + ' px';
    if (estado.vista === 'leitor' && antes >= 0) {
      var u = estado.unidades[antes];
      requestAnimationFrame(function () {
        posicionarMarcador(u);
        atualizarFita();
        rolarPara(u, true, false);
      });
    }
  }

  function mudarUnidade(nova) {
    if (nova === prefs.unidade) return;
    var a = estado.reg && estado.idx >= 0 ? ancoraDe(estado.idx) : null;
    prefs.unidade = nova;
    salvarPrefs();
    if (estado.vista === 'leitor' && estado.reg) {
      var u0 = estado.unidades[estado.idx];
      if (u0) desmarcar(u0);
      montarUnidades();
      estado.idx = -1;
      irPara(a ? localizar(a) : 0, { rolar: 'instantaneo' });
    }
  }

  function voltarBiblioteca() {
    carregarCapitulos().then(function () { renderBiblioteca(); mostrarVista('biblioteca'); });
  }

  /* ---------------- tela acesa ---------------- */
  var Tela = {
    lock: null, modo: null, erro: null, querAtivo: false,
    suportaWakeLock: function () { return 'wakeLock' in navigator; },
    pedir: function () {
      Tela.querAtivo = true;
      if (!prefs.telaAcesa) { Tela.soltar(true); return; }
      if (document.visibilityState !== 'visible') return;
      if (Tela.suportaWakeLock()) {
        if (Tela.lock) return;
        navigator.wakeLock.request('screen').then(function (l) {
          Tela.lock = l; Tela.modo = 'wakelock'; Tela.erro = null;
          l.addEventListener('release', function () { Tela.lock = null; if (Tela.modo === 'wakelock') Tela.modo = null; atualizarDiag(); });
          atualizarDiag();
        }).catch(function (e) {
          Tela.erro = e && e.name ? e.name : String(e);
          Tela.video();
        });
      } else {
        Tela.video();
      }
    },
    video: function () {
      var v = $('video-acordado');
      if (!v) return;
      var p = v.play();
      if (p && p.then) {
        p.then(function () { Tela.modo = 'video'; atualizarDiag(); })
          .catch(function () { Tela.modo = null; atualizarDiag(); });
      }
    },
    soltar: function (manterIntencao) {
      if (!manterIntencao) Tela.querAtivo = false;
      if (Tela.lock) { try { Tela.lock.release(); } catch (e) { /* ok */ } Tela.lock = null; }
      var v = $('video-acordado');
      if (v && !v.paused) v.pause();
      Tela.modo = null;
      atualizarDiag();
    },
    estado: function () {
      if (!prefs.telaAcesa) return { texto: 'desligado nas configurações', ok: false };
      if (Tela.modo === 'wakelock' && Tela.lock) return { texto: 'sim (Wake Lock)', ok: true };
      if (Tela.modo === 'video') return { texto: 'sim (alternativa por vídeo)', ok: true };
      if (estado.vista !== 'leitor') return { texto: 'só durante a leitura', ok: null };
      if (!Tela.suportaWakeLock()) return { texto: 'não (sem Wake Lock; toque no texto para tentar a alternativa)', ok: false };
      return { texto: 'não' + (Tela.erro ? ' (' + Tela.erro + ')' : ''), ok: false };
    }
  };
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Tela.querAtivo) {
      Tela.lock = null;
      Tela.pedir();
    }
  });

  function estaInstalado() {
    if (!window.matchMedia) return window.navigator.standalone === true;
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches ||
      window.navigator.standalone === true;
  }

  /* ---------------- instalação ---------------- */
  // Navegadores embutidos em outros apps (WebView): não instalam PWA.
  var RE_NAVEGADOR_INTERNO = /; wv\)|\bwv\b|WhatsApp|Instagram|FBAN|FBAV|FB_IAB|FBIOS|Line\/|MicroMessenger|Telegram|GSA\/|Snapchat|TikTok|musical_ly|Twitter/i;
  var Instalar = {
    evento: null,
    instaladoAgora: false,
    semEventoTimer: null,
    interno: function () { return RE_NAVEGADOR_INTERNO.test(navigator.userAgent || ''); },
    atualizar: function () {
      var caixa = $('instalar-caixa');
      if (!caixa) return;
      var instalado = estaInstalado() || Instalar.instaladoAgora;
      var interno = !instalado && Instalar.interno();
      var botao = !instalado && !interno && !!Instalar.evento;
      $('btn-instalar').hidden = !botao;
      $('instalar-interno').hidden = !interno;
      $('instalar-manual').hidden = instalado || interno || botao || !Instalar.esperouEvento;
      caixa.hidden = instalado || !(botao || interno || !$('instalar-manual').hidden);
    },
    iniciar: function () {
      window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();          // o próprio botão grande faz o convite
        Instalar.evento = e;
        Instalar.atualizar();
      });
      window.addEventListener('appinstalled', function () {
        Instalar.evento = null;
        Instalar.instaladoAgora = true;
        Instalar.atualizar();
        toast('App instalado. Daqui em diante, abra pelo ícone “Evangelho no Lar” na tela inicial.', 6000);
      });
      if (window.matchMedia) {
        var mq = window.matchMedia('(display-mode: standalone)');
        var aoMudar = function () { Instalar.atualizar(); atualizarEstadoBib(); };
        if (mq.addEventListener) mq.addEventListener('change', aoMudar);
        else if (mq.addListener) mq.addListener(aoMudar);
      }
      // Se o Chrome não oferecer a instalação em alguns segundos, mostra o caminho pelo menu.
      Instalar.semEventoTimer = setTimeout(function () { Instalar.esperouEvento = true; Instalar.atualizar(); }, 4000);
      $('btn-instalar').addEventListener('click', function () {
        var e = Instalar.evento;
        if (!e) { Instalar.atualizar(); return; }
        Instalar.evento = null;      // o convite só pode ser usado uma vez
        e.prompt();
        e.userChoice.then(function (r) {
          if (r && r.outcome === 'accepted') {
            Instalar.instaladoAgora = true;
            toast('Instalando… o ícone “Evangelho no Lar” vai aparecer na tela inicial.', 6000);
          } else {
            toast('Instalação cancelada. Para instalar depois: ⋮ → Instalar app.', 5000);
          }
          Instalar.esperouEvento = true;
          Instalar.atualizar();
        }).catch(function () { Instalar.esperouEvento = true; Instalar.atualizar(); });
      });
      Instalar.atualizar();
    }
  };

  /* ---------------- início ---------------- */
  function mostrarEscolha(ult, fita) {
    $('esc-onde-fita').textContent = descreverAncora(fita);
    $('esc-onde-ult').textContent = descreverAncora(ult);
    $('escolha').hidden = false;
    return new Promise(function (ok) {
      function fim(qual) {
        $('escolha').hidden = true;
        $('esc-fitilho').removeEventListener('click', aFita);
        $('esc-continuar').removeEventListener('click', aCont);
        ok(qual);
      }
      function aFita() { fim('fita'); }
      function aCont() { fim('continuar'); }
      $('esc-fitilho').addEventListener('click', aFita);
      $('esc-continuar').addEventListener('click', aCont);
      $('esc-fitilho').focus();
    });
  }

  function existe(chave) { return estado.capitulos.some(function (c) { return c.chave === chave; }); }

  function iniciar() {
    aplicarClassesCorpo();
    Instalar.iniciar();
    ligarEventos();
    registrarSW();
    carregarCapitulos().catch(function (e) {
      toast('Erro ao abrir o armazenamento do aparelho: ' + (e && e.message ? e.message : e), 6000);
      return [];
    }).then(function () {
      renderBiblioteca();
      var ult = posicoes.ultima && existe(posicoes.ultima.chave) ? posicoes.ultima : null;
      var livro = ult ? ult.livro : null;
      var fita = livro && fitas[livro] && existe(fitas[livro].chave) ? fitas[livro] : null;
      if (!ult) {
        // sem posição salva: se houver algum fitilho, oferece ir até ele
        var algum = Object.keys(fitas).map(function (k) { return fitas[k]; }).filter(function (f) { return f && existe(f.chave); })[0];
        if (algum) return abrirCapitulo(algum.chave, algum);
        mostrarVista('biblioteca');
        return;
      }
      if (fita && !mesmaPosicao(fita, ult)) {
        return abrirCapitulo(ult.chave, ult).then(function () {
          return mostrarEscolha(ult, fita);
        }).then(function (qual) {
          if (qual === 'fita') {
            if (fita.chave === estado.reg.chave) irPara(localizar(fita), {});
            else abrirCapitulo(fita.chave, fita);
          }
        });
      }
      return abrirCapitulo(ult.chave, ult);
    });
  }

  function ligarEventos() {
    $('btn-importar').addEventListener('click', function () { $('arquivo').value = ''; $('arquivo').click(); });
    $('arquivo').addEventListener('change', function (e) { importarArquivos(e.target.files); });
    $('btn-colar').addEventListener('click', function () { $('colar-area').value = ''; abrirPainel('painel-colar'); });
    $('btn-colar-ok').addEventListener('click', function () {
      var t = $('colar-area').value;
      if (!t.trim()) { toast('Cole o texto primeiro.'); return; }
      fecharPaineis();
      pedirPersistencia();
      importarTexto(t, null, false).then(function (r) {
        return carregarCapitulos().then(function () { mostrarRelatorio([r]); });
      });
    });
    $('btn-rel-voltar').addEventListener('click', voltarBiblioteca);
    $('btn-config-bib').addEventListener('click', function () { abrirPainel('painel-config'); });

    $('btn-indice').addEventListener('click', function () { abrirPainel('painel-indice'); });
    $('btn-config').addEventListener('click', function () { abrirPainel('painel-config'); });
    $('btn-menor').addEventListener('click', function () { mudarTamanho(-1); });
    $('btn-maior').addEventListener('click', function () { mudarTamanho(1); });
    $('cfg-menor').addEventListener('click', function () { mudarTamanho(-1); });
    $('cfg-maior').addEventListener('click', function () { mudarTamanho(1); });
    $('btn-fitilho').addEventListener('click', porFitilho);
    $('btn-anterior').addEventListener('click', function () { avancar(-1); });
    $('btn-proxima').addEventListener('click', function () { avancar(1); });

    $('painel-fundo').addEventListener('click', fecharPaineis);
    Array.prototype.forEach.call(document.querySelectorAll('[data-fechar]'), function (b) { b.addEventListener('click', fecharPaineis); });

    Array.prototype.forEach.call(document.querySelectorAll('input[name="unidade"]'), function (r) {
      r.addEventListener('change', function () { if (r.checked) mudarUnidade(r.value); });
    });
    $('cfg-tela').addEventListener('change', function (e) {
      prefs.telaAcesa = e.target.checked; salvarPrefs();
      if (prefs.telaAcesa && estado.vista === 'leitor') Tela.pedir(); else Tela.soltar(true);
      atualizarDiag();
    });

    // toque numa frase
    $('texto').addEventListener('click', function (e) {
      if (estado.vista !== 'leitor') return;
      var sel = window.getSelection && window.getSelection();
      if (sel && String(sel).length > 0) return; // seleção de texto, não toque
      if (Tela.querAtivo && prefs.telaAcesa && !Tela.lock && Tela.modo !== 'video') Tela.pedir();
      var sp = e.target.closest ? e.target.closest('.f') : null;
      var idx = -1;
      if (sp) idx = indiceDeBlocoFrase(+sp.getAttribute('data-b'), +sp.getAttribute('data-f'));
      else {
        var bl = e.target.closest ? e.target.closest('[data-bloco]') : null;
        if (bl) {
          var b = estado.blocos[+bl.getAttribute('data-bloco')];
          if (b && b.navegavel) idx = indiceDeBlocoFrase(b.id, 0);
        }
      }
      if (idx >= 0) irPara(idx, { origem: 'toque' });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { fecharPaineis(); return; }
      if (estado.vista !== 'leitor' || painelAberto || !$('escolha').hidden) return;
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ' || e.key === 'Enter') {
        if (e.target && e.target.tagName === 'BUTTON' && e.key !== 'ArrowRight' && e.key !== 'ArrowDown') return;
        e.preventDefault(); avancar(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault(); avancar(-1);
      }
    });

    var redim = null;
    window.addEventListener('resize', function () {
      clearTimeout(redim);
      redim = setTimeout(function () {
        if (estado.vista === 'leitor' && estado.idx >= 0) {
          var u = estado.unidades[estado.idx];
          posicionarMarcador(u); atualizarFita(); rolarPara(u, true, false);
        }
      }, 150);
    });
  }

  function registrarSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    var tinhaControle = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(function () { atualizarDiag(); }).catch(function () { /* sem SW */ });
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (tinhaControle) toast('O app foi atualizado. Feche e abra de novo para usar a versão nova.', 6000);
      atualizarDiag();
    });
  }

  if (!P) {
    document.body.textContent = 'Erro: parser.js não carregou.';
    return;
  }
  // exposto só para testes e diagnóstico
  window.Fitilho = { estado: estado, versao: VERSAO_APP };
  iniciar();
})();
