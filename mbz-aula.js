/* ==========================================================================
   Portal del Coordinador de Área — URP
   mbz-aula.js — lectura de la copia de seguridad del aula (.mbz) en el
   navegador y reglas fijas del módulo Aula virtual.
   --------------------------------------------------------------------------
   · El archivo se lee en el equipo del coordinador: no se sube a ningún
     servidor, ni a Drive, ni a una IA. Solo se leen los XML y los PDF.
   · Si la copia trae datos de estudiantes (usuarios), se detiene.
   · De los enlaces solo se conserva el dominio (la URL puede traer claves).
   · Los correos que aparecen en los textos se tapan.
   · No decide nada: sugiere. La decisión es del coordinador.
   Referencia: Traspaso v3 (24/10/2026) y analiza_mbz.py.
   ========================================================================== */
(function (raiz) {
  'use strict';

  const VERSION_REGLAS = 'mbz-2026-10-24.3';

  // Parámetros que todavía decide Patrick (Traspaso v3, sección 7). Se dejan
  // con la recomendación del traspaso y se pueden cambiar aquí.
  const REGLAS = {
    diasMaterial: 7,          // material: días antes del inicio de su semana
    semana1DesdeInicio: true, // semana 1: se mide contra el inicio del curso, no 7 días antes
    semanasSinMaterial: /^\s*(examen|evaluaci[oó]n final|sustentaci[oó]n de trabajos finales)/i,
    maxPdfMB: 40,             // PDF más grande que se lee (los videos nunca se leen)
    maxTotalPdfMB: 250        // tope de PDF guardados en memoria durante la lectura
  };

  const DIA = 86400, LIMA = -5 * 3600;   // Lima: UTC−5, sin horario de verano
  const diaLima = ts => Math.floor((ts + LIMA) / DIA);
  const dos = n => String(n).padStart(2, '0');
  const enLima = ts => new Date((ts + LIMA) * 1000);   // se leen los campos UTC
  const fecha = ts => { if (!ts) return '—'; const d = enLima(ts); return dos(d.getUTCDate()) + '/' + dos(d.getUTCMonth() + 1); };
  const fechaHora = ts => { if (!ts) return '—'; const d = enLima(ts);
    return fecha(ts) + '/' + d.getUTCFullYear() + ' a las ' + dos(d.getUTCHours()) + ':' + dos(d.getUTCMinutes()); };
  const fechaDeDia = d => fecha(d * DIA - LIMA + 12 * 3600);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const taparCorreos = s => String(s || '').replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[correo]');
  const y = l => l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' y ' + l[l.length - 1];
  const plural = (n, uno, varios) => n + ' ' + (n === 1 ? uno : varios);
  const diasTxt = d => d === 0 ? 'el mismo día' : Math.abs(d) + (Math.abs(d) === 1 ? ' día' : ' días') + (d > 0 ? ' antes' : ' después');

  /* ------------------------------------------------------------ librerías */
  function cargarScript(src) {
    return new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = () => mal(new Error('No se pudo cargar ' + src.split('/').pop()));
      document.head.appendChild(s);
    });
  }
  async function asegurarFflate() {
    if (!raiz.fflate) await cargarScript('https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js');
    return raiz.fflate;
  }
  async function asegurarPdf() {
    if (!raiz.pdfjsLib) {
      await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      raiz.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    return raiz.pdfjsLib;
  }

  /* ------------------------------------------- ¿es una copia de Moodle? */
  // El nombre puede llegar cambiado (p. ej. al reenviarse por correo), así
  // que además del «.mbz» se mira la firma del archivo: gzip o zip.
  async function esCopiaMbz(f) {
    if (!f) return false;
    if (/\.mbz(\b|$|[^a-z])/i.test(f.name || '')) return true;
    if (/\.(pdf|docx?|xlsx?|csv|txt|vtt|srt|md|png|jpe?g|webp)$/i.test(f.name || '')) return false;
    try {
      const b = new Uint8Array(await f.slice(0, 4).arrayBuffer());
      return b[0] === 0x1f && b[1] === 0x8b;
    } catch (e) { return false; }
  }
  async function buscarCopia(archivos) {
    for (const f of archivos || []) if (await esCopiaMbz(f)) return f;
    return null;
  }

  /* -------------------------------------------------- lectura por partes */
  // tar dentro de gzip, leído en trozos: nunca se carga el archivo entero.
  // Se guardan los XML y los PDF; lo demás (videos, imágenes) se salta.
  const RX_ARCH = /^files\/[0-9a-f]{2}\/([0-9a-f]{40})$/;
  function lectorTar(guardar) {
    let resto = new Uint8Array(0);
    let st = { modo: 'cab' }, nombreLargo = null, totalPdf = 0;
    const MAX = REGLAS.maxPdfMB * 1048576, MAXT = REGLAS.maxTotalPdfMB * 1048576;
    const txt = (b, i, n) => { let s = ''; for (let k = i; k < i + n && b[k]; k++) s += String.fromCharCode(b[k]); return s; };
    const utf8 = b => new TextDecoder('utf-8').decode(b);
    function tam(b) {
      if (b[124] & 0x80) { let v = 0; for (let k = 125; k < 136; k++) v = v * 256 + b[k]; return v; }
      return parseInt(txt(b, 124, 12).trim() || '0', 8) || 0;
    }
    function nombreDe(b) {
      let n = utf8(b.subarray(0, 100)).replace(/\0.*$/s, '');
      if (txt(b, 257, 5) === 'ustar') {
        const p = utf8(b.subarray(345, 500)).replace(/\0.*$/s, '');
        if (p) n = p + '/' + n;
      }
      return n.replace(/^\.\//, '');
    }
    function cerrar() {
      const e = st.e;
      if (e.decision === 'si' || e.decision === 'meta') {
        const datos = unir(e.partes, e.recogido);
        if (e.decision === 'meta') {
          if (e.tipo === 'L') nombreLargo = utf8(datos).replace(/\0.*$/s, '');
          else if (e.tipo === 'x') { const m = utf8(datos).match(/\d+ path=([^\n]*)\n/); if (m) nombreLargo = m[1]; }
        } else guardar(e.nombre, datos, e.tipoArch);
      }
    }
    function empujar(trozo) {
      let d = resto.length ? unir([resto, trozo], resto.length + trozo.length) : trozo, p = 0;
      while (p < d.length) {
        if (st.modo === 'cab') {
          if (d.length - p < 512) break;
          const h = d.subarray(p, p + 512); p += 512;
          let vacio = true; for (let k = 0; k < 512; k++) if (h[k]) { vacio = false; break; }
          if (vacio) continue;
          const tipo = String.fromCharCode(h[156] || 48);
          const nombre = nombreLargo || nombreDe(h); nombreLargo = null;
          const n = tam(h);
          const e = { nombre, tipo, n, partes: [], recogido: 0, decision: 'no', tipoArch: '' };
          if (tipo === 'L' || tipo === 'x') e.decision = 'meta';
          else if (tipo === '0' || tipo === '\0' || tipo === '7') {
            if (nombre === 'users.xml') e.decision = 'usuarios';     // nunca se lee: solo se avisa
            else if (/\.xml$/i.test(nombre) && n < 60 * 1048576) e.decision = 'si', e.tipoArch = 'xml';
            else if (RX_ARCH.test(nombre) && n <= MAX && totalPdf + n <= MAXT) e.decision = 'probar';
          }
          if (e.decision === 'usuarios') guardar(nombre, null, 'usuarios');
          st = { modo: n ? 'datos' : 'cab', e, falta: n, relleno: (512 - n % 512) % 512 };
          if (!n) { cerrar(); st = { modo: 'cab' }; }
        } else if (st.modo === 'datos') {
          const k = Math.min(st.falta, d.length - p), pieza = d.subarray(p, p + k), e = st.e;
          if (e.decision !== 'no' && e.decision !== 'usuarios') { e.partes.push(pieza.slice()); e.recogido += k; }
          if (e.decision === 'probar' && e.recogido >= 5) {
            const c = unir(e.partes, e.recogido).subarray(0, 5);
            if (c[0] === 0x25 && c[1] === 0x50 && c[2] === 0x44 && c[3] === 0x46) { e.decision = 'si'; e.tipoArch = 'pdf'; totalPdf += e.n; }
            else if (c[0] === 0x50 && c[1] === 0x4b && c[2] === 3 && c[3] === 4) { e.decision = 'si'; e.tipoArch = 'office'; totalPdf += e.n; }
            else { e.decision = 'no'; e.partes = []; }
          }
          p += k; st.falta -= k;
          if (!st.falta) { cerrar(); st = st.relleno ? { modo: 'relleno', relleno: st.relleno } : { modo: 'cab' }; }
        } else {
          const k = Math.min(st.relleno, d.length - p); p += k; st.relleno -= k;
          if (!st.relleno) st = { modo: 'cab' };
        }
      }
      resto = d.subarray(p).slice();
    }
    return { empujar };
  }
  function unir(partes, total) {
    if (partes.length === 1) return partes[0];
    const o = new Uint8Array(total); let k = 0;
    for (const x of partes) { o.set(x, k); k += x.length; }
    return o;
  }

  async function extraer(file, progreso) {
    const fflate = await asegurarFflate();
    const xml = {}, pdf = {}, office = {}, avisos = [];
    let usuarios = false;
    const guardar = (nombre, datos, tipo) => {
      if (tipo === 'usuarios') { usuarios = true; return; }
      if (tipo === 'xml') xml[nombre] = new TextDecoder('utf-8').decode(datos);
      else if (tipo === 'pdf') pdf[nombre.match(RX_ARCH)[1]] = datos;
      else if (tipo === 'office') office[nombre.match(RX_ARCH)[1]] = datos;
    };
    const cab = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (cab[0] === 0x50 && cab[1] === 0x4b) {
      // Formato zip (Moodle antiguo o «compatibilidad»): hay que abrirlo entero.
      const todo = new Uint8Array(await file.arrayBuffer());
      const r = fflate.unzipSync(todo, { filter: f => /\.xml$/i.test(f.name) || f.name === 'users.xml' ||
        (RX_ARCH.test(f.name) && f.originalSize <= REGLAS.maxPdfMB * 1048576) });
      Object.keys(r).forEach(n => {
        if (n === 'users.xml') usuarios = true;
        else if (/\.xml$/i.test(n)) xml[n] = new TextDecoder('utf-8').decode(r[n]);
        else { const d = r[n]; if (d[0] === 0x25 && d[1] === 0x50 && d[2] === 0x44 && d[3] === 0x46) pdf[n.match(RX_ARCH)[1]] = d;
          else if (d[0] === 0x50 && d[1] === 0x4b) office[n.match(RX_ARCH)[1]] = d; }
      });
      if (progreso) progreso(1);
      return { xml, pdf, office, usuarios, avisos };
    }
    if (!(cab[0] === 0x1f && cab[1] === 0x8b)) throw new Error('El archivo no parece una copia de seguridad de Moodle (.mbz).');
    const tar = lectorTar(guardar);
    const g = new fflate.Gunzip(trozo => tar.empujar(trozo));
    const lector = file.stream().getReader();
    let leidos = 0, ultimo = 0;
    for (;;) {
      const { value, done } = await lector.read();
      if (done) break;
      g.push(value, false);
      leidos += value.length;
      if (progreso && leidos - ultimo > 2 * 1048576) { ultimo = leidos; progreso(leidos / file.size); await new Promise(r => setTimeout(r, 0)); }
    }
    g.push(new Uint8Array(0), true);
    if (progreso) progreso(1);
    return { xml, pdf, office, usuarios, avisos };
  }

  // PowerPoint y Word: el texto de las dos primeras diapositivas o de los
  // primeros párrafos (son archivos zip con XML dentro).
  function lineasOffice(datos, nombre) {
    const fflate = raiz.fflate, rxPpt = /^ppt\/slides\/slide([12])\.xml$/, rxDoc = /^word\/document\.xml$/;
    const r = fflate.unzipSync(datos, { filter: f => rxPpt.test(f.name) || rxDoc.test(f.name) });
    const dec = b => new TextDecoder('utf-8').decode(b);
    const parrafos = (x, tag) => x.split(new RegExp('</' + tag + ':p>')).map(pz => (pz.match(new RegExp('<' + tag + ':t[^>]*>[^<]*</' + tag + ':t>', 'g')) || [])
      .map(t => t.replace(/<[^>]+>/g, '')).join('').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim()).filter(Boolean);
    const lineas = [];
    ['1', '2'].forEach(k => { const x = r['ppt/slides/slide' + k + '.xml']; if (x) { lineas.push(...parrafos(dec(x), 'a')); lineas.push('\f'); } });
    if (r['word/document.xml']) { lineas.push(...parrafos(dec(r['word/document.xml']), 'w').slice(0, 60)); lineas.push('\f'); }
    if (!lineas.length) throw new Error('sin texto');
    return { lineas, paginas: 0 };
  }

  /* --------------------------------------------------------------- XML */
  function parsearXml(s) {
    if (!s) return null;
    const d = new raiz.DOMParser().parseFromString(s, 'application/xml');
    return d && d.documentElement && d.documentElement.nodeName !== 'parsererror' ? d.documentElement : null;
  }
  const hijos = (el, tag) => el ? Array.prototype.filter.call(el.childNodes || [], n => n.nodeType === 1 && n.nodeName === tag) : [];
  const hijo = (el, tag) => hijos(el, tag)[0] || null;
  const ruta = (el, ...tags) => { for (const t of tags) el = hijo(el, t); return el; };
  const val = el => { const t = el ? el.textContent : ''; return t === '$@NULL@$' ? '' : (t || ''); };
  const num = el => parseInt(val(el), 10) || 0;
  const htmlATexto = h => taparCorreos(String(h || '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim());

  /* --------------------------------------------------------------- PDF */
  async function lineasPdf(datos, maxPag) {
    const pdfjs = await asegurarPdf();
    const doc = await pdfjs.getDocument({ data: datos.slice(), isEvalSupported: false }).promise;
    const lineas = [], n = Math.min(doc.numPages, maxPag || doc.numPages);
    for (let p = 1; p <= n; p++) {
      const c = await (await doc.getPage(p)).getTextContent();
      const filas = {};
      c.items.forEach(it => {
        const t = (it.str || '').trim(); if (!t) return;
        const k = Math.round(it.transform[5] / 3);
        (filas[k] = filas[k] || []).push({ x: it.transform[4], w: it.width || 0, t: it.str });
      });
      // Una palabra puede venir partida en dos trozos («202» «6-2»): se pegan
      // sin espacio cuando un trozo empieza justo donde termina el anterior.
      Object.keys(filas).map(Number).sort((a, b) => b - a).forEach(k => {
        const f = filas[k].sort((a, b) => a.x - b.x);
        let l = '';
        f.forEach((o, i) => { const pegado = i && o.x - (f[i - 1].x + f[i - 1].w) < 1 && !/\s$/.test(f[i - 1].t) && !/^\s/.test(o.t);
          l += (i && !pegado ? ' ' : '') + o.t; });
        lineas.push(l.replace(/\s+/g, ' ').trim());
      });
      lineas.push('\f');
    }
    const total = doc.numPages;
    doc.destroy && doc.destroy();
    return { lineas, paginas: total };
  }

  /* ------------------------------------------------- lectura del sílabo */
  const ES_PIE = /universidad ricardo palma|^rectorado$|oficina de desarrollo academico/;
  function leerSilabo(lineas) {
    const texto = lineas.join('\n');
    const m = rx => { const r = texto.match(rx); return r ? r[1].trim() : ''; };
    const s = {
      asignatura: m(/Asignatura\s*:?\s*([^\n]+)/i),
      codigo: m(/C[óo]digo\s*:?\s*([A-Z]{2,6}\s?\d{1,5}[A-Z]?)/i).replace(/\s/g, ''),
      horasTeoria: parseInt(m(/Horas de Teor[íi]a\s*:?\s*(\d+)/i), 10) || 0,
      horasPractica: parseInt(m(/Horas de Pr[áa]ctica\s*:?\s*(\d+)/i), 10) || 0,
      docente: taparCorreos(m(/Docentes?\s*:?\s*([^\n]+)/i)).replace(/\[correo\]/g, '').trim(),
      semestre: '', semanas: []
    };
    const sm = texto.match(/Semestre\s+Acad[ée]mico\s*:?\s*(\d{4})\s*[-–]?\s*(II|I|2|1)\b/i) ||
               texto.match(/S[ÍI]LABO\s+(\d{4})\s*[-–]\s*(II|I|2|1)\b/i);
    if (sm) s.semestre = sm[1] + '-' + (/^(2|ii)$/i.test(sm[2]) ? '2' : '1');
    // Cronograma: después de «Semana … Contenido», cada línea que empieza con
    // un número es una semana; las líneas siguientes completan su contenido.
    let dentro = false, actual = null, unidad = '';
    for (const l0 of lineas) {
      const l = l0.trim(), n = norm(l);
      if (!l || l === '\f' || ES_PIE.test(n)) continue;
      if (/^semana\b.*contenido/.test(n)) { dentro = true; actual = null; continue; }
      const u = l.match(/^UNIDAD\s+([IVX]+|\d+)\s*:?\s*(.*)$/i);
      if (u) { unidad = (u[1] + (u[2] ? ': ' + u[2] : '')).trim(); actual = null; continue; }
      if (/^logro\b/.test(n)) { actual = null; continue; }
      if (dentro && /^(vii|viii|ix|x)\.?\s+[a-z]/.test(n) && s.semanas.length) break;
      if (!dentro) continue;
      const w = l.match(/^(\d{1,2})\s+(.*[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}.*)$/);
      if (w && +w[1] >= 1 && +w[1] <= 20 && !s.semanas.some(x => x.n === +w[1])) {
        actual = { n: +w[1], contenido: w[2].trim(), unidad };
        s.semanas.push(actual);
      } else if (actual && !/^\d{1,3}$/.test(l)) actual.contenido += ' ' + l;
    }
    s.semanas.forEach(x => {
      x.contenido = x.contenido.replace(/\s+/g, ' ').trim();
      x.titulo = x.contenido.split(/\.\s/)[0].replace(/\.$/, '');
      x.temas = temasDeSemana(x.contenido);
      x.sinMaterial = REGLAS.semanasSinMaterial.test(x.contenido);
    });
    s.semanas.sort((a, b) => a.n - b.n);
    return s;
  }

  /* ------------------------------------------------------ los hechos */
  async function leer(file, progreso) {
    const avance = (f, t) => progreso && progreso(f, t);
    avance(0, 'Abriendo la copia del aula…');
    const ex = await extraer(file, f => avance(f * 0.7, 'Leyendo la copia del aula… ' + Math.round(f * 100) + '%'));
    const raizB = parsearXml(ex.xml['moodle_backup.xml']);
    if (!raizB) throw new Error('La copia no trae moodle_backup.xml: no parece una copia de seguridad de un aula de Moodle.');
    const inf = hijo(raizB, 'information');
    const g = k => val(hijo(inf, k));
    const ajustes = {};
    hijos(ruta(inf, 'settings'), 'setting').forEach(s => { if (val(hijo(s, 'level')) === 'root') ajustes[val(hijo(s, 'name'))] = val(hijo(s, 'value')); });
    const corto = g('original_course_shortname'), mc = corto.match(/(\d{4})(\d)-(\d+)-G(\d+)-(\d+)/i);
    const H = {
      versionReglas: VERSION_REGLAS,
      archivo: { nombre: file.name, tamano: file.size },
      aula: {
        nombre: g('original_course_fullname'), corto, idMoodle: g('original_course_id'),
        inicio: num(hijo(inf, 'original_course_startdate')), fin: num(hijo(inf, 'original_course_enddate')),
        copia: num(hijo(inf, 'backup_date')), moodle: g('moodle_release').split(' ')[0], formato: g('original_course_format'),
        periodo: mc ? mc[1] + '-' + mc[2] : '', codigoMoodle: mc ? mc[3] : '', grupo: mc ? String(+mc[4]) : '',
        subgrupo: mc ? mc[5] : '', tipo: mc ? (mc[5] === '0' ? 'teoría' : 'taller o práctica') : ''
      },
      conUsuarios: ex.usuarios || ajustes.users === '1',
      secciones: [], acts: [], pdfLeidos: [], avisos: ex.avisos
    };
    if (H.conUsuarios) return H;   // se detiene: no se lee nada más

    const aula = H.aula, ini = diaLima(aula.inicio);
    H.inicioDia = ini;
    H.semanaActual = Math.floor((diaLima(aula.copia) - ini) / 7) + 1;

    hijos(ruta(inf, 'contents', 'sections'), 'section').forEach(s => {
      const dir = val(hijo(s, 'directory')), x = parsearXml(ex.xml[dir + '/section.xml']);
      H.secciones.push({ id: val(hijo(s, 'sectionid')), num: x ? num(hijo(x, 'number')) : H.secciones.length,
        nombre: x ? val(hijo(x, 'name')) : '', resumen: x ? htmlATexto(val(hijo(x, 'summary'))) : '',
        visible: x ? val(hijo(x, 'visible')) !== '0' : true });
    });
    const numSeccion = {}; H.secciones.forEach(s => numSeccion[s.id] = s.num);

    // Archivos por contexto de la actividad (files.xml).
    const porContexto = {};
    const fx = parsearXml(ex.xml['files.xml']);
    hijos(fx, 'file').forEach(f => {
      const nom = val(hijo(f, 'filename'));
      const area = val(hijo(f, 'filearea'));
      if (nom === '.' || (area !== 'content' && area !== 'introattachment')) return;
      const c = val(hijo(f, 'contextid'));
      (porContexto[c] = porContexto[c] || []).push({ nombre: nom, hash: val(hijo(f, 'contenthash')),
        tamano: num(hijo(f, 'filesize')), tipo: val(hijo(f, 'mimetype')), modificado: num(hijo(f, 'timemodified')),
        componente: val(hijo(f, 'component')), area });
    });

    hijos(ruta(inf, 'contents', 'activities'), 'activity').forEach(a => {
      const dir = val(hijo(a, 'directory')), mod = val(hijo(a, 'modulename'));
      const m = parsearXml(ex.xml[dir + '/module.xml']), x = parsearXml(ex.xml[dir + '/' + mod + '.xml']);
      const nodo = hijo(x, mod);
      const act = { id: val(hijo(a, 'moduleid')), mod, titulo: val(hijo(a, 'title')).trim(),
        seccion: m ? num(hijo(m, 'sectionnumber')) : (numSeccion[val(hijo(a, 'sectionid'))] || 0),
        agregado: m ? num(hijo(m, 'added')) : 0, visible: m ? val(hijo(m, 'visible')) !== '0' : true, archivos: [] };
      const ctx = x ? x.getAttribute('contextid') : '';
      if (mod === 'resource' || mod === 'folder') act.archivos = (porContexto[ctx] || []).filter(f => f.componente === 'mod_' + mod && f.area === 'content');
      if (mod === 'assign') act.adjuntos = (porContexto[ctx] || []).filter(f => f.componente === 'mod_assign');
      if (mod === 'assign' && nodo) {
        act.abre = num(hijo(nodo, 'allowsubmissionsfromdate')); act.vence = num(hijo(nodo, 'duedate'));
        const gr = parsearXml(ex.xml[dir + '/grading.xml']);
        act.rubricaMoodle = !!gr && Array.prototype.some.call(gr.getElementsByTagName('definition'), () => true);
        if (gr) {
          const area = Array.prototype.find.call(gr.getElementsByTagName('area'), x => val(hijo(x, 'areaname')) === 'submissions');
          const def = area && hijos(hijo(area, 'definitions'), 'definition')[0];
          act.metodo = area ? val(hijo(area, 'activemethod')) : '';
          if (def) act.rubricaDef = { metodo: val(hijo(def, 'method')), nombre: val(hijo(def, 'name')), creada: num(hijo(def, 'timecreated')) };
        }
        act.texto = htmlATexto(val(hijo(nodo, 'intro'))).slice(0, 600);
      }
      if (mod === 'quiz' && nodo) { act.abre = num(hijo(nodo, 'timeopen')); act.vence = num(hijo(nodo, 'timeclose')); }
      if (mod === 'forum' && nodo) act.tipoForo = val(hijo(nodo, 'type'));
      if (mod === 'url' && nodo) {
        // NUNCA se guarda la URL completa: puede traer la clave de una reunión.
        const u = val(hijo(nodo, 'externalurl')).trim(), d = u.match(/^[a-z]+:\/\/([^\/?#:]+)/i);
        act.dominio = d ? d[1].toLowerCase() : '';
      }
      if (mod === 'label' && nodo) act.texto = htmlATexto(val(hijo(nodo, 'intro'))).slice(0, 600);
      if ((mod === 'page' || mod === 'book') && nodo) act.texto = htmlATexto(val(hijo(nodo, 'intro'))).slice(0, 300);
      H.acts.push(act);
    });

    // PDF: primeras páginas de cada uno (y el sílabo completo).
    const pdfs = [];
    H.acts.forEach(a => a.archivos.forEach(f => { if (ex.pdf[f.hash] && !pdfs.some(p => p.hash === f.hash)) pdfs.push({ hash: f.hash, nombre: f.nombre, act: a }); }));
    const textos = {};
    for (let i = 0; i < pdfs.length; i++) {
      const p = pdfs[i];
      avance(0.7 + 0.3 * i / pdfs.length, 'Leyendo los PDF (' + (i + 1) + ' de ' + pdfs.length + ')…');
      try {
        const posibleSilabo = /s[ií]labo/i.test(p.nombre + ' ' + p.act.titulo);
        const r = await lineasPdf(ex.pdf[p.hash], posibleSilabo ? 15 : 2);
        textos[p.hash] = r;
        if (!posibleSilabo && /s[íi]labo\s+20\d\d/i.test(r.lineas.slice(0, 25).join(' '))) textos[p.hash] = await lineasPdf(ex.pdf[p.hash], 15);
        H.pdfLeidos.push(p.nombre);
      } catch (e) { H.avisos.push('No se pudo leer el texto de «' + p.nombre + '».'); }
    }
    H.acts.forEach(a => a.archivos.forEach(f => {
      if (textos[f.hash] || !ex.office[f.hash]) return;
      try { textos[f.hash] = lineasOffice(ex.office[f.hash], f.nombre); H.pdfLeidos.push(f.nombre); }
      catch (e) { /* un Word o PowerPoint sin texto legible: se revisa a mano */ }
    }));
    H.acts.forEach(a => a.archivos.forEach(f => {
      const t = textos[f.hash];
      if (!t) return;
      f.paginas = t.paginas;
      f.inicioTexto = taparCorreos(t.lineas.filter(l => l !== '\f').slice(0, 60).join('\n'));
      const fin1 = t.lineas.indexOf('\f');
      f.pagina1 = taparCorreos((fin1 >= 0 ? t.lineas.slice(0, fin1) : t.lineas.slice(0, 30)).join('\n'));
      f.tituloDeclarado = tituloDeClase(f.pagina1);
      const s = f.inicioTexto.match(/sesi[oó]n\s*(?:de aprendizaje\s*)?(?:n[°º.o]*\s*)?(\d{1,2})\b/i);
      f.sesionEnPdf = s ? +s[1] : null;
      if (/s[ií]labo/i.test(f.nombre + ' ' + a.titulo) || /s[íi]labo\s+20\d\d/i.test(f.inicioTexto)) f.silabo = leerSilabo(t.lineas);
    }));
    avance(1, 'Listo');
    return H;
  }

  /* ---------------------------------------------- clasificación simple */
  const DOMINIOS = [
    [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'YouTube'], [/zoom\.us$/, 'Zoom'], [/meet\.google\.com$/, 'Google Meet'],
    [/teams\.(microsoft|live)\.com$/, 'Microsoft Teams'], [/whatsapp\.com$|wa\.me$/, 'WhatsApp'], [/t\.me$|telegram/, 'Telegram'],
    [/drive\.google\.com$|docs\.google\.com$/, 'Google Drive'], [/onedrive|sharepoint\.com$/, 'OneDrive'],
    [/scielo|sciencedirect|springer|ieee|scopus|redalyc|dialnet|researchgate/, 'artículo o revista']
  ];
  const nombreDominio = d => { for (const [rx, n] of DOMINIOS) if (rx.test(d || '')) return n; return (d || '').replace(/^www\./, '') || 'enlace'; };
  const esReunion = d => /zoom\.us$|meet\.google\.com$|teams\.(microsoft|live)\.com$|webex\.com$/.test(d || '');
  const esChat = d => /whatsapp\.com$|wa\.me$|t\.me$|telegram|discord/.test(d || '');
  function claseDeRecurso(a) {
    const t = norm(a.titulo + ' ' + a.archivos.map(f => f.nombre).join(' '));
    const ini = norm((a.archivos[0] || {}).inicioTexto || '').slice(0, 400);
    if (/silabo/.test(t) || a.archivos.some(f => f.silabo)) return 'silabo';
    if (/sensibiliz/.test(t) || /mensaje de sensibilizacion/.test(ini)) return 'sensibilizacion';
    if (/politica de calidad|reglamento|directiva|calendario academico/.test(t)) return 'institucional';
    if (/rubrica/.test(t)) return 'rubrica';
    if (/sesion de aprendizaje|plan de sesion/.test(t)) return 'sesion';
    if (/evaluacion|examen|practica calificada|\bpc ?\d|enunciado/.test(t)) return 'evaluacion';
    if (/^s\d+[_ -]|clase|sesion|semana|tema|unidad/.test(t) || a.seccion > 0) return 'clase';
    return 'lectura';
  }

  // El título que la propia presentación declara: lo que sigue a «Sesión N»
  // hasta «Docente:». Si no lo hay, las primeras líneas.
  const CABECERA = /^(universidad|facultad|escuela|departamento|curso\b|asignatura|docente|profesor|mg\.|msc|ing\.|dr\.|dra\.|e-?mail|correo|ciclo|semestre|periodo|per[ií]odo|grupo|secci[oó]n|lima|santiago de surco|20\d\d\b|\[correo\]|unidad\s+[ivx\d]+\s*$|semana\s+\d+\s*$|sesi[oó]n\s*(de aprendizaje\s*)?(n[°º.o]*\s*)?\d{0,2}\s*$|clase\s*\d+\s*$|\d+\s*$)/i;
  function tituloDeClase(t) {
    const l = String(t || '').split('\n').map(x => x.trim()).filter(Boolean);
    const i = l.findIndex(x => /^\s*sesi[oó]n\b/i.test(x));
    const desde = i >= 0 ? i + 1 : 0;
    const out = [];
    for (let k = desde; k < l.length && out.length < 3; k++) {
      if (/^(docente|profesor|mg\.|ing\.|dr\.)/i.test(l[k])) { if (out.length) break; else continue; }
      if (CABECERA.test(l[k]) || l[k].length < 3) { if (out.length) break; else continue; }
      out.push(l[k]);
    }
    return out.join(' ').replace(/\s+/g, ' ').trim();
  }
  // Los temas de una semana del sílabo: los títulos en MAYÚSCULAS («DISEÑO DEL PRODUCTO.»).
  function temasDeSemana(contenido) {
    const t = [];
    String(contenido || '').split(/\.\s+|\.$/).forEach(seg => {
      const letras = seg.replace(/[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]/g, '');
      const may = seg.replace(/[^A-ZÁÉÍÓÚÑÜ]/g, '').length;
      if (letras.length >= 4 && may / letras.length >= 0.75) t.push(seg.trim());
    });
    return t.length ? t : [String(contenido || '').split(/\.\s/)[0]];
  }
  // ¿El título de la presentación es el del sílabo? Se exige el texto del tema,
  // sin importar mayúsculas, tildes ni signos (Auditoría interna 2025, NC 8.5.2).
  const limpio = s => ' ' + norm(s).replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const VACIAS = new Set('de del la las el los y e en a al por para con su sus un una o u que se lo'.split(' '));
  function compararTitulo(titulo, temas) {
    const T = limpio(titulo);
    if (T.trim().length < 3) return { estado: 'sin-titulo' };
    for (const tm of temas) if (T.indexOf(limpio(tm)) >= 0) return { estado: 'igual', tema: tm };
    let mejor = null, pm = 0;
    temas.forEach(tm => {
      const a = limpio(tm).trim().split(' ').filter(w => !VACIAS.has(w)), b = new Set(T.trim().split(' ').filter(w => !VACIAS.has(w)));
      const v = a.length ? a.filter(w => b.has(w)).length / a.length : 0;
      if (v > pm) { pm = v; mejor = tm; }
    });
    if (mejor && limpio(mejor).indexOf(T) >= 0 && T.trim().split(' ').length >= 2) return { estado: 'incompleto', tema: mejor };
    return { estado: pm >= 0.5 ? 'parecido' : 'distinto', tema: mejor || temas[0], parecido: pm };
  }

  /* ---------------------------------------------- 04 · rúbricas */
  // Por cada tarea del aula: ¿tiene rúbrica o instrumento?, ¿se publicó al
  // menos 2 días antes de que se abra la entrega? (Guía Operativa Docente 4.4).
  // La rúbrica aplicada y la retroalimentación a cada estudiante no vienen en
  // una copia sin usuarios: se revisan a mano (Auditoría 2025, NC 8.5.1.5).
  const RX_RUB = /r[uú]brica|instrumento de evaluaci|lista de cotejo|escala de valoraci|gu[ií]a de evaluaci/i;
  function regla04(H, recursos, cuadro, silabo, diaCopia) {
    const r = { punto: '04', mejorar: [], nota: [], evidencia: [], automatico: true };
    const tareas = H.acts.filter(a => a.mod === 'assign' && a.visible && !/^taller\s*n?[°º.]?\s*\d*\s*$/i.test(a.titulo));
    const cuest = H.acts.filter(a => a.mod === 'quiz' && a.visible);
    const rubRec = recursos.filter(a => a.visible && (a.clase === 'rubrica' || RX_RUB.test(a.titulo + ' ' + a.archivos.map(f => f.nombre).join(' '))));
    const palabras = t => norm(t).split(/[^a-z0-9]+/).filter(w => w.length > 3 && !/^(entrega|trabajo|tarea|rubrica|semana|para|evaluacion)$/.test(w));
    tareas.forEach(a => {
      const abre = a.abre || a.agregado, fuentes = [];
      if (a.rubricaDef && /rubric|guide/.test(a.metodo || a.rubricaDef.metodo))
        fuentes.push({ que: 'rúbrica configurada en la tarea', dia: diaLima(a.rubricaDef.creada || a.agregado) });
      (a.adjuntos || []).filter(f => RX_RUB.test(f.nombre)).forEach(f => fuentes.push({ que: 'archivo «' + f.nombre + '» adjunto a la tarea', dia: diaLima(a.agregado) }));
      const pt = palabras(a.titulo);
      rubRec.filter(x => x.seccion === a.seccion || (pt.length && palabras(x.titulo + ' ' + x.archivos.map(f => f.nombre).join(' ')).some(w => pt.includes(w))))
        .forEach(x => fuentes.push({ que: 'archivo «' + x.titulo + '» (' + (x.seccion ? 'semana ' + x.seccion : 'sección general') + ')', dia: diaLima(x.agregado) }));
      const mencion = !fuentes.length && RX_RUB.test(a.texto || '');
      const mejor = fuentes.sort((p, q) => p.dia - q.dia)[0];
      a.rub = { fuentes, mencion, abre, antic: mejor ? diaLima(abre) - mejor.dia : null };
      a.rub.ok = !!mejor && a.rub.antic >= 2;
      r.evidencia.push('«' + a.titulo + '» (' + (a.seccion ? 'semana ' + a.seccion : 'sección general') + '): abre el ' + fecha(abre) + ', cierra ' + (a.vence ? fecha(a.vence) : 'sin fecha') + '. ' +
        (mejor ? 'Rúbrica: ' + mejor.que + ', publicada ' + (a.rub.antic > 0 ? a.rub.antic + (a.rub.antic === 1 ? ' día' : ' días') + ' antes de abrir' : a.rub.antic === 0 ? 'el mismo día que abre' : 'después de abrir') + (a.rub.ok ? ' ✔' : ' (debe ser al menos 2 días antes)') + '.'
          : mencion ? 'La descripción menciona una rúbrica, pero no está adjunta ni configurada.' : 'Sin rúbrica ni instrumento de evaluación.'));
      if (!a.vence) r.nota.push('«' + a.titulo + '» no tiene fecha de cierre.');
    });
    if (cuest.length) r.nota.push('Cuestionarios (' + y(cuest.map(a => '«' + a.titulo + '»')) + '): el instrumento es el propio cuestionario; revise a mano si corresponde una rúbrica.');
    // Evaluaciones del sílabo ya tomadas que no aparecen en el aula.
    const evalSil = ((silabo && silabo.semanas) || []).filter(x => /pr[aá]ctica calificada|examen|sustentaci|taller\s*n?[°º]?\s*\d|trabajo final|evaluaci[oó]n/i.test(x.contenido) && cuadro.some(f => f.n === x.n && f.inicio + 6 < diaCopia));
    const sinTarea = evalSil.filter(x => !tareas.some(a => a.seccion === x.n));
    if (sinTarea.length) r.nota.push('El sílabo programa evaluaciones ya tomadas sin tarea en el aula: ' + sinTarea.map(x => 'semana ' + x.n + ' («' + x.titulo.toLowerCase() + '»)').join('; ') +
      '. Si fueron presenciales, verifique su rúbrica o instrumento en el portafolio.');
    r.nota.push('La rúbrica aplicada y la retroalimentación a cada estudiante no vienen en la copia (se descarga sin datos de estudiantes): verifíquelas en el aula o en el portafolio. ' +
      'En la auditoría interna 2025 (NC 8.5.1.5) se observó que no había constancia de los motivos de la calificación.');
    cuadro.forEach(f => { f.evalDet = H.acts.filter(a => (a.mod === 'assign' || a.mod === 'quiz') && a.seccion === f.n)
      .map(a => ({ titulo: a.titulo, rub: a.rub ? (a.rub.ok ? 'ok' : (a.rub.fuentes.length ? 'tarde' : 'sin')) : '' })); });
    if (!tareas.length) {
      r.sugerido = ''; r.certeza = 'baja'; r.automatico = false; r.para_docente = '';
      r.evidencia.push('No hay tareas en el aula para revisar sus rúbricas.');
      return r;
    }
    const ok = tareas.filter(a => a.rub.ok), con = tareas.filter(a => a.rub.fuentes.length);
    r.sugerido = ok.length === tareas.length ? 'Cumple' : (con.length ? 'Parcial' : 'No cumple');
    r.certeza = tareas.some(a => a.rub.mencion) ? 'media' : 'alta';
    const sin = tareas.filter(a => !a.rub.fuentes.length), tarde = tareas.filter(a => a.rub.fuentes.length && !a.rub.ok);
    if (sin.length) r.mejorar.push('Publicar la rúbrica o el instrumento de evaluación de ' + y(sin.map(a => '«' + a.titulo + '»')) + ' (adjunta en la misma tarea o configurada como rúbrica en ella).');
    if (tarde.length) r.mejorar.push('Publicar las rúbricas al menos 2 días antes de que se abra la entrega (' + y(tarde.map(a => '«' + a.titulo + '»')) + ').');
    if (r.sugerido !== 'Cumple') r.mejorar.push('En las próximas evaluaciones: rúbrica publicada 2 días antes; después de calificar, la rúbrica aplicada y la retroalimentación a más tardar 2 semanas después.');
    r.para_docente = r.sugerido === 'Cumple'
      ? 'Gracias: cada tarea del aula tiene su rúbrica publicada con anticipación. Recuerde dejar también la rúbrica aplicada y la retroalimentación después de calificar.'
      : 'Para el punto de rúbricas le pedimos:\n' + r.mejorar.map((t, i) => (i + 1) + '. ' + t).join('\n');
    return r;
  }

  /* ------------------------------- 08 · enlaces y grabaciones de clase */
  // Con el horario de la guía de matrícula se sabe cuántas clases virtuales
  // tiene el grupo y, por tanto, cuántas grabaciones debería haber.
  const DIAS = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
  const esVirtual = h => /virtual|remot|en l[ií]nea|online/i.test((h.aula || '') + ' ' + (h.modalidad || ''));
  const esGrabacion = a => a.visible && (/grabaci|grabad|recording|clase grabada|video de (la )?clase/i.test(a.titulo || '') ||
    (a.archivos || []).some(f => /^video\//.test(f.tipo || '')));
  function regla08(H, ctx, cuadro, inicioSemana, diaCopia) {
    const reun = H.acts.filter(a => a.mod === 'url' && a.visible && esReunion(a.dominio));
    const grab = H.acts.filter(esGrabacion);
    cuadro.forEach(f => { f.grabaciones = grab.filter(a => a.seccion === f.n).map(a => a.titulo); });
    const r = { punto: '08', mejorar: [], nota: [], evidencia: [] };
    const lista = (l, f) => l.length ? y(l.map(f)) : '';
    r.evidencia.push(reun.length ? plural(reun.length, 'enlace de reunión', 'enlaces de reunión') + ': ' + lista(reun, a => nombreDominio(a.dominio) + ' «' + a.titulo + '» (' + fecha(a.agregado) + ')') + '.' : 'No hay enlaces de reunión.');
    r.evidencia.push(grab.length ? plural(grab.length, 'grabación', 'grabaciones') + ': ' + lista(grab, a => '«' + a.titulo + '» (' + (a.seccion ? 'semana ' + a.seccion : 'sección general') + ')') + '.' : 'No se encontraron grabaciones (enlaces o videos con «grabación» en el nombre).');
    const horario = Array.isArray(ctx.horario) ? ctx.horario : null;
    if (!horario) {
      r.sugerido = ''; r.certeza = 'pendiente'; r.automatico = false; r.para_docente = '';
      r.nota.push('El portal todavía no tiene el horario de este grupo (lo carga la administración desde la guía de matrícula). Por ahora revise este punto a mano: si el curso es presencial, corresponde «No aplica».');
      return r;
    }
    r.automatico = true;
    const virt = horario.filter(esVirtual);
    const txtH = h => [h.tipo, h.dia, h.horario || [h.inicio, h.fin].filter(Boolean).join('–'), esVirtual(h) ? '(virtual)' : '(presencial, ' + (h.aula || '').replace(/\s*-\s*$/, '') + ')'].filter(Boolean).join(' ');
    if (!virt.length) {
      r.sugerido = 'No aplica'; r.certeza = 'alta'; r.para_docente = '';
      r.evidencia.unshift('Según la guía de matrícula, todas las clases de este grupo son presenciales (' + y(horario.map(txtH)) + ').');
      return r;
    }
    // Clases virtuales ya dictadas a la fecha de la copia (sin semanas de examen).
    const ini = H.inicioDia, dSemIni = new Date(ini * DIA * 1000).getUTCDay();
    let dictadas = 0;
    cuadro.forEach(f => {
      f.virtuales = 0;
      if (f.sinMaterial) return;
      virt.forEach(h => {
        const d = DIAS[norm(h.dia).slice(0, 9).replace(/[^a-z]/g, '')];
        if (d == null) return;
        const dia = inicioSemana(f.n) + ((d - dSemIni + 7) % 7);
        if (dia < diaCopia) { f.virtuales++; dictadas++; }
      });
    });
    r.evidencia.unshift('Según la guía de matrícula, este grupo tiene ' + plural(virt.length, 'clase virtual', 'clases virtuales') + ' por semana (' + y(virt.map(txtH)) +
      '). Hasta la fecha de la copia se dictaron ' + plural(dictadas, 'clase virtual', 'clases virtuales') + '; se encontraron ' + plural(grab.length, 'grabación', 'grabaciones') + '.');
    const faltan = cuadro.filter(f => f.virtuales > f.grabaciones.length).map(f => f.n);
    if (!grab.length) {
      r.sugerido = 'No existen'; r.certeza = 'alta';
      r.mejorar.push('Publicar la grabación de cada clase virtual en la semana que corresponde (van ' + dictadas + ' clases virtuales sin grabación).');
      r.para_docente = 'Le pedimos publicar en el aula virtual la grabación de cada clase virtual, en la semana que corresponde, con la fecha de la clase en el nombre (por ejemplo: «Grabación clase 24/08»). A la fecha van ' + plural(dictadas, 'clase virtual', 'clases virtuales') + '.';
    } else {
      r.sugerido = 'Existen'; r.certeza = 'media';
      if (grab.length < dictadas) {
        r.evidencia.push('Cobertura incompleta: ' + grab.length + ' de ' + dictadas + '. Semanas sin grabación: ' + y(faltan.map(String)) + '.');
        r.mejorar.push('Completar las grabaciones de las semanas ' + y(faltan.map(String)) + '.');
        r.nota.push('El formulario no tiene la opción «Parcial»: se sugiere «Existen», pero la cobertura está incompleta (' + grab.length + ' de ' + dictadas + ').');
        r.para_docente = 'Gracias por publicar grabaciones de clase. Faltan las de las semanas ' + y(faltan.map(String)) + '; le pedimos subirlas en la semana que corresponde, con la fecha de la clase en el nombre.';
      } else r.para_docente = 'Gracias por publicar la grabación de cada clase virtual.';
    }
    r.nota.push('Las grabaciones se reconocen por el nombre («grabación», «clase grabada») o porque son videos subidos al aula. Si el docente las nombra de otra forma, confírmelo a mano.');
    return r;
  }

  /* ---------------------------------- horario de la guía de matrícula */
  // Se pegan las filas copiadas de webapp.urp.edu.pe/guia-matricula/horario
  // (Semestre · Curso · Grp · SGrp · Tipo · Aula · Día · Horas · Horario · Docente).
  // Sirve pegar la tabla entera del semestre: se toman solo las del grupo.
  const RX_FILA = /^\s*(\d{1,2})\s+([A-Z]{2,5}-?\s?\d{2,5})\s*-\s*(.+?)\s+(\d{1,2})\s+(\d)\s+(Teo|Tal|Pr[aá]|Lab)\s+(.+?)\s+(Lunes|Martes|Mi[ée]rcoles|Jueves|Viernes|S[áa]bado|Domingo)\s+(\d+)\s+(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})\s*(.*)$/i;
  function leerHorario(texto) {
    const filas = [];
    String(texto || '').split(/\r?\n/).forEach(l => {
      const m = l.replace(/ /g, ' ').match(RX_FILA);
      if (m) filas.push({ semestre: m[1], codigo: m[2].replace(/[\s-]/g, '').toUpperCase(), curso: m[3].trim(), grupo: String(+m[4]), subgrupo: m[5],
        tipo: m[6], aula: m[7].trim(), dia: m[8], horas: +m[9], horario: m[10].replace(/\s+/g, ' '), docente: m[11].trim() });
    });
    return filas;
  }
  // Las filas del aula analizada: mismo curso, grupo y subgrupo (0 teoría, 1 taller).
  function horarioDelAula(filas, H, codigo) {
    const A = H.aula, cod = String(codigo || '').replace(/[\s-]/g, '').toUpperCase();
    const pal = s => norm(s).split(/[^a-z0-9]+/).filter(w => w.length > 3);
    const nom = pal(A.nombre.replace(/^\S+\s+/, ''));
    const delCurso = filas.filter(f => cod ? f.codigo === cod : (() => { const p = pal(f.curso); return p.length && p.every(w => nom.includes(w)) && nom.every(w => p.includes(w)); })());
    return delCurso.filter(f => (!A.grupo || f.grupo === A.grupo) && (A.subgrupo === '' || f.subgrupo === A.subgrupo));
  }
  // Filas leídas de la guía con el cargador del administrador: «IN-1001 - Curso».
  function normalizarHorario(d) {
    const filas = Array.isArray(d) ? d : (d && d.filas) || [];
    return filas.map(f => {
      if (f.codigo && f.curso && !/ - /.test(f.curso)) return f;
      const m = String(f.curso || '').match(/^\s*([A-Z]{2,5}-?\s?\d{2,5})\s*-\s*(.+)$/);
      return Object.assign({}, f, { codigo: (m ? m[1] : f.codigo || '').replace(/[\s-]/g, '').toUpperCase(), curso: m ? m[2].trim() : f.curso,
        grupo: String(+f.grupo || f.grupo), subgrupo: String(f.subgrupo) });
    });
  }
  async function cargarHorarioPublicado(periodo) {
    // Si el portal publica la guía como archivo (docs/horario-AAAA-S.json), se usa sola.
    try {
      const r = await fetch('docs/horario-' + periodo + '.json', { cache: 'no-cache' });
      if (r.ok) return normalizarHorario(await r.json());
    } catch (e) { /* todavía no se ha cargado */ }
    return null;
  }

  /* ---------------------------------------------- cruce con la asignación */
  function cruzar(H, asig) {
    asig = asig || {};
    const pal = s => norm(String(s || '').replace(/\(.*?\)/g, '')).split(/[^a-z0-9]+/).filter(w => w.length > 3);
    const delAula = pal(H.aula.nombre.replace(/^\S+\s+/, '')), delPortal = pal(asig.asignatura);
    const comunes = delPortal.filter(w => delAula.includes(w));
    const parecido = delPortal.length ? comunes.length / delPortal.length : 0;
    const grupoOk = !asig.grupo || !H.aula.grupo || String(+String(asig.grupo).replace(/\D/g, '') || asig.grupo) === H.aula.grupo;
    const tipoAula = H.aula.subgrupo === '0' ? 'teo' : 'tal';
    const tipoPortal = /teo/i.test(asig.tipo || '') ? 'teo' : (asig.tipo ? 'tal' : '');
    const tipoOk = !tipoPortal || !H.aula.subgrupo || tipoPortal === tipoAula;
    const motivos = [];
    if (!asig.asignatura) motivos.push('no hay un curso elegido en el portal para comparar');
    else if (parecido < 0.6) motivos.push('el nombre del curso no coincide del todo');
    if (!grupoOk) motivos.push('el grupo no coincide (portal: ' + asig.grupo + ', copia: ' + H.aula.grupo + ')');
    if (!tipoOk) motivos.push('el portal tiene ' + (tipoPortal === 'teo' ? 'teoría' : 'taller o práctica') + ' y la copia es de ' + H.aula.tipo);
    return { claro: !motivos.length, motivos, parecido };
  }

  /* --------------------------------------------------- reglas por punto */
  const PUNTOS = [
    ['01', 'Sílabo'], ['02', 'Mensaje de sensibilización'], ['03', 'Sesión de aprendizaje'], ['04', 'Rúbrica'],
    ['05', 'Materiales'], ['06', 'Actividades y tareas'], ['07', 'Materiales adicionales'], ['08', 'Links y grabaciones de sesiones']
  ];
  const AUTOMATICOS = ['01', '02', '04', '05', '07'];

  function evaluar(H, ctx) {
    ctx = ctx || {};
    const A = H.aula, ini = H.inicioDia, diaCopia = diaLima(A.copia);
    const inicioSemana = n => ini + 7 * (n - 1);
    const recursos = H.acts.filter(a => a.mod === 'resource' || a.mod === 'folder' || a.mod === 'page' || a.mod === 'book');
    recursos.forEach(a => a.clase = claseDeRecurso(a));
    const visibles = recursos.filter(a => a.visible);
    const enSemana = a => a.seccion === 0 ? 'la sección general' : 'la semana ' + a.seccion;
    const R = {};

    /* 01 · Sílabo ----------------------------------------------------- */
    (function () {
      const todos = recursos.filter(a => a.clase === 'silabo'), vis = todos.filter(a => a.visible);
      const r = R['01'] = { punto: '01', evidencia: [], mejorar: [], nota: [] };
      if (!vis.length) {
        r.sugerido = 'No subió'; r.certeza = 'alta';
        r.evidencia.push(todos.length ? 'El sílabo está en el aula pero oculto: los estudiantes no lo ven.' : 'No se encontró ningún archivo con el sílabo (ni por el nombre ni por su primera página).');
        r.mejorar.push('Publicar el sílabo ' + A.periodo + ' en la sección general del aula, visible para los estudiantes.');
        r.para_docente = 'Le pedimos publicar el sílabo del semestre ' + A.periodo + ' en la sección general del aula virtual (la de arriba, antes de la semana 1), visible para los estudiantes. Así lo tienen a mano desde el primer día de clases.';
        return;
      }
      const a = vis[0], f = a.archivos.find(x => x.silabo) || a.archivos[0] || {}, s = f.silabo || null;
      const dif = ini - diaLima(a.agregado);
      r.evidencia.push('«' + (f.nombre || a.titulo) + '» en ' + enSemana(a) + ', publicado el ' + fecha(a.agregado) +
        (dif >= 0 ? ' (antes del inicio de clases).' : ' (' + plural(-dif, 'día', 'días') + ' después del inicio de clases, el ' + fechaDeDia(ini) + ').'));
      if (f.modificado && diaLima(f.modificado) > diaLima(a.agregado) + 1) r.nota.push('El archivo se reemplazó después de publicarse (' + fecha(f.modificado) + ').');
      if (vis.length > 1) r.nota.push('Hay ' + vis.length + ' archivos que parecen sílabo; se tomó el primero. Verifique que no haya dos versiones.');
      r.sugerido = 'Subió'; r.certeza = s ? 'alta' : 'media';
      if (!s) {
        r.nota.push('No se pudo leer el texto del sílabo (¿es Word o un PDF escaneado?). Confirme a mano que es el del semestre ' + A.periodo + '.');
      } else {
        r.datos = { asignatura: s.asignatura, codigo: s.codigo, semestre: s.semestre, docente: s.docente, semanas: s.semanas.length, horasTeoria: s.horasTeoria, horasPractica: s.horasPractica };
        r.evidencia.push('Dice: ' + [s.asignatura && 'asignatura ' + s.asignatura, s.codigo && 'código ' + s.codigo, s.semestre && 'semestre ' + s.semestre,
          s.semanas.length && 'cronograma de ' + s.semanas.length + ' semanas'].filter(Boolean).join(' · ') + '.');
        if (s.semestre && A.periodo && s.semestre !== A.periodo) {
          r.sugerido = 'No subió'; r.certeza = 'media';
          r.evidencia.push('El sílabo publicado es del semestre ' + s.semestre + ', no del ' + A.periodo + '.');
          r.mejorar.push('Reemplazar el sílabo por el del semestre ' + A.periodo + '.');
        } else if (!s.semestre) { r.certeza = 'media'; r.nota.push('No se encontró el semestre dentro del sílabo: confírmelo a mano.'); }
        const codArch = ((f.nombre || '').match(/(?:^|[^A-Z0-9])([A-Z]{2,5}\d{2,5})(?![0-9])/) || [])[1];
        const codPortal = String(ctx.codigo || '').replace(/\s/g, '').toUpperCase();
        const codigos = [['el sílabo', s.codigo], ['el nombre del archivo', codArch], ['el portal', codPortal]].filter(x => x[1]);
        if (new Set(codigos.map(x => x[1].toUpperCase())).size > 1)
          r.nota.push('Los códigos no coinciden: ' + codigos.map(x => x[1] + ' en ' + x[0]).join(', ') + '. Confirme que es el sílabo de este curso.');
        if (!s.semanas.length) r.nota.push('No se pudo leer el cronograma por semanas del sílabo; el punto 05 se revisa sin los temas.');
      }
      if (dif < 0) r.mejorar.push('Para el próximo semestre, publicarlo antes del primer día de clases.');
      r.para_docente = r.sugerido === 'Subió'
        ? 'Gracias por publicar el sílabo en el aula virtual.' + (dif < 0 ? ' Para el próximo semestre le sugerimos publicarlo antes del primer día de clases, para que los estudiantes lo tengan desde la semana 1.' : '')
        : 'El sílabo publicado en el aula virtual corresponde al semestre ' + (s && s.semestre) + '. Le pedimos reemplazarlo por el sílabo del semestre ' + A.periodo + ', en la sección general del aula.';
      r.silabo = s;
    })();
    const silabo = R['01'].silabo;

    /* 02 · Mensaje de sensibilización --------------------------------- */
    (function () {
      const r = R['02'] = { punto: '02', evidencia: [], mejorar: [], nota: [] };
      const todos = recursos.filter(a => a.clase === 'sensibilizacion'), vis = todos.filter(a => a.visible);
      const [anio, sem] = (A.periodo || '-').split('-');
      const rxCiclo = new RegExp(anio + '\\s*[-–]?\\s*(' + (sem === '2' ? 'ii|2' : 'i|1') + ')\\b', 'i');
      const bienvenida = H.acts.find(a => a.mod === 'label' && a.visible && /bienvenid/i.test(a.texto || ''));
      if (!vis.length) {
        r.sugerido = 'No subió'; r.certeza = 'alta';
        r.evidencia.push(todos.length ? 'El mensaje de sensibilización está en el aula pero oculto.' : 'No se encontró el mensaje de sensibilización (ni por el nombre ni por su primera página).');
        if (bienvenida) r.evidencia.push('Sí hay un mensaje de bienvenida del docente, pero no reemplaza al mensaje de sensibilización de la Facultad.');
        r.mejorar.push('Publicar el mensaje de sensibilización ' + A.periodo + ' de la Facultad en la sección general del aula.');
        r.para_docente = 'Le pedimos publicar en la sección general del aula virtual el mensaje de sensibilización del semestre ' + A.periodo + ' que envió la Facultad.';
        return;
      }
      const a = vis[0], f = a.archivos[0] || {};
      const vigente = rxCiclo.test(norm(f.nombre + ' ' + a.titulo + ' ' + (f.inicioTexto || '').slice(0, 300)));
      r.evidencia.push('«' + (f.nombre || a.titulo) + '» en ' + enSemana(a) + ', publicado el ' + fecha(a.agregado) + '.');
      if (bienvenida) r.evidencia.push('Además, el docente dejó un mensaje de bienvenida en ' + enSemana(bienvenida) + '.');
      if (vigente) { r.sugerido = 'Subió'; r.certeza = 'alta'; r.para_docente = 'Gracias por publicar el mensaje de sensibilización del semestre en el aula virtual.'; }
      else {
        r.sugerido = 'Subió'; r.certeza = 'media';
        r.nota.push('No se pudo confirmar que el mensaje sea del semestre ' + A.periodo + ' (el nombre y la primera página no lo dicen). Revíselo.');
        r.para_docente = 'Gracias por publicar el mensaje de sensibilización. Por favor, verifique que sea el del semestre ' + A.periodo + '.';
      }
    })();

    /* 07 · Materiales adicionales ------------------------------------- */
    (function () {
      const r = R['07'] = { punto: '07', evidencia: [], mejorar: [], nota: [] };
      const enlaces = H.acts.filter(a => a.mod === 'url' && a.visible && !esReunion(a.dominio) && !esChat(a.dominio));
      const lecturas = visibles.filter(a => a.clase === 'lectura' || a.mod === 'folder' || a.mod === 'book');
      const excluidos = H.acts.filter(a => a.mod === 'url' && (esReunion(a.dominio) || esChat(a.dominio)));
      enlaces.forEach(a => r.evidencia.push(nombreDominio(a.dominio) + ': «' + a.titulo + '» (' + enSemana(a) + ', ' + fecha(a.agregado) + ').'));
      lecturas.forEach(a => r.evidencia.push('Lectura o carpeta: «' + a.titulo + '» (' + enSemana(a) + ').'));
      if (excluidos.length) r.nota.push('No se cuentan aquí: ' + y(excluidos.map(a => nombreDominio(a.dominio) + ' («' + a.titulo + '»)')) + '.');
      const n = enlaces.length + lecturas.length;
      r.sugerido = n ? 'Existen' : 'No existen'; r.certeza = 'media';
      if (!n) {
        r.evidencia.push('No hay enlaces ni lecturas complementarias (fuera del material de clase).');
        r.mejorar.push('Agregar al menos una lectura, video o artículo de apoyo en las semanas que corresponda.');
        r.para_docente = 'Le sugerimos agregar recursos complementarios (lecturas, videos o artículos) en las semanas que correspondan, con una línea que diga para qué sirve cada uno.';
      } else {
        r.para_docente = 'Gracias por compartir ' + plural(n, 'recurso complementario', 'recursos complementarios') + ' (' + y([...new Set(enlaces.map(a => nombreDominio(a.dominio)))].concat(lecturas.length ? ['lecturas'] : [])) + ').';
        if (n < 3) r.mejorar.push('Si es posible, sumar recursos complementarios en las otras unidades del curso.');
      }
    })();

    /* 05 · Materiales por semana -------------------------------------- */
    const cuadro = [];
    (function () {
      const r = R['05'] = { punto: '05', evidencia: [], mejorar: [], nota: [] };
      const semSil = (silabo && silabo.semanas) || [];
      const totalSem = semSil.length ? Math.max(...semSil.map(s => s.n)) : Math.max(0, H.secciones.length - 1);
      // Palabras de cada tema, con más peso las que distinguen una semana de otra.
      const STOP = new Set('para como entre sobre desde segun mediante concepto conceptos objetivos objetivo casos problemas aplicacion ventajas desventajas estrategia metodo metodos procedimiento aspectos tecnicos caso aplicativos tipo tipos respecto luego integralmente sesiones trabajos derivados conocimientos'.split(' '));
      const palabras = s => [...new Set(norm(s).split(/[^a-z0-9]+/).filter(w => w.length > 4 && !STOP.has(w)))];
      const kw = {}; semSil.forEach(s => kw[s.n] = palabras(s.titulo));
      const conTema = s => s && !s.sinMaterial && !/pr[aá]ctica calificada|sustentaci[oó]n/i.test(s.titulo || '');
      const df = {}; Object.values(kw).forEach(l => l.forEach(w => df[w] = (df[w] || 0) + 1));
      const nS = Math.max(1, semSil.length);
      // Las palabras que se repiten en muchos temas («distribución», «planta») no distinguen semanas.
      Object.keys(kw).forEach(n => kw[n] = kw[n].filter(w => df[w] <= Math.max(1, Math.floor(nS / 4))));
      const peso = w => Math.log(1 + nS / (df[w] || 1));
      const parecido = (n, texto) => { const l = kw[n] || []; if (!l.length) return 0; const t = ' ' + norm(texto) + ' ';
        let a = 0, b = 0; l.forEach(w => { b += peso(w); if (t.indexOf(w) >= 0) a += peso(w); }); return a / b; };

      const hashSemana = {};
      for (let n = 1; n <= totalSem; n++) {
        const s = semSil.find(x => x.n === n) || {};
        const mats = recursos.filter(a => a.seccion === n && ['clase', 'lectura', 'sesion'].includes(a.clase));
        const evals = H.acts.filter(a => a.seccion === n && (a.mod === 'assign' || a.mod === 'quiz' || (a.archivos.length && (a.clase === 'evaluacion' || a.clase === 'rubrica'))));
        const reun = H.acts.filter(a => a.seccion === n && a.mod === 'url' && esReunion(a.dominio));
        const limite = n === 1 && REGLAS.semana1DesdeInicio ? ini : inicioSemana(n) - REGLAS.diasMaterial;
        const fila = { n, inicio: inicioSemana(n), tema: s.titulo || '', unidad: s.unidad || '', sinMaterial: !!s.sinMaterial,
          limite, materiales: [], evaluaciones: evals.map(a => a.titulo), reuniones: reun.map(a => nombreDominio(a.dominio) + ' «' + a.titulo + '»'),
          problemas: [], estado: '' };
        fila.corresponde = limite <= diaCopia;
        fila.enCurso = n === H.semanaActual;
        mats.forEach(a => {
          const dias = inicioSemana(n) - diaLima(a.agregado);
          const m = { titulo: a.titulo, archivos: a.archivos.map(f => f.nombre), agregado: a.agregado, dias, visible: a.visible,
            aTiempo: diaLima(a.agregado) <= limite, sesion: null, repetidoDe: null, pareceSemana: null };
          a.archivos.forEach(f => {
            if (f.sesionEnPdf != null && m.sesion == null) m.sesion = f.sesionEnPdf;
            const prev = hashSemana[f.hash];
            if (prev && prev.n !== n) { m.repetidoDe = prev.n; m.original = prev.m; }
            else if (!prev) hashSemana[f.hash] = { n, m };
            if (f.modificado && diaLima(f.modificado) > diaLima(a.agregado) + 1) m.reemplazado = f.modificado;
          });
          // Se compara con el título del tema: nombre del archivo y el título de su primera diapositiva.
          const texto = m.texto = a.titulo + ' ' + a.archivos.map(f => f.nombre + ' ' + (f.tituloDeclarado || '')).join(' ');
          const ft = a.archivos.find(f => f.tituloDeclarado != null);
          m.tituloPpt = ft ? ft.tituloDeclarado : '';
          if (s.temas && conTema(s) && !m.repetidoDe) m.cmp = ft ? compararTitulo(m.tituloPpt, s.temas) : { estado: 'sin-texto' };
          if (semSil.length && !m.repetidoDe && conTema(s) && (kw[n] || []).length) {
            const propio = parecido(n, texto);
            let mejor = n, pm = propio;
            semSil.forEach(x => { if (x.n !== n && conTema(x)) { const v = parecido(x.n, texto); if (v > pm + 0.001) { pm = v; mejor = x.n; } } });
            m.propio = propio;
            if (mejor !== n && pm >= 0.6 && propio < 0.6 && pm - propio >= 0.25) m.pareceSemana = mejor;
          }
          fila.materiales.push(m);
        });
        const vis = fila.materiales.filter(m => m.visible);
        if (fila.sinMaterial) fila.estado = 'evaluacion';
        else if (!fila.corresponde && !vis.length) fila.estado = 'futuro';
        else if (!vis.length) { fila.estado = 'falta'; fila.problemas.push(fila.materiales.length ? 'el material está oculto' : 'sin material'); }
        else {
          const primero = Math.min(...vis.map(m => diaLima(m.agregado)));
          fila.publicado = primero; fila.anticipacion = inicioSemana(n) - primero;
          fila.aTiempo = primero <= limite;
          if (!fila.aTiempo) fila.problemas.push(n === 1 && REGLAS.semana1DesdeInicio ? 'publicado después del inicio del curso' : 'publicado con menos de ' + REGLAS.diasMaterial + ' días de anticipación');
          vis.filter(m => m.repetidoDe).forEach(m => fila.problemas.push('«' + m.titulo + '» es el mismo archivo de la semana ' + m.repetidoDe));
          vis.forEach(m => { if (m.sesion != null && m.sesion !== n && !m.repetidoDe) fila.problemas.push('el archivo «' + m.titulo + '» dice «Sesión ' + m.sesion + '»'); });
          // Un archivo repetido sí sirve a esta semana si su contenido es el de su tema.
          const sirve = m => !m.repetidoDe || !conTema(s) || parecido(n, m.texto) >= 0.6;
          if (!vis.some(sirve)) fila.problemas.push('no tiene material propio');
          const cmps = vis.filter(m => m.cmp && m.cmp.estado !== 'sin-titulo' && m.cmp.estado !== 'sin-texto');
          fila.tituloOk = cmps.some(m => m.cmp.estado === 'igual');
          fila.conTitulo = cmps.length > 0;
          if (cmps.length && !fila.tituloOk) fila.problemas.push('el título de la presentación no es el del sílabo');
          vis.forEach(m => { if (m.pareceSemana) fila.problemas.push('el contenido de «' + m.titulo + '» parece el tema de la semana ' + m.pareceSemana); });
          if (!vis.some(sirve)) fila.sinPropio = true;
          fila.estado = fila.problemas.length ? (fila.aTiempo || fila.problemas.length > 1 ? 'revisar' : 'tarde') : 'ok';
          if (fila.problemas.some(p => /parece el tema/.test(p)) || (fila.sinPropio && conTema(s))) fila.temaSinMaterial = true;
        }
        cuadro.push(fila);
      }
      // Si el tema de una semana sí está, pero en otra semana, se dice dónde.
      cuadro.forEach(f => { if (!f.temaSinMaterial || !(kw[f.n] || []).length) return;
        const otra = cuadro.find(g => g.n !== f.n && g.materiales.some(m => m.visible && !m.repetidoDe && parecido(f.n, m.texto) >= 0.6));
        if (otra) f.temaEn = otra.n; });
      const evaluables = cuadro.filter(f => f.corresponde && !f.sinMaterial);
      const ok = evaluables.filter(f => f.estado === 'ok');
      const conMat = evaluables.filter(f => f.estado !== 'falta');
      const tarde = evaluables.filter(f => f.publicado != null && !f.aTiempo);
      const faltan = evaluables.filter(f => f.estado === 'falta');
      const rep = []; cuadro.forEach(f => f.materiales.forEach(m => { if (m.repetidoDe) rep.push([m.repetidoDe, f.n]); }));
      const sesionMal = []; cuadro.forEach(f => f.materiales.forEach(m => { if (m.sesion != null && m.sesion !== f.n && !m.repetidoDe) sesionMal.push([f.n, m.sesion]); }));
      const sinTema = cuadro.filter(f => f.temaSinMaterial && f.corresponde && !f.sinMaterial);

      if (!evaluables.length) { r.sugerido = ''; r.certeza = 'baja'; r.evidencia.push('A la fecha de la copia todavía no corresponde publicar material de ninguna semana.'); r.para_docente = ''; return; }
      r.sugerido = ok.length === evaluables.length ? 'Cumple' : (conMat.length ? 'Parcial' : 'No cumple');
      r.certeza = sinTema.length || sesionMal.length ? 'media' : 'alta';
      r.evidencia.push('Se revisan ' + plural(evaluables.length, 'semana', 'semanas') + ' (las que a la fecha de la copia ya debían tener material' +
        (cuadro.some(f => f.sinMaterial) ? '; no se exigen las de examen' : '') + '). Cumplen en todo: ' + (ok.length ? 'semana' + (ok.length > 1 ? 's ' : ' ') + y(ok.map(f => String(f.n))) : 'ninguna') + '.');
      if (tarde.length) r.evidencia.push('Publicadas tarde: ' + tarde.map(f => 'semana ' + f.n + ' (' + diasTxt(f.anticipacion) + ' de su inicio)').join('; ') + '. Solo cumplen la anticipación: ' +
        (evaluables.filter(f => f.aTiempo).map(f => 'semana ' + f.n).join(', ') || 'ninguna') + '.');
      if (rep.length) r.evidencia.push('Mismo archivo repetido: ' + rep.map(p => 'semanas ' + p[0] + ' y ' + p[1]).join('; ') + '.');
      sesionMal.forEach(p => r.evidencia.push('En la semana ' + p[0] + ' el archivo dice «Sesión ' + p[1] + '».'));
      sinTema.forEach(f => { if (f.tema) r.evidencia.push(f.temaEn
        ? 'El material del tema de la semana ' + f.n + ' («' + f.tema.toLowerCase() + '») está publicado en la semana ' + f.temaEn + '.'
        : 'El tema de la semana ' + f.n + ' («' + f.tema.toLowerCase() + '») no tiene material en el aula.'); });
      cuadro.forEach(f => f.materiales.forEach(m => { if (m.pareceSemana) r.evidencia.push('En la semana ' + f.n + ', «' + m.titulo + '» trae el tema de la semana ' + m.pareceSemana + '.'); }));
      if (faltan.length) r.evidencia.push('Sin material: semana' + (faltan.length > 1 ? 's ' : ' ') + y(faltan.map(f => String(f.n))) + '.');
      // Títulos: lo que observó el auditor en 2025 (NC 8.5.2).
      const conT = evaluables.filter(f => f.conTitulo), titMal = conT.filter(f => !f.tituloOk);
      const sinLeer = evaluables.filter(f => !f.conTitulo && f.materiales.some(m => m.cmp && (m.cmp.estado === 'sin-titulo' || m.cmp.estado === 'sin-texto')));
      if (conT.length) r.evidencia.push('Títulos de las presentaciones: en ' + (conT.length - titMal.length) + ' de ' + plural(conT.length, 'semana', 'semanas') +
        ' el título es el mismo del tema del sílabo.');
      titMal.forEach(f => { const m = f.materiales.find(x => x.cmp && x.cmp.tema && x.cmp.estado !== 'sin-texto');
        if (m) r.evidencia.push('Semana ' + f.n + ': el sílabo dice «' + m.cmp.tema + '»; la presentación dice «' + m.tituloPpt + '».'); });
      if (sinLeer.length) r.certeza = 'media';
      if (sinLeer.length) r.nota.push('No se pudo leer el título de la presentación en la semana' + (sinLeer.length > 1 ? 's ' : ' ') + y(sinLeer.map(f => String(f.n))) + ' (¿es una imagen escaneada?): revíselo a mano.');
      const proximas = cuadro.filter(f => !f.corresponde && !f.sinMaterial).slice(0, 1);
      // Qué mejorar: qué + dónde + cuándo.
      if (faltan.length) r.mejorar.push('Subir el material de ' + (faltan.length > 1 ? 'las semanas ' : 'la semana ') + y(faltan.map(f => f.n + (f.tema ? ' (' + f.tema.toLowerCase() + ')' : ''))) + '.');
      const aRevisar = [...new Set(rep.map(p => p[1]).concat(sinTema.map(f => f.n)))];
      if (aRevisar.length) r.mejorar.push((aRevisar.length > 1 ? 'Revisar las semanas ' : 'Revisar la semana ') + y(aRevisar.sort((a, b) => a - b).map(String)) + ': cada semana debe tener el material de su propio tema (hoy hay archivos repetidos o de otra semana).');
      if (tarde.length || proximas.length) r.mejorar.push('Publicar el material de cada semana al menos ' + REGLAS.diasMaterial + ' días antes de que empiece' +
        (proximas.length ? ' (el de la semana ' + proximas[0].n + ', a más tardar el ' + fechaDeDia(proximas[0].limite) + ')' : '') + '.');
      if (titMal.length) {
        const ej = titMal[0], mj = ej.materiales.find(x => x.cmp && x.cmp.tema);
        r.mejorar.push('Poner en la primera diapositiva de cada clase el título exacto del tema del sílabo (semana' + (titMal.length > 1 ? 's ' : ' ') +
          y(titMal.map(f => String(f.n))) + ')' + (mj ? '; por ejemplo, en la semana ' + ej.n + ': «' + mj.cmp.tema + '»' : '') + '.');
        r.nota.push('En la auditoría interna 2025 (NC 8.5.2, trazabilidad) se observó una presentación cuyo título no era el del sílabo, aunque el tema fuera parecido. ' +
          'Aquí se exige el mismo texto del tema (sin importar mayúsculas, tildes ni signos).');
      }
      if (sesionMal.length) r.nota.push('Puede que la numeración de sesiones del docente no sea por semana (p. ej., dos sesiones por semana). Confírmelo antes de observarlo.');
      if (cuadro.some(f => f.n === 1 && f.publicado != null && !f.aTiempo)) r.nota.push('La semana 1 se mide contra el primer día de clases (' + fechaDeDia(ini) + '), no 7 días antes. Esta regla está por confirmar.');
      r.para_docente = r.sugerido === 'Cumple'
        ? 'Gracias: el material de cada semana está publicado a tiempo y corresponde a su tema.'
        : 'Gracias por el material que ya publicó' + (conMat.length ? ' en las semanas ' + y(conMat.map(f => String(f.n))) : '') + '. Para completar este punto le pedimos:\n' +
          r.mejorar.map((t, i) => (i + 1) + '. ' + t).join('\n');
    })();

    /* 03, 04, 06, 08 · solo inventario (reglas en la siguiente etapa) -- */
    (function () {
      const sesiones = visibles.filter(a => a.clase === 'sesion');
      R['03'] = { punto: '03', sugerido: '', certeza: 'pendiente', mejorar: [], nota: ['Regla automática en preparación: revise este punto a mano.'], para_docente: '',
        evidencia: [sesiones.length ? plural(sesiones.length, 'documento llamado sesión de aprendizaje o plan de sesión', 'documentos llamados sesión de aprendizaje o plan de sesión') + '.' : 'No hay documentos llamados «sesión de aprendizaje» o «plan de sesión».',
          A.subgrupo === '0' ? 'Esta copia es solo del aula de teoría: para este punto hace falta también la del taller (nombre corto terminado en -1).' : ''].filter(Boolean) };
      R['04'] = regla04(H, recursos, cuadro, silabo, diaCopia);
      const cnt = m => H.acts.filter(a => a.mod === m && a.visible).length;
      R['06'] = { punto: '06', sugerido: '', certeza: 'pendiente', mejorar: [], nota: ['Compare con lo que anuncia el sílabo: la coherencia la decide usted.'], para_docente: '',
        evidencia: ['Tareas: ' + cnt('assign') + ' · cuestionarios: ' + cnt('quiz') + ' · foros: ' + cnt('forum') + (H.acts.filter(a => a.mod === 'forum').length ? ' (' + y(H.acts.filter(a => a.mod === 'forum').map(a => '«' + a.titulo + '»')) + ')' : '') + '.'] };
      R['08'] = regla08(H, ctx, cuadro, inicioSemana, diaCopia);
    })();

    // Texto completo, estándar literal y orden.
    const crit = ctx.criterios || [];
    PUNTOS.forEach(([n, et], i) => {
      const r = R[n]; r.nombre = et;
      const c = crit[i] || {}; r.estandar = c.nota || '';
      r.recomendacion = r.mejorar.join(' ');
      r.nota_interna = r.nota.join(' ');
      if (r.automatico == null) r.automatico = AUTOMATICOS.includes(n);
    });
    const res = { hechos: H, puntos: R, cuadro, versionReglas: VERSION_REGLAS };
    res.resumen = resumen(res);
    return res;
  }

  function resumen(res) {
    const R = res.puntos, auto = PUNTOS.map(p => R[p[0]]).filter(r => r.automatico);
    const conforme = r => ['Cumple', 'Subió', 'Existen'].includes(r.sugerido);
    const acciones = [];
    ['05', '04', '08', '01', '02', '07'].filter(n => R[n].automatico).forEach(n => R[n].mejorar.forEach(t => acciones.push({ punto: n, nombre: R[n].nombre, t, conforme: conforme(R[n]) })));
    // Primero lo más grave (No cumple, luego Parcial) y una acción por punto antes de repetir punto.
    const grav = n => /^no /i.test(R[n].sugerido) ? 0 : R[n].sugerido === 'Parcial' ? 1 : 2;
    const vistos = {};
    acciones.forEach(a => { a.orden = (vistos[a.punto] = (vistos[a.punto] || 0) + 1); });
    acciones.sort((a, b) => (grav(a.punto) === 2) - (grav(b.punto) === 2) || (a.orden > 1) - (b.orden > 1) || grav(a.punto) - grav(b.punto) || a.orden - b.orden);
    return { revisados: auto.length, conformes: auto.filter(conforme).length, acciones: acciones.slice(0, 3),
      autos: auto.map(r => r.punto), manuales: PUNTOS.map(p => p[0]).filter(n => !R[n].automatico) };
  }

  /* --------------------------------------- formato para guardar (JSON) */
  function hallazgosJSON(res) {
    const o = {};
    PUNTOS.forEach(([n]) => {
      const r = res.puntos[n];
      o[n] = { punto: n, sugerido: r.sugerido || '', certeza: r.certeza || '', evidencia: r.evidencia.slice(0, 8),
        recomendacion: r.recomendacion || '', para_docente: r.para_docente || '', nota_interna: r.nota_interna || '' };
    });
    return o;
  }
  function textoBorrador(res) {
    const A = res.hechos.aula, L = [];
    L.push('Pre-verificación automática del aula virtual «' + A.nombre + '» (copia del ' + fechaHora(A.copia) + ', semana ' + res.hechos.semanaActual + ' del ciclo).');
    PUNTOS.forEach(([n, et]) => {
      const r = res.puntos[n];
      if (!r.automatico) return;
      L.push('');
      L.push(n + ' ' + et + ' — sugerido: ' + (r.sugerido || 'revisar a mano'));
      if (r.para_docente) L.push(r.para_docente);
    });
    L.push('');
    const man = PUNTOS.map(p => p[0]).filter(n => !res.puntos[n].automatico);
    if (man.length) L.push('Puntos ' + y(man) + ': revisión a mano (reglas automáticas en preparación).');
    return 'BORRADOR DEL ASISTENTE — revíselo, corríjalo o bórrelo antes de guardar\n\n' + L.join('\n');
  }

  /* ------------------------------------------------------- el reporte */
  const ESTADOS = {
    'Cumple': ['ok', '✔'], 'Subió': ['ok', '✔'], 'Existen': ['ok', '✔'],
    'Parcial': ['parcial', '◐'], 'No cumple': ['falla', '✖'], 'No subió': ['falla', '✖'], 'No existen': ['falla', '✖'],
    'No aplica': ['neutro', '–'], '': ['manual', '✎']
  };
  const chip = s => { const e = ESTADOS[s] || ESTADOS['']; return '<span class="mbz-chip mbz-' + e[0] + '">' + e[1] + ' ' + esc(s || 'Revisar a mano') + '</span>'; };
  const CERTEZA = { alta: 'Alta: es un dato del aula (existe o no, fechas).', media: 'Media: conviene que usted lo confirme.', baja: 'Baja: revíselo usted.', pendiente: 'Sin regla automática todavía.' };
  const ESTADO_SEMANA = {
    ok: ['ok', '✔ A tiempo'], tarde: ['parcial', '◐ Publicado tarde'], revisar: ['parcial', '◐ Revisar'], falta: ['falla', '✖ Sin material'],
    futuro: ['neutro', 'Aún no corresponde'], evaluacion: ['neutro', 'Semana de examen']
  };

  function reporteHTML(res, op) {
    op = op || {};
    const H = res.hechos, A = H.aula, R = res.puntos, S = res.resumen;
    const h = [];
    h.push('<div class="mbz-rep">');
    h.push('<div class="mbz-cab"><div class="mbz-cab-t">Reporte de la copia del aula virtual</div>' +
      '<div class="mbz-cab-d"><b>' + esc(A.nombre) + '</b> · ' + esc(A.corto) + ' · ' + esc(A.tipo) +
      '<br>Copia descargada el <b>' + fechaHora(A.copia) + '</b> (semana ' + H.semanaActual + ' del ciclo; la semana 1 empezó el ' + fechaDeDia(H.inicioDia) + '). ' +
      'El reporte describe el aula <b>ese día</b>.</div></div>');
    if (op.aviso) h.push('<div class="mbz-aviso">' + op.aviso + '</div>');
    if (A.subgrupo === '0') h.push('<div class="mbz-aviso">Esta copia es <b>solo del aula de teoría</b>. Para completar los puntos 03 y 08 hace falta también la copia del aula de taller del mismo grupo (su nombre corto termina en <b>-1</b>).</div>');

    // Resumen
    h.push('<section class="mbz-resumen"><h4>Resumen</h4><p class="mbz-grande">De los <b>' + S.revisados + '</b> puntos que el portal ya revisa solo (' + y(S.autos) + '), <b>' +
      S.conformes + '</b> ' + (S.conformes === 1 ? 'aparece conforme' : 'aparecen conformes') + '. ' +
      (S.manuales.length ? 'Los puntos ' + y(S.manuales) + ' se revisan a mano por ahora.' : '') + '</p>');
    h.push('<table class="mbz-tabla mbz-mini"><tbody>' + PUNTOS.map(([n, et]) => '<tr><td class="mbz-n">' + n + '</td><td>' + esc(et) + '</td><td>' + chip(R[n].sugerido) + '</td></tr>').join('') + '</tbody></table>');
    if (S.acciones.length) h.push('<p class="mbz-sub"><b>Lo más importante para el docente</b></p><ol class="mbz-acc">' +
      S.acciones.map(a => '<li><b>' + a.punto + ' ' + esc(a.nombre) + ':</b> ' + esc(a.t) + '</li>').join('') + '</ol>');
    h.push('</section>');

    if (op.botones) h.push('<div class="mbz-botones">' + op.botones + '</div>');
    if (op.pedirHorario) h.push('<div class="mbz-horario"><b>Solo administrador · Punto 08: pegue el horario de la guía de matrícula.</b><br>' +
      'Abra la <a href="https://webapp.urp.edu.pe/guia-matricula/horario" target="_blank" rel="noopener">guía de matrícula</a>, elija la carrera, la currícula y el semestre del curso, pulse «Buscar», ' +
      'seleccione la tabla con el mouse, cópiela (Ctrl + C) y péguela aquí (Ctrl + V). Puede pegar la tabla entera: el portal toma solo las filas de este grupo. ' +
      'Lo pegado sirve para los demás cursos de ese semestre mientras no cierre la página.' +
      '<textarea id="mbzHorarioTxt" rows="4" placeholder="Pegue aquí las filas de la guía de matrícula…"></textarea>' +
      (op.codigoHorario === undefined ? '' : '<label class="mbz-sub">Código del curso en la guía: <input type="text" id="mbzHorarioCod" value="' + esc(op.codigoHorario || '') + '" placeholder="p. ej. IN-1001" style="width:120px"></label> ') +
      '<button type="button" id="mbzHorarioUsar">Usar este horario</button>' + (op.horarioAviso ? '<div class="mbz-alto" style="margin-top:8px">' + op.horarioAviso + '</div>' : '') + '</div>');
    if (op.horarioUsado) h.push('<div class="mbz-sub">Horario usado para el punto 08 (guía de matrícula): ' + esc(op.horarioUsado) + '.</div>');

    // Fichas
    h.push('<h4 class="mbz-h">Ficha por punto</h4>');
    PUNTOS.forEach(([n, et]) => {
      const r = R[n];
      h.push('<details class="mbz-ficha"' + (r.automatico ? ' open' : '') + '><summary><span class="mbz-n">' + n + '</span> ' + esc(et) + ' ' + chip(r.sugerido) + '</summary>');
      if (r.estandar) h.push('<p class="mbz-std"><b>Estándar:</b> ' + esc(r.estandar) + '</p>');
      h.push('<dl>');
      h.push('<dt>Resultado sugerido</dt><dd>' + chip(r.sugerido) + '</dd>');
      h.push('<dt>Qué se encontró</dt><dd><ul>' + r.evidencia.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul></dd>');
      if (r.mejorar.length) h.push('<dt>Qué mejorar</dt><dd><ul>' + r.mejorar.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul></dd>');
      h.push('<dt>Certeza</dt><dd>' + esc(CERTEZA[r.certeza] || r.certeza) + '</dd>');
      if (r.automatico && r.para_docente !== undefined) h.push('<dt>Mensaje para el docente <small>(puede corregirlo)</small></dt><dd><textarea class="mbz-msj" data-punto="' + n + '" rows="' +
        Math.min(8, 2 + (r.para_docente.match(/\n/g) || []).length) + '">' + esc(r.para_docente) + '</textarea></dd>');
      if (r.nota_interna) h.push('<dt>Nota para usted <small>(no se envía al docente)</small></dt><dd class="mbz-interna">' + esc(r.nota_interna) + '</dd>');
      h.push('</dl></details>');
    });

    // Cuadro por semanas
    h.push('<h4 class="mbz-h">Cuadro por semanas</h4><p class="mbz-sub">Regla: el material de cada semana se publica al menos ' + REGLAS.diasMaterial +
      ' días antes de que empiece' + (REGLAS.semana1DesdeInicio ? ' (la semana 1, a más tardar el primer día de clases)' : '') +
      '. «Publicado» es la fecha en que el docente agregó el archivo al aula. Las semanas de examen no exigen material.</p>');
    h.push('<div class="mbz-scroll"><table class="mbz-tabla mbz-sem"><thead><tr><th>Sem.</th><th>Empieza</th><th>Tema del sílabo</th><th>Material</th><th>Publicado</th><th>Anticipación</th><th>Título de la presentación</th><th>Estado</th><th>Evaluación</th><th>Clase virtual y grabación</th></tr></thead><tbody>');
    res.cuadro.forEach(f => {
      const e = ESTADO_SEMANA[f.estado] || ['neutro', ''];
      const mats = f.materiales.length ? f.materiales.map(m => esc(m.titulo) + (m.visible ? '' : ' <i>(oculto)</i>') +
        (m.archivos.length && norm(m.archivos.join(' ')).indexOf(norm(m.titulo)) < 0 ? '<br><small>' + esc(m.archivos.join(', ')) + '</small>' : '') +
        (m.repetidoDe ? ' <span class="mbz-ojo">= semana ' + m.repetidoDe + '</span>' : '') +
        (m.sesion != null && m.sesion !== f.n && !m.repetidoDe ? ' <span class="mbz-ojo">dice Sesión ' + m.sesion + '</span>' : '')).join('<br>') : '—';
      const TIT = { igual: ['ok', '✔ Igual al sílabo'], parecido: ['falla', '✖ No es el del sílabo'], incompleto: ['falla', '✖ No es el del sílabo'], distinto: ['falla', '✖ No es el del sílabo'],
        'sin-titulo': ['neutro', 'No se leyó'], 'sin-texto': ['neutro', 'No se leyó'] };
      const mt = f.materiales.filter(m => m.cmp);
      const tit = mt.length ? mt.map(m => { const t = TIT[m.cmp.estado] || ['neutro', '']; return '<span class="mbz-chip mbz-' + t[0] + '">' + t[1] + '</span>' +
        (m.tituloPpt ? '<br><small>«' + esc(m.tituloPpt) + '»</small>' : ''); }).join('<br>') : '—';
      const virt = (f.reuniones.map(esc).join('<br>') || '') + (f.virtuales ? (f.reuniones.length ? '<br>' : '') + f.virtuales + ' clase' + (f.virtuales > 1 ? 's' : '') + ' virtual' + (f.virtuales > 1 ? 'es' : '') : '') +
        ((f.grabaciones || []).length ? '<br>🎥 ' + f.grabaciones.map(esc).join('<br>🎥 ') : (f.virtuales ? '<br><span class="mbz-ojo">sin grabación</span>' : ''));
      h.push('<tr class="' + (f.enCurso ? 'mbz-hoy' : '') + '"><td class="mbz-n">' + f.n + (f.enCurso ? '<br><small>en curso</small>' : '') + '</td><td>' + fechaDeDia(f.inicio) + '</td><td>' + esc(f.tema || '—') + '</td><td>' + mats + '</td><td>' +
        (f.publicado != null ? fechaDeDia(f.publicado) : '—') + '</td><td>' + (f.anticipacion != null ? esc(diasTxt(f.anticipacion)) : '—') + '</td><td>' + tit + '</td><td><span class="mbz-chip mbz-' + e[0] + '">' + e[1] + '</span>' +
        (f.problemas.length ? '<div class="mbz-prob">' + f.problemas.map(esc).join('<br>') + '</div>' : '') + '</td><td>' + ((f.evalDet && f.evalDet.length ? f.evalDet.map(e => esc(e.titulo) + (e.rub === 'ok' ? ' <span class="mbz-chip mbz-ok">✔ con rúbrica</span>' : e.rub === 'tarde' ? ' <span class="mbz-chip mbz-parcial">◐ rúbrica tardía</span>' : e.rub === 'sin' ? ' <span class="mbz-chip mbz-falla">✖ sin rúbrica</span>' : '')) : f.evaluaciones.map(esc)).join('<br>') || '—') + '</td><td>' + (virt || '—') + '</td></tr>');
    });
    h.push('</tbody></table></div>');

    h.push('<div class="mbz-pie"><b>Pre-verificación automática. La decisión final es del coordinador.</b><br>' +
      'Archivo analizado: ' + esc(H.archivo.nombre) + ' (' + (H.archivo.tamano / 1048576).toFixed(1) + ' MB, Moodle ' + esc(A.moodle) + '). ' +
      'Se leyeron ' + H.acts.length + ' elementos del aula y el texto de ' + plural(H.pdfLeidos.length, 'PDF', 'PDF') + (H.pdfLeidos.length ? ': ' + esc(H.pdfLeidos.join(' · ')) : '') + '. ' +
      'El archivo no se envió a ningún servidor. De los enlaces solo se muestra el dominio y los correos se ocultan. Reglas: ' + esc(VERSION_REGLAS) + '.' +
      (H.avisos.length ? '<br>' + H.avisos.map(esc).join('<br>') : '') + '</div>');
    h.push('</div>');
    return h.join('');
  }

  const CSS = `
.mbz-rep{margin:12px 0 16px;border:1px solid var(--linea,#dfe4e1);border-radius:12px;background:var(--papel,#fff);padding:14px 16px;font-size:15px;line-height:1.55;color:var(--tinta,#15201b)}
.mbz-rep h4{margin:14px 0 6px;font-size:16px;color:var(--brand-oscuro,#0b6e48)}
.mbz-cab{border-bottom:2px solid var(--brand,#0f8f5e);padding-bottom:8px;margin-bottom:8px}
.mbz-cab-t{font-size:17px;font-weight:700;color:var(--brand-oscuro,#0b6e48)}
.mbz-cab-d{font-size:14.5px;color:var(--tinta-media,#5a6660)}
.mbz-aviso{background:#fff7e8;border:1px solid #f0d49a;border-left:4px solid #b8860b;border-radius:8px;padding:8px 12px;margin:8px 0;font-size:14.5px}
.mbz-grande{font-size:15.5px;margin:4px 0 8px}
.mbz-sub{font-size:14px;color:var(--tinta-media,#5a6660);margin:6px 0}
.mbz-acc{margin:4px 0 4px 20px;padding:0}.mbz-acc li{margin:3px 0}
.mbz-chip{display:inline-block;padding:1px 9px;border-radius:12px;font-size:13.5px;font-weight:600;white-space:nowrap;border:1px solid transparent}
.mbz-ok{background:#e6f4ee;color:#0b6e48;border-color:#b5dcc8}.mbz-parcial{background:#fdf3dc;color:#7a5a00;border-color:#ecd28e}
.mbz-falla{background:#fdecea;color:#8f2418;border-color:#f1b9b2}.mbz-neutro{background:#f0f2f1;color:#5a6660;border-color:#dfe4e1}
.mbz-manual{background:#eef3fb;color:#2d4f80;border-color:#c3d4ee}
.mbz-tabla{border-collapse:collapse;width:100%;font-size:14px}.mbz-tabla th,.mbz-tabla td{border:1px solid var(--linea,#dfe4e1);padding:6px 8px;vertical-align:top;text-align:left}
.mbz-tabla th{background:#f3f6f4;font-size:13.5px}.mbz-mini{max-width:560px}.mbz-n{font-weight:700;white-space:nowrap}
.mbz-ficha{border:1px solid var(--linea,#dfe4e1);border-radius:10px;margin:8px 0;padding:6px 12px;background:#fbfcfb}
.mbz-ficha summary{cursor:pointer;font-size:15.5px;font-weight:600;padding:4px 0}
.mbz-ficha dl{margin:6px 0 4px}.mbz-ficha dt{font-weight:700;font-size:14px;margin-top:8px;color:#2b3a33}.mbz-ficha dd{margin:2px 0 0}
.mbz-ficha ul{margin:2px 0 0 18px;padding:0}.mbz-std{background:#f2f6fc;border-left:4px solid #6b8fc2;padding:6px 10px;margin:6px 0;font-size:14px}
.mbz-msj{width:100%;font:inherit;font-size:14.5px;border:1px solid #c9d3cd;border-radius:8px;padding:8px}
.mbz-interna{color:#6a5a1e;background:#fffaf0;border-radius:6px;padding:4px 8px}
.mbz-scroll{overflow-x:auto}.mbz-sem td{font-size:13.5px}.mbz-hoy{background:#f2f8ff}
.mbz-prob{font-size:12.5px;color:#7a3b00;margin-top:4px}.mbz-ojo{color:#8f2418;font-weight:600}
.mbz-pie{margin-top:12px;border-top:1px dashed var(--linea,#dfe4e1);padding-top:8px;font-size:13px;color:var(--tinta-media,#5a6660)}
.mbz-botones{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.mbz-botones button{padding:8px 14px;border-radius:8px;border:1px solid var(--brand,#0f8f5e);background:var(--brand,#0f8f5e);color:#fff;font-size:14.5px}
.mbz-botones button.sec{background:#fff;color:var(--brand-oscuro,#0b6e48)}
.mbz-botones button:disabled{opacity:.55;cursor:not-allowed}
.mbz-progreso{margin:8px 0;padding:10px 12px;border-radius:8px;background:#eef6fb;border:1px solid #c3ddf3;font-size:14.5px}
.mbz-progreso progress{width:100%;height:12px;margin-top:6px}
.mbz-alto{margin:8px 0;padding:12px 14px;border-radius:8px;background:#fdecea;border:1px solid #f1b9b2;border-left:5px solid #c0392b;font-size:15px}
.mbz-preg{margin:8px 0;padding:12px 14px;border-radius:8px;background:#fff7e8;border:1px solid #f0d49a;font-size:15px}
.mbz-horario{margin:10px 0;padding:12px 14px;border-radius:8px;background:#eef6fb;border:1px solid #c3ddf3;font-size:14.5px}
.mbz-horario textarea{width:100%;margin:8px 0;font:inherit;font-size:13.5px;border:1px solid #c9d3cd;border-radius:8px;padding:8px}
.mbz-horario button{padding:8px 14px;border-radius:8px;border:1px solid var(--brand,#0f8f5e);background:var(--brand,#0f8f5e);color:#fff;font-size:14.5px}
.mbz-json{white-space:pre-wrap;font-family:'IBM Plex Mono',monospace;font-size:12px;background:#f6f8f7;border:1px solid #dfe4e1;border-radius:8px;padding:8px;max-height:320px;overflow:auto}
`;
  function ponerEstilos() {
    if (typeof document === 'undefined' || document.getElementById('mbz-css')) return;
    const s = document.createElement('style'); s.id = 'mbz-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  const API = { VERSION_REGLAS, REGLAS, PUNTOS, leerHorario, horarioDelAula, cargarHorarioPublicado, esCopiaMbz, buscarCopia, leer, cruzar, evaluar, hallazgosJSON, textoBorrador, reporteHTML, ponerEstilos, fecha, fechaHora };
  raiz.MBZ = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
