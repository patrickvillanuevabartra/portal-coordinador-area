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

  const VERSION_REGLAS = 'mbz-2026-10-29.4';

  // Parámetros que todavía decide Patrick (Traspaso v3, sección 7). Se dejan
  // con la recomendación del traspaso y se pueden cambiar aquí.
  const REGLAS = {
    // 29/10/2026: rigen las Recomendaciones del VRA para la modalidad virtual (confirmado para 2026-II).
    diasMaterial: 2,          // material: 48 horas antes de la primera clase de la semana
    diasRetro: 7,             // retroalimentación y notas: 7 días calendario tras el cierre
    horasGrabacion: 24,       // grabación publicada a más tardar 24 horas después de la clase
    semana1DesdeInicio: true, // semana 1: se mide contra el inicio del curso, no 7 días antes
    semanasSinMaterial: /^\s*(examen|semana de ex[aá]menes|evaluaci[oó]n final|sustentaci[oó]n de trabajos finales)/i,
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
    if (/\.(pdf|docx?|xlsx?|pptx?|csv|txt|vtt|srt|md|png|jpe?g|webp)$/i.test(f.name || '')) return false;
    try {
      const b = new Uint8Array(await f.slice(0, 4).arrayBuffer());
      if (b[0] === 0x1f && b[1] === 0x8b) return true;
      // Segunda opción: el .zip de «Descargar contenido del curso» (27/10/2026).
      return /\.zip$/i.test(f.name || '') && b[0] === 0x50 && b[1] === 0x4b;
    } catch (e) { return false; }
  }
  async function buscarCopia(archivos) {
    for (const f of archivos || []) if (await esCopiaMbz(f)) return f;
    return null;
  }
  // Todas las copias adjuntas (teoría y taller son aulas distintas en Moodle).
  async function buscarCopias(archivos) {
    const l = [];
    for (const f of archivos || []) if (await esCopiaMbz(f)) l.push(f);
    return l;
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
    // 28/10/2026: también semanas agrupadas («1-2-3», «4-5», «12-13-14-15») y el
    // número centrado en la celda (texto antes y después del número), como en los
    // sílabos de Taller de Investigación. Cada bloque se reparte a todas sus semanas.
    let dentro = false, unidad = '', sec = [];
    const RANGO = /^(\d{1,2})((?:\s*[-–,]\s*\d{1,2})+|\s+(?:al?|y)\s+\d{1,2})(?:\s+(.*))?$/i;
    const esExamen = t => /ex[aá]men|sustitutorio/i.test(t || '');
    const numsDe = (a, resto) => { const l = [a].concat((resto.match(/\d{1,2}/g) || []).map(Number));
      if (/\b(al?|y)\b/i.test(resto) && l.length === 2 && l[1] > l[0] && !/y/i.test(resto)) { const r = []; for (let k = l[0]; k <= l[1]; k++) r.push(k); return r; }
      return l; };
    const cerrar = () => {
      if (!sec.length) return;
      const iNum = sec.map((x, i) => x.nums ? i : -1).filter(i => i >= 0);
      if (!iNum.length) { sec = []; return; }
      const due = new Array(sec.length).fill(-1);
      iNum.forEach(i => due[i] = i);
      const centrado = iNum[0] > 0;          // hay texto antes del primer número
      for (let i = 0; i < sec.length; i++) {
        if (due[i] >= 0) continue;
        const prev = iNum.filter(k => k < i).pop(), next = iNum.find(k => k > i);
        let d;
        if (prev == null) d = next;
        else if (next == null) d = prev;
        else if (!centrado) d = prev;                                   // número arriba: el texto sigue
        else if (/^[a-záéíóúñü(]/.test(sec[i].t) && i > 0 && due[i - 1] >= 0) d = due[i - 1];   // continúa la línea anterior
        else if (esExamen(sec[next].t)) d = prev;                       // «16 SEMANA DE EXÁMENES» no absorbe texto
        else if (esExamen(sec[prev].t)) d = next;
        else d = (i - prev) <= (next - i) ? prev : next;
        due[i] = d;
      }
      iNum.forEach(k => {
        const lineas = [];
        sec.forEach((x, i) => { if (due[i] !== k) return; const t = i === k ? x.t : x.t; if (!t) return;
          if (lineas.length && /^[a-záéíóúñü(]/.test(t)) lineas[lineas.length - 1] += ' ' + t; else lineas.push(t); });
        const contenido = lineas.join(' ');
        const nums = sec[k].nums;
        nums.forEach(n => { if (n < 1 || n > 20 || s.semanas.some(x => x.n === n)) return;
          s.semanas.push({ n, contenido, unidad: sec[k].unidad, rango: nums.length > 1 ? nums.join('-') : '', lineasTema: lineas }); });
      });
      sec = [];
    };
    for (const l0 of lineas) {
      const l = l0.trim(), n = norm(l);
      if (!l || l === '\f' || ES_PIE.test(n) || /^pagina \d+ de \d+$/.test(n)) continue;
      if (/^semana\b.*contenido/.test(n) || /^seman(a)?$/.test(n) || /programacion de contenidos/.test(n)) { cerrar(); dentro = true; continue; }
      if (dentro && (/^contenido$/.test(n) || /^a$/.test(n))) continue;
      const u = l.match(/^UNIDAD\s+([IVX]+|\d+)\s*:?\s*(.*)$/i);
      if (u) { cerrar(); unidad = (u[1] + (u[2] ? ': ' + u[2] : '')).trim(); continue; }
      if (/^logro\b/.test(n)) { cerrar(); continue; }
      if (dentro && /^(vii|viii|ix|x)\.?\s+[a-z]/.test(n) && (s.semanas.length || sec.some(x => x.nums))) { cerrar(); break; }
      if (!dentro) continue;
      const w = l.match(/^(\d{1,2})\s+(.*[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}.*)$/);
      const solo = l.match(/^(\d{1,2})$/);
      const rg = l.match(RANGO);
      if (rg && !/^\d{1,2}\s+(al?|y)\s+\d{1,2}\s*[a-z]/i.test(l) && (rg[3] == null || /[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}/.test(rg[3])))
        sec.push({ nums: numsDe(+rg[1], rg[2]), t: (rg[3] || '').trim(), unidad });
      else if (w && +w[1] >= 1 && +w[1] <= 20) sec.push({ nums: [+w[1]], t: w[2], unidad });
      else if (solo && +solo[1] >= 1 && +solo[1] <= 20) sec.push({ nums: [+solo[1]], t: '', unidad });
      else if (!/^\d{1,3}$/.test(l)) sec.push({ t: l });
    }
    cerrar();
    s.semanas.forEach(x => {
      x.contenido = x.contenido.replace(/\s+/g, ' ').trim();
      x.temas = temasDeSemana(x.contenido);
      // Semanas agrupadas: cada línea del bloque es un tema (el sílabo no dice cuál va en cada semana).
      if (x.rango && x.lineasTema && x.lineasTema.length > 1) {
        const tm = x.lineasTema.map(t => t.replace(/[.\s]+$/, '').trim()).filter(t => t && !/^(monitoreo|evaluaci[oó]n del logro)/i.test(t));
        if (tm.length) x.temas = tm;
        // Para comparar títulos: también la parte antes de «:» y sin el paréntesis
        // («Matriz de consistencia: Redacción…» → «Matriz de consistencia»).
        const cand = [];
        x.temas.forEach(t => { [t.split(':')[0], t.replace(/\s*\([^)]*\)/g, ''), t.split(':')[0].replace(/\s*\([^)]*\)/g, '')]
          .map(z => z.trim()).filter(z => z.length >= 6).forEach(z => { if (!cand.includes(z)) cand.push(z); }); });
        x.temasCmp = cand.sort((p, q) => p.length - q.length);
      }
      x.titulo = x.temas.join('. ');
      // Para mostrar: si la semana no empieza con su título en mayúsculas, el inicio del texto.
      x.tituloVer = x.rango || norm(x.contenido).indexOf(norm(x.temas[0])) === 0 ? x.titulo : x.contenido.slice(0, 110).replace(/\s+\S*$/, '') + '…';
      delete x.lineasTema;
      x.sinMaterial = REGLAS.semanasSinMaterial.test(x.contenido);
    });
    s.semanas.sort((a, b) => a.n - b.n);
    return s;
  }

  /* ------------------------------------------------------ los hechos */
  async function leer(file, progreso, opciones) {
    const avance = (f, t) => progreso && progreso(f, t);
    avance(0, 'Abriendo la copia del aula…');
    // ¿Es el .zip de «Descargar contenido del curso»? (no trae moodle_backup.xml)
    const cab0 = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (cab0[0] === 0x50 && cab0[1] === 0x4b) {
      const fflate = await asegurarFflate();
      const todo = new Uint8Array(await file.arrayBuffer()), nombres = [];
      fflate.unzipSync(todo, { filter: f => { nombres.push(f.name); return false; } });
      if (!nombres.includes('moodle_backup.xml')) {
        if (nombres.some(n => /^[^\/]+\/index\.html$/i.test(n))) return leerZipContenido(file, todo, nombres, avance, opciones || {});
        throw new Error('El .zip no parece descargado del aula virtual: no trae la copia de seguridad (.mbz) ni el contenido del curso («Descargar contenido del curso»).');
      }
    }
    const ex = await extraer(file, f => avance(f * 0.7, 'Leyendo la copia del aula… ' + Math.round(f * 100) + '%'));
    const raizB = parsearXml(ex.xml['moodle_backup.xml']);
    if (!raizB) throw new Error('La copia no trae moodle_backup.xml: no parece una copia de seguridad de un aula de Moodle.');
    const inf = hijo(raizB, 'information');
    const g = k => val(hijo(inf, k));
    const ajustes = {};
    hijos(ruta(inf, 'settings'), 'setting').forEach(s => { if (val(hijo(s, 'level')) === 'root') ajustes[val(hijo(s, 'name'))] = val(hijo(s, 'value')); });
    const corto = g('original_course_shortname'), mc = corto.match(/(\d{4})(\d)-([0-9A-Z]+)-G(\d+)-(\d+)/i);
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

    await leerTextos(H, ex, avance);
    avance(1, 'Listo');
    return H;
  }

  /* =========================================================================
     Segunda opción (27/10/2026): el .zip de «Descargar contenido del curso»
     -------------------------------------------------------------------------
     Algunos coordinadores no tienen el permiso «Reutilización de curso» y no
     pueden sacar la copia de seguridad (.mbz). Moodle sí les deja «Más →
     Descargar contenido del curso»: un .zip con una página por actividad y
     sus archivos, ordenado por semanas.
     Trae: el nombre del aula, las semanas, cada recurso con su nombre, sus
     archivos (PDF, Word, PowerPoint) y los enlaces.
     NO trae: las fechas de publicación, si algo está oculto, las rúbricas
     configuradas en las tareas ni las fechas de las tareas, ni los archivos
     de más de 50 MB. Las reglas lo tienen en cuenta (H.fuente === 'zip').
     ========================================================================= */
  const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
  const TIPO_ZIP = { archivo: 'resource', carpeta: 'folder', tarea: 'assign', foro: 'forum', url: 'url', etiqueta: 'label', 'area de texto y medios': 'label',
    pagina: 'page', libro: 'book', cuestionario: 'quiz', leccion: 'lesson', glosario: 'glossary', wiki: 'wiki', encuesta: 'feedback', consulta: 'choice',
    taller: 'workshop', h5p: 'h5pactivity', 'paquete scorm': 'scorm', chat: 'chat', 'base de datos': 'data' };
  const MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ppt: 'application/vnd.ms-powerpoint',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    mkv: 'video/x-matroska', avi: 'video/x-msvideo', m4v: 'video/mp4', mp3: 'audio/mpeg', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', zip: 'application/zip' };
  const entidades = s => String(s || '').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const textoPlano = h => entidades(String(h || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  // Huella del archivo (para ver si el mismo archivo se repite en dos semanas).
  function huella(d) { let h = 0x811c9dc5; const n = Math.min(d.length, 262144); for (let i = 0; i < n; i++) { h ^= d[i]; h = Math.imul(h, 16777619); } return d.length + '-' + (h >>> 0).toString(16); }
  // «… por NOMBRE el martes, 27 de octubre de 2026, 12:32» → fecha de la descarga (el nombre no se guarda).
  function fechaDescarga(html) {
    const m = textoPlano(html).match(/\bel\s+[a-záéíóú]+,\s+(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4}),\s+(\d{1,2}):(\d{2})/i);
    if (!m || !MESES[norm(m[2])]) return 0;
    return Math.floor(Date.UTC(+m[3], MESES[norm(m[2])] - 1, +m[1], +m[4], +m[5]) / 1000) - LIMA;
  }
  async function leerZipContenido(file, todo, nombres, avance, op) {
    const fflate = raiz.fflate, dec = b => new TextDecoder('utf-8').decode(b);
    const raizZ = nombres.find(n => /^[^\/]+\/index\.html$/i.test(n)).split('/')[0] + '/';
    const MAX = REGLAS.maxPdfMB * 1048576, tamanos = {}, porNFC = {};
    avance(0.1, 'Abriendo el contenido del curso…');
    const r = fflate.unzipSync(todo, { filter: f => {
      tamanos[f.name] = f.originalSize; porNFC[f.name.normalize('NFC')] = f.name;
      if (!f.name.startsWith(raizZ)) return false;
      if (/\/index\.html$/i.test(f.name)) return f.name.split('/').length <= 3;
      return /\.(pdf|docx|pptx)$/i.test(f.name) && /\/content\//.test(f.name) && f.originalSize <= MAX;
    } });
    avance(0.5, 'Leyendo las semanas del aula…');
    const ix = dec(r[raizZ + 'index.html']);
    const corto = textoPlano((ix.match(/<p>\s*(CU-[^<]+)<\/p>/i) || [])[1] || '');
    const nombre = textoPlano((ix.match(/<h1>[\s\S]*?<\/h1>/i) || [''])[0]);
    const mc = (corto || nombre).match(/(\d{4})(\d)-([0-9A-Z]+)-G(\d+)-(\d+)/i);
    const copia = fechaDescarga((ix.match(/<footer[\s\S]*?<\/footer>/i) || [''])[0]) || Math.floor((file.lastModified || Date.now()) / 1000);
    // El inicio de clases no viene en el .zip: se toma del calendario académico del portal.
    const fi = String(op.inicio || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    const inicio = fi ? Date.UTC(+fi[1], +fi[2] - 1, +fi[3], 17) / 1000 : 0;
    const H = {
      versionReglas: VERSION_REGLAS, fuente: 'zip',
      archivo: { nombre: file.name, tamano: file.size },
      aula: { nombre, corto: corto.replace(/^CU-/i, '') || corto, idMoodle: (ix.match(/course\/view\.php\?id=(\d+)/) || [])[1] || '', inicio, fin: 0, copia,
        moodle: '«Descargar contenido del curso»', formato: '',
        periodo: mc ? mc[1] + '-' + mc[2] : '', codigoMoodle: mc ? mc[3] : '', grupo: mc ? String(+mc[4]) : '',
        subgrupo: mc ? mc[5] : '', tipo: mc ? (mc[5] === '0' ? 'teoría' : 'taller o práctica') : '' },
      conUsuarios: false, secciones: [], acts: [], pdfLeidos: [], avisos: [], noVinieron: []
    };
    H.inicioDia = inicio ? diaLima(inicio) : null;
    H.semanaActual = inicio ? Math.floor((diaLima(copia) - H.inicioDia) / 7) + 1 : null;
    const ex = { pdf: {}, office: {} };
    const fin = ix.search(/<\/main>/i), cuerpo = ix.slice(Math.max(0, ix.search(/<h3/i)), fin > 0 ? fin : undefined);
    cuerpo.split(/<hr\s*\/?>/i).forEach(tr => {
      if (!/<h3/i.test(tr)) return;
      const num = H.secciones.length;
      H.secciones.push({ id: String(num), num, nombre: textoPlano((tr.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) || [])[1]),
        resumen: htmlATexto((tr.match(/<\/h3>\s*<div>([\s\S]*?)<\/div>\s*(?:<ul|$)/i) || [])[1] || ''), visible: true });
      const rxLi = /<li>\s*<a href="\.\/([^"]+?)\/index\.html">([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = rxLi.exec(tr))) {
        const dir = entidades(m[1]), txt = textoPlano(m[2]), mt = txt.match(/^([\s\S]*)\(([^()]+)\)\s*$/);
        const tipoTxt = mt ? mt[2].trim() : dir.split('_')[0];
        const mod = TIPO_ZIP[norm(tipoTxt)] || norm(tipoTxt).replace(/[^a-z0-9]/g, '');
        let dirZ = raizZ + dir;
        if (!r[dirZ + '/index.html']) { try { dirZ = raizZ + decodeURIComponent(dir); } catch (e) { /* se queda */ } }
        const html = r[dirZ + '/index.html'] ? dec(r[dirZ + '/index.html']) : '';
        const desc = (html.match(/<h3>\s*Descripci[oó]n\s*<\/h3>\s*<div>([\s\S]*?)<\/div>\s*<hr/i) || [])[1] || '';
        const act = { id: (dir.match(/\.(\d+)$/) || [])[1] || dir, mod, titulo: (mt ? mt[1] : txt).trim(), seccion: num, agregado: 0, visible: true, archivos: [] };
        // Los archivos que la página dice que tiene; si no vinieron en el .zip, es porque pesan más de 50 MB.
        const hrefs = [];
        ((html.match(/<h3>\s*Archivos y subcarpetas\s*<\/h3>([\s\S]*?)<hr/i) || [])[1] || '').replace(/href="([^"]+)"/g, (x, h) => hrefs.push(h));
        const archivos = hrefs.filter(h => !/^(https?:|\.\.|#|mailto:)/i.test(h)).map(h => {
          let rel = entidades(h); try { rel = decodeURIComponent(rel); } catch (e) { /* se queda */ }
          const ruta = porNFC[(dirZ + '/' + rel).normalize('NFC')] || (dirZ + '/' + rel);
          const nom = rel.split('/').pop(), ext = ((nom.match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();
          const f = { nombre: nom, hash: 'z:' + (tamanos[ruta] || 0) + ':' + nom, tamano: tamanos[ruta] || 0, tipo: MIME[ext] || '', modificado: 0,
            componente: 'mod_' + mod, area: 'content', enZip: tamanos[ruta] != null };
          const d = r[ruta];
          if (d) { f.hash = huella(d);
            if (d[0] === 0x25 && d[1] === 0x50 && d[2] === 0x44 && d[3] === 0x46) ex.pdf[f.hash] = d;
            else if (d[0] === 0x50 && d[1] === 0x4b) ex.office[f.hash] = d; }
          if (!f.enZip) H.noVinieron.push('«' + nom + '» (' + act.titulo + ')');
          return f;
        });
        if (mod === 'assign') act.adjuntos = archivos; else act.archivos = archivos;
        const texto = htmlATexto(desc);
        if (mod === 'assign' || mod === 'label') act.texto = texto.slice(0, 600);
        if (mod === 'page' || mod === 'book') act.texto = texto.slice(0, 300);
        if (mod === 'label') {
          // En el .zip todas las etiquetas se llaman «Etiqueta»: el título sale de su texto o de sus imágenes.
          const imgs = []; desc.replace(/src="intro\/([^"]+)"/gi, (x, s) => { try { imgs.push(decodeURIComponent(s)); } catch (e) { imgs.push(s); } });
          const t = texto.split('\n')[0].slice(0, 100) || imgs.map(s => s.replace(/\.[a-z0-9]+$/i, '')).filter(s => !/^(image|imagen|img)[\s_-]*\d*$/i.test(s)).join(', ');
          if (t && /^etiqueta$/i.test(act.titulo)) act.titulo = t;
        }
        if (mod === 'forum') act.tipoForo = /^avisos$/i.test(act.titulo) ? 'news' : 'general';
        if (mod === 'url') {
          // NUNCA se guarda la URL completa: puede traer la clave de una reunión.
          const ext = (html.match(/https?:\/\/[^"'\s<>&]+/gi) || []).map(u => (u.match(/^[a-z]+:\/\/([^\/?#:]+)/i) || [])[1] || '')
            .filter(d => d && !/(^|\.)urp\.edu\.pe$/i.test(d) && !/w3\.org$/i.test(d));
          act.dominio = (ext[0] || '').toLowerCase();
        }
        H.acts.push(act);
      }
    });
    if (H.noVinieron.length) H.avisos.push('No vinieron en el .zip (Moodle no incluye archivos de más de 50 MB): ' + y(H.noVinieron.slice(0, 8)) + (H.noVinieron.length > 8 ? '…' : '') + '.');
    await leerTextos(H, ex, (f, t) => avance(0.5 + 0.5 * Math.max(0, (f - 0.7) / 0.3), t));
    avance(1, 'Listo');
    return H;
  }

  // Lo que se puede y no se puede revisar con el .zip (va en el reporte y en la guía).
  function notaZipHTML(H, corta) {
    const sinCal = H && H.fuente === 'zip' && H.inicioDia == null;
    return '<div class="mbz-zip"><div class="mbz-zip-t">📦 Segunda opción: archivo de «Descargar contenido del curso» (.zip)</div>' +
      (corta ? '' : '<p>Se revisó este archivo porque no se usó la copia de seguridad (.mbz). Sirve, pero <b>trae menos datos</b>: por eso algunos puntos los revisa usted.</p>') +
      '<div class="mbz-zip-cols"><div class="mbz-zip-si"><b>✔ Lo que SÍ se puede revisar</b><ul>' +
        '<li><b>01 Sílabo:</b> que esté publicado y que sea del semestre.</li>' +
        '<li><b>02 Mensaje de sensibilización:</b> que esté publicado.</li>' +
        '<li><b>05 Materiales:</b> que cada semana tenga su material y que corresponda al tema del sílabo.</li>' +
        '<li><b>07 Materiales adicionales:</b> lecturas, videos y enlaces de apoyo.</li>' +
        '<li><b>03 y 06:</b> la lista de planes de sesión, tareas y foros, para que usted los revise.</li></ul></div>' +
      '<div class="mbz-zip-no"><b>✘ Lo que NO se puede revisar con este archivo</b><ul>' +
        '<li><b>Las fechas:</b> cuándo se publicó cada cosa (si el material salió 7 días antes, si el sílabo estaba desde el inicio).</li>' +
        '<li><b>Lo oculto:</b> si algo está escondido para los estudiantes.</li>' +
        '<li><b>04 Rúbricas:</b> no trae las rúbricas de las tareas ni sus fechas. Este punto lo revisa usted en el aula.</li>' +
        '<li><b>08 Grabaciones:</b> se reconocen solo por el nombre, sin fechas.</li>' +
        '<li><b>Archivos de más de 50 MB:</b> Moodle no los pone en el .zip.</li></ul></div></div>' +
      (sinCal ? '<p class="mbz-zip-rec">⚠️ Falta el calendario académico del ciclo en el portal: no se sabe qué semanas ya debían tener material, así que se revisaron hasta la última semana que tiene material.</p>' : '') +
      '<p class="mbz-zip-rec">👉 Para la revisión completa, pida a su Escuela (o a OFICIC) el permiso de <b>«Reutilización de curso»</b> en el aula y use la copia de seguridad (.mbz).</p></div>';
  }

  // Texto de los PDF, Word y PowerPoint: primeras páginas (y el sílabo completo).
  async function leerTextos(H, ex, avance) {
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
  // 29/10/2026 (auditoría): en talleres y laboratorios también se publica el solucionario.
  const RX_SOL = /solucionario|soluci[oó]n(es)?\s+(del?|de\s+la|al)\b|resuelt[oa]s?\b|resoluci[oó]n\s+(del?|de\s+la)|clave\s+de\s+respuestas/i;
  const RX_RETRO = /retroalimentaci|resultados?\s+(de\s+)?(la\s+)?evaluaci|calificaciones\s+del|notas\s+del/i;
  function claseDeUrl(a) {
    if (esReunion(a.dominio)) return 'reunion';
    if (esChat(a.dominio)) return 'chat';
    if (esGrabacion(a)) return 'grabacion';
    if (RX_RETRO.test(a.titulo)) return 'retro';
    if (RX_RUB.test(a.titulo)) return 'rubrica';
    if (/presentaci[oó]n|diapositiva|\bppt\b|^\s*(clase|sesi[oó]n|tema|semana)\b/i.test(a.titulo) || /genially|canva\.com|prezi|slideshare|gamma\.app/.test(a.dominio || '')) return 'clase';
    return 'lectura';
  }
  const quitarPrefijo = t => String(t || '').replace(/^\s*(presentaci[oó]n( del?)?|clase|sesi[oó]n( de aprendizaje)?|tema)\s*(n[°º.o]*\s*\d+)?\s*[:\-–]?\s*/i, '').trim();
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
    // El título es el tramo inicial en MAYÚSCULAS («TAMAÑO DE PLANTA Definición…»);
    // también se toman otros títulos en mayúsculas que vengan después de un punto.
    const c = String(contenido || '').trim(), t = [];
    const tramo = txt => { const pal = txt.split(/\s+/), out = [];
      for (const w of pal) { if (/[a-záéíóúñü]/.test(w) || /^[●•▪]$/.test(w) || /^LOGRO/.test(w)) break; out.push(w); }
      const r = out.join(' ').replace(/[.:;,–-]+$/, '').trim();
      return r.replace(/[^A-ZÁÉÍÓÚÑÜ]/g, '').length >= 4 ? r : ''; };
    const ini = tramo(c);
    if (ini) ini.split(/\.\s+/).forEach(x => x.trim() && t.push(x.trim().replace(/\.$/, '')));
    c.split(/\.\s+/).slice(1).forEach(seg => { const r = tramo(seg); if (r && !t.some(x => x.indexOf(r) >= 0 || r.indexOf(x) >= 0)) t.push(r); });
    return t.length ? t : [c.split(/\.\s/)[0].slice(0, 120)];
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

  // ¿De qué evaluación habla un nombre? Tipo y número: «Taller N° 2», «primer informe», «PC1».
  const ORDINAL = { primer: 1, primero: 1, primera: 1, segundo: 2, segunda: 2, tercer: 3, tercero: 3, tercera: 3, cuarto: 4, cuarta: 4, quinto: 5, quinta: 5, sexto: 6, sexta: 6 };
  const GENERICAS = /^(taller|talleres|rubrica|rubricas|resultados?|evaluacion|retroalimentacion|entrega|trabajo|primer|primero|primera|segundo|segunda|tercer|tercera|tercero|cuarto|quinto|informe|tarea|semana|para|grupo|final|calificado|calificada|practica|presentacion|construccion|hasta|link|nota|notas|del|las|los|con)$/;
  function claveEval(t) {
    const n = norm(t).replace(/[_]/g, ' ');
    const tipo = /taller/.test(n) ? 'taller' : /practica calificada|\bpc ?\d/.test(n) ? 'practica' : /informe/.test(n) ? 'informe'
      : /laboratorio|\blab\b/.test(n) ? 'lab' : /examen|parcial\b/.test(n) ? 'examen' : /trabajo|proyecto|entrega/.test(n) ? 'trabajo' : /cuestionario|prueba/.test(n) ? 'prueba' : '';
    let num = null;
    const m = n.match(/(?:n\s*[°ºo.]+|nro\.?|numero|#|\bpc|\bt)\s*(\d{1,2})\b/) || n.match(/\b(?:taller|practica|informe|trabajo|laboratorio|lab)\s*(\d{1,2})\b/);
    if (m) num = +m[1]; else { const o = n.match(/\b(primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|quint[oa]|sext[oa])\b/); if (o) num = ORDINAL[o[1]]; }
    const pal = [...new Set(n.split(/[^a-z0-9ñ]+/).filter(w => w.length > 3 && !GENERICAS.test(w)))];
    return { tipo, num, pal };
  }
  function mismaEvaluacion(a, b) {
    const x = claveEval(a), z = claveEval(b);
    if (x.tipo && z.tipo && x.tipo !== z.tipo) return false;
    if (x.num != null && z.num != null) return x.num === z.num;
    return x.pal.filter(w => z.pal.includes(w)).length >= 2;
  }

  /* ---------------------------------------------- 04 · rúbricas */
  // Por cada evaluación del aula (tarea o aviso de evaluación): ¿tiene rúbrica?,
  // ¿se publicó al menos 2 días antes de abrir?, ¿está la retroalimentación a
  // más tardar 2 semanas después del cierre? (Guía Operativa Docente 4.4;
  // Auditoría 2025, NC 8.5.1.5). La rúbrica aplicada a cada estudiante no viene
  // en una copia sin usuarios: se revisa a mano.
  const RX_RUB = /r[uú]brica|instrumento de evaluaci|lista de cotejo|escala de valoraci|gu[ií]a de evaluaci/i;
  function regla04(H, recursos, cuadro, silabo, diaCopia) {
    const r = { punto: '04', mejorar: [], nota: [], evidencia: [], automatico: true };
    const nombreDe = x => x.titulo + ' ' + (x.archivos || []).map(f => f.nombre).join(' ');
    const tareas = H.acts.filter(a => a.mod === 'assign' && a.visible);
    // Avisos de evaluación sin tarea (p. ej. «Taller N° 3 …» como etiqueta): se revisan igual, desde que se anuncian.
    const avisos = [];
    H.acts.filter(a => a.mod === 'label' && a.visible && /taller|informe|pr[aá]ctica calificada|trabajo|entrega/i.test(a.titulo) && claveEval(a.titulo).tipo &&
        !/enlace|ingreso a (las )?clases|zoom|meet|teams|clases? virtual/i.test(a.titulo))
      .forEach(a => { if (!tareas.some(t => mismaEvaluacion(t.titulo, a.titulo)) && !avisos.some(v => mismaEvaluacion(v.titulo, a.titulo))) avisos.push(a); });
    const evals = tareas.concat(avisos);
    const cuest = H.acts.filter(a => a.mod === 'quiz' && a.visible);
    const rubRec = H.acts.filter(a => a.visible && (a.mod === 'resource' || a.mod === 'url' || a.mod === 'folder') && RX_RUB.test(nombreDe(a)));
    const retros = H.acts.filter(a => a.visible && (a.mod === 'url' || a.mod === 'resource') && RX_RETRO.test(a.titulo));
    const sols = H.acts.filter(a => a.visible && (a.mod === 'resource' || a.mod === 'url' || a.mod === 'folder' || a.mod === 'page') && RX_SOL.test(nombreDe(a)));
    const pideSol = a => ['taller', 'lab'].includes(claveEval(a.titulo).tipo);
    const usadas = new Set();
    evals.forEach(a => {
      const esAviso = a.mod === 'label';
      const abre = esAviso ? a.agregado : (a.abre || a.agregado), fuentes = [];
      if (a.rubricaDef && /rubric|guide/.test(a.metodo || a.rubricaDef.metodo))
        fuentes.push({ que: 'rúbrica configurada en la tarea', dia: diaLima(a.rubricaDef.creada || a.agregado) });
      (a.adjuntos || []).filter(f => RX_RUB.test(f.nombre)).forEach(f => fuentes.push({ que: 'archivo «' + f.nombre + '» adjunto a la tarea', dia: diaLima(a.agregado) }));
      const enSeccion = evals.filter(x => x.seccion === a.seccion).length === 1;
      rubRec.filter(x => mismaEvaluacion(a.titulo, nombreDe(x)) || (enSeccion && x.seccion === a.seccion && claveEval(nombreDe(x)).num == null))
        .forEach(x => { usadas.add(x); fuentes.push({ que: '«' + x.titulo + '» (' + (x.seccion ? 'semana ' + x.seccion : 'sección general') + ')', dia: diaLima(x.agregado) }); });
      const mejor = fuentes.sort((p, q) => p.dia - q.dia)[0];
      const retro = retros.filter(x => mismaEvaluacion(a.titulo, x.titulo)).sort((p, q) => p.agregado - q.agregado)[0];
      const cierre = esAviso ? null : (a.vence || null);
      a.rub = { fuentes, abre, antic: mejor ? diaLima(abre) - mejor.dia : null, mencion: !fuentes.length && RX_RUB.test(a.texto || '') };
      a.rub.ok = !!mejor && a.rub.antic >= 2;
      if (retro) a.rub.retro = { dia: diaLima(retro.agregado), despues: cierre ? diaLima(retro.agregado) - diaLima(cierre) : null };
      const venceHace = cierre ? diaCopia - diaLima(cierre) : null;
      a.rub.retroOk = retro ? (a.rub.retro.despues == null || a.rub.retro.despues <= REGLAS.diasRetro) : (venceHace == null || venceHace <= REGLAS.diasRetro);
      // Solucionario (talleres y laboratorios): en la tarea, o publicado aparte con el nombre de la evaluación.
      if (pideSol(a)) {
        const sol = (a.adjuntos || []).filter(f => RX_SOL.test(f.nombre)).map(f => ({ titulo: f.nombre, agregado: a.agregado }))
          .concat(sols.filter(x => mismaEvaluacion(a.titulo, nombreDe(x)) || (enSeccion && x.seccion === a.seccion && claveEval(nombreDe(x)).num == null)))
          .sort((p, q) => p.agregado - q.agregado)[0];
        a.rub.pideSol = true;
        if (sol) a.rub.sol = { titulo: sol.titulo, dia: diaLima(sol.agregado) };
        a.rub.solOk = !!sol || venceHace == null || venceHace <= REGLAS.diasRetro;
      } else a.rub.solOk = true;
      const cuandoRub = d => d > 0 ? d + (d === 1 ? ' día' : ' días') + ' antes de ' + (esAviso ? 'anunciarse' : 'abrir') : d === 0 ? 'el mismo día que ' + (esAviso ? 'se anunció' : 'abre') : Math.abs(d) + (d === -1 ? ' día' : ' días') + ' después de ' + (esAviso ? 'anunciarse' : 'abrir');
      r.evidencia.push('«' + a.titulo.replace(/\s*\(\.\.\.\s*$/, '…') + '» (' + (a.seccion ? 'semana ' + a.seccion : 'sección general') + (esAviso ? ', anunciada el ' + fecha(abre) : ', abre el ' + fecha(abre) + ', cierra ' + (cierre ? fecha(cierre) : 'sin fecha')) + '). ' +
        (mejor ? 'Rúbrica ' + mejor.que + ', publicada ' + cuandoRub(a.rub.antic) + (a.rub.ok ? ' ✔' : ' (debe ser al menos 2 días antes)') + '.'
          : a.rub.mencion ? 'La descripción menciona una rúbrica, pero no está publicada.' : 'Sin rúbrica publicada.') +
        (retro ? ' Retroalimentación: «' + retro.titulo + '», publicada el ' + fecha(retro.agregado) + (a.rub.retro.despues != null ? ', ' + a.rub.retro.despues + ' días después del cierre' + (a.rub.retroOk ? ' ✔' : ' (más de ' + REGLAS.diasRetro + ' días)') : '') + '.'
          : venceHace != null && venceHace > REGLAS.diasRetro ? ' Sin retroalimentación publicada (cerró hace ' + venceHace + ' días).' : '') +
        (a.rub.pideSol ? (a.rub.sol ? ' Solucionario: «' + a.rub.sol.titulo + '», publicado el ' + fechaDeDia(a.rub.sol.dia) + ' ✔.'
          : (a.rub.solOk ? ' Solucionario: aún no se exige (se espera dentro de los ' + REGLAS.diasRetro + ' días siguientes al cierre).' : ' Sin solucionario publicado.')) : ''));
      if (!esAviso && !a.vence) r.nota.push('«' + a.titulo + '» no tiene fecha de cierre.');
    });
    const sueltas = rubRec.filter(x => !usadas.has(x));
    if (sueltas.length) r.evidencia.push('Rúbricas publicadas que no se pudieron unir a una evaluación del aula: ' + y(sueltas.map(x => '«' + x.titulo + '» (' + fecha(x.agregado) + ')')) + '.');
    if (cuest.length) r.nota.push('Cuestionarios (' + y(cuest.map(a => '«' + a.titulo + '»')) + '): el instrumento es el propio cuestionario; revise a mano si corresponde una rúbrica.');
    const evalSil = ((silabo && silabo.semanas) || []).filter(x => /pr[aá]ctica calificada|examen|sustentaci|taller (calificado )?n|trabajo final|evaluaci[oó]n del logro/i.test(x.contenido) && cuadro.some(f => f.n === x.n && f.inicio + 6 < diaCopia));
    const sinTarea = evalSil.filter(x => !evals.some(a => a.seccion === x.n));
    if (sinTarea.length) r.nota.push('El sílabo programa evaluaciones ya tomadas sin tarea en el aula: ' + sinTarea.map(x => 'semana ' + x.n + ' («' + x.titulo.toLowerCase() + '»)').join('; ') +
      '. Si fueron presenciales, verifique su rúbrica o instrumento en el portafolio.');
    r.nota.push('La rúbrica aplicada a cada estudiante no viene en la copia (se descarga sin datos de estudiantes): verifíquela en el aula o en el portafolio. ' +
      'En la auditoría interna 2025 (NC 8.5.1.5) se observó que no había constancia de los motivos de la calificación.');
    if (sinTarea.length || avisos.length) r.nota.push('Las fechas se cuentan desde que se abre la entrega (o desde que se anuncia, si la evaluación no tiene tarea). Esta regla está por confirmar.');
    cuadro.forEach(f => { f.evalDet = evals.filter(a => a.seccion === f.n)
      .map(a => ({ titulo: a.titulo.replace(/\s*\(\.\.\.\s*$/, '…'), rub: a.rub ? (a.rub.ok ? 'ok' : (a.rub.fuentes.length ? 'tarde' : 'sin')) : '' }))
      .concat(cuest.filter(a => a.seccion === f.n).map(a => ({ titulo: a.titulo, rub: '' }))); });
    if (!evals.length) {
      r.sugerido = ''; r.certeza = 'baja'; r.automatico = false; r.para_docente = '';
      r.porque = 'Lo revisa usted: no hay tareas ni evaluaciones anunciadas en el aula.';
      r.evidencia.push('No hay tareas ni evaluaciones anunciadas en el aula para revisar sus rúbricas.');
      return r;
    }
    const ok = evals.filter(a => a.rub.ok && a.rub.retroOk && a.rub.solOk), con = evals.filter(a => a.rub.fuentes.length);
    r.sugerido = ok.length === evals.length ? 'Cumple' : (con.length ? 'Parcial' : 'No cumple');
    r.certeza = evals.some(a => a.rub.mencion) || avisos.length ? 'media' : 'alta';
    r.porque = con.length + ' de ' + plural(evals.length, 'evaluación tiene', 'evaluaciones tienen') + ' rúbrica; ' + evals.filter(a => a.rub.ok).length + ' se ' +
      (evals.filter(a => a.rub.ok).length === 1 ? 'publicó' : 'publicaron') + ' con 2 días de anticipación' +
      (evals.filter(a => !a.rub.retroOk).length ? '; falta retroalimentación en ' + evals.filter(a => !a.rub.retroOk).length : '') +
      (evals.filter(a => !a.rub.solOk).length ? '; falta solucionario en ' + evals.filter(a => !a.rub.solOk).length : '') + '.';
    const sin = evals.filter(a => !a.rub.fuentes.length), tarde = evals.filter(a => a.rub.fuentes.length && !a.rub.ok);
    const sinRetro = evals.filter(a => !a.rub.retroOk);
    const nom = a => '«' + a.titulo.replace(/\s*\(\.\.\.\s*$/, '').replace(/[:.]?\s*$/, '') + '»';
    if (sin.length) r.mejorar.push('Publicar la rúbrica de ' + y(sin.map(nom)) + ', en la misma tarea o como archivo con su nombre (p. ej. «Rúbrica Taller N° 5»).');
    if (tarde.length) r.mejorar.push('Publicar la rúbrica al menos 2 días antes de que se abra la entrega; esta vez llegó tarde en ' + y(tarde.map(nom)) + '.');
    if (sinRetro.length) r.mejorar.push('Publicar la retroalimentación y las notas a más tardar ' + REGLAS.diasRetro + ' días calendario después del cierre (' + y(sinRetro.map(nom)) + ').');
    const sinSol = evals.filter(a => !a.rub.solOk);
    if (sinSol.length) r.mejorar.push('Publicar en el aula el solucionario de ' + y(sinSol.map(nom)) + ', con su nombre (p. ej. «Solucionario Taller N° 2»).');
    r.nota.push('Plazo de la retroalimentación: ' + REGLAS.diasRetro + ' días calendario tras el cierre, según las Recomendaciones del Vicerrectorado Académico para la modalidad virtual (vigentes en 2026-II) (más exigente que las 2 semanas de la Guía Operativa Docente, 4.4).');
    if (evals.some(a => a.rub.pideSol)) r.nota.push('Solucionario y retroalimentación en talleres y laboratorios: lo observó el auditor en la auditoría del 29/10/2026. El portal reconoce el solucionario por su nombre («solucionario», «solución del…», «resuelto»); si el docente lo nombra de otra forma, confírmelo a mano.');
    r.para_docente = r.sugerido === 'Cumple'
      ? 'Gracias: cada evaluación tiene su rúbrica publicada con anticipación y su retroalimentación a tiempo' + (evals.some(a => a.rub.pideSol) ? ', y los talleres y laboratorios, su solucionario.' : '.')
      : 'Para el punto de rúbricas le pedimos:\n' + r.mejorar.map((t, i) => (i + 1) + '. ' + t).join('\n');
    return r;
  }

  // Con el .zip de «Descargar contenido del curso» no hay rúbricas configuradas ni fechas
  // de las tareas: el punto lo decide el coordinador; aquí solo se reúne lo que hay.
  function regla04Zip(H, cuadro) {
    const tareas = H.acts.filter(a => a.mod === 'assign'), cuest = H.acts.filter(a => a.mod === 'quiz');
    const nombreDe = x => x.titulo + ' ' + (x.archivos || []).concat(x.adjuntos || []).map(f => f.nombre).join(' ');
    const rub = H.acts.filter(a => (a.mod === 'resource' || a.mod === 'url' || a.mod === 'folder') && RX_RUB.test(nombreDe(a)));
    const conAdj = tareas.filter(a => (a.adjuntos || []).some(f => RX_RUB.test(f.nombre)));
    const sem = a => a.seccion ? 'semana ' + a.seccion : 'sección general';
    cuadro.forEach(f => { f.evalDet = tareas.concat(cuest).filter(a => a.seccion === f.n).map(a => ({ titulo: a.titulo, rub: '' })); });
    return { punto: '04', sugerido: '', certeza: 'pendiente', automatico: false, mejorar: [], para_docente: '',
      porque: 'Lo revisa usted: el archivo «Descargar contenido del curso» no trae las rúbricas configuradas en las tareas ni sus fechas.',
      evidencia: [
        tareas.length ? 'Tareas en el aula: ' + y(tareas.map(a => '«' + a.titulo + '» (' + sem(a) + ')')) + '.' : 'No hay tareas en el aula.',
        rub.length || conAdj.length ? 'Archivos o enlaces que dicen «rúbrica» en el nombre: ' + y(rub.map(a => '«' + a.titulo + '» (' + sem(a) + ')')
          .concat(conAdj.map(a => 'adjunto en la tarea «' + a.titulo + '»'))) + '.' : 'No se encontraron archivos ni enlaces con «rúbrica» en el nombre.'
      ].concat(cuest.length ? ['Cuestionarios: ' + y(cuest.map(a => '«' + a.titulo + '»')) + '.'] : []),
      nota: ['Qué revisar en el aula: que cada evaluación tenga su rúbrica, publicada al menos 2 días antes de que se abra la entrega, y que la retroalimentación esté a más tardar 7 días calendario después del cierre (VRA). ' +
        'Para que el portal lo revise solo, use la copia de seguridad (.mbz).'] };
  }

  /* ------------------------------- 08 · enlaces y grabaciones de clase */
  // Con el horario de la guía de matrícula se sabe cuántas clases virtuales
  // tiene el grupo y, por tanto, cuántas grabaciones debería haber.
  const DIAS = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
  const esVirtual = h => /virtual|remot|en l[ií]nea|online/i.test((h.aula || '') + ' ' + (h.modalidad || ''));
  const esGrabacion = a => a.visible && (/grabaci|grabad|recording|clase grabada|video de (la )?clase/i.test(a.titulo || '') ||
    (a.archivos || []).some(f => /^video\//.test(f.tipo || '')));
  function regla08(H, ctx, cuadro, inicioSemana, diaCopia) {
    const reun = H.acts.filter(a => a.visible && a.clase === 'reunion');
    const grab = H.acts.filter(esGrabacion);
    cuadro.forEach(f => { f.grabaciones = grab.filter(a => a.seccion === f.n).map(a => a.titulo); });
    const r = { punto: '08', mejorar: [], nota: [], evidencia: [] };
    const lista = (l, f) => l.length ? y(l.map(f)) : '';
    const Z = H.fuente === 'zip';
    r.evidencia.push(reun.length ? plural(reun.length, 'enlace de reunión', 'enlaces de reunión') + ': ' + lista(reun, a => (a.mod === 'url' ? nombreDominio(a.dominio) : 'aviso') + ' «' + a.titulo + '»' + (Z ? '' : ' (' + fecha(a.agregado) + ')')) + '.' : 'No hay enlaces de reunión.');
    if (Z) r.nota.push('Con el archivo «Descargar contenido del curso» las grabaciones se reconocen solo por el nombre: no trae fechas para comprobar que se publicaron después de cada clase.');
    r.evidencia.push(grab.length ? plural(grab.length, 'grabación', 'grabaciones') + ': ' + lista(grab, a => '«' + a.titulo + '» (' + (a.seccion ? 'semana ' + a.seccion : 'sección general') + ')') + '.' : 'No se encontraron grabaciones (enlaces o videos con «grabación» en el nombre).');
    const horario = Array.isArray(ctx.horario) ? ctx.horario : null;
    if (!horario) {
      r.sugerido = ''; r.certeza = 'pendiente'; r.automatico = false; r.para_docente = '';
      r.porque = 'Lo revisa usted por ahora: falta el horario del grupo, que carga el administrador. Se encontraron ' + plural(grab.length, 'grabación', 'grabaciones') + '.';
      r.nota.push('El portal todavía no tiene el horario de este grupo (lo carga la administración desde la guía de matrícula). Por ahora revise este punto a mano: si el curso es presencial, corresponde «No aplica».');
      return r;
    }
    r.automatico = true;
    const virt = horario.filter(esVirtual);
    if (virt.length && H.inicioDia == null) {
      r.sugerido = ''; r.certeza = 'pendiente'; r.automatico = false; r.para_docente = '';
      r.porque = 'Lo revisa usted: falta el calendario académico del ciclo para saber cuántas clases virtuales ya se dictaron. Se encontraron ' + plural(grab.length, 'grabación', 'grabaciones') + '.';
      return r;
    }
    const txtH = h => [h.tipo, h.dia, h.horario || [h.inicio, h.fin].filter(Boolean).join('–'), esVirtual(h) ? '(virtual)' : '(presencial, ' + (h.aula || '').replace(/\s*-\s*$/, '') + ')'].filter(Boolean).join(' ');
    if (!virt.length) {
      r.sugerido = 'No aplica'; r.certeza = 'alta'; r.para_docente = ''; r.porque = 'Según la guía de matrícula, todas las clases de este grupo son presenciales.';
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
    // VRA: la grabación se publica a más tardar 24 horas después de la clase.
    const diasVirtuales = n => virt.map(h => DIAS[norm(h.dia).slice(0, 9).replace(/[^a-z]/g, '')]).filter(d => d != null).map(d => inicioSemana(n) + ((d - dSemIni + 7) % 7));
    // Tarde: ninguna clase virtual de su semana fue el mismo día o el día anterior a su publicación.
    const grabTarde = Z ? [] : grab.filter(a => a.seccion && a.agregado).map(a => {
      const pub = diaLima(a.agregado), ds = diasVirtuales(a.seccion).filter(d => d <= pub);
      return { a, clase: ds.length ? Math.max(...ds) : null, pub };
    }).filter(x => x.clase != null && x.pub - x.clase > Math.ceil(REGLAS.horasGrabacion / 24));
    if (grabTarde.length) {
      r.evidencia.push('Publicadas después de 24 horas: ' + grabTarde.map(x => '«' + x.a.titulo + '» (semana ' + x.a.seccion + ', clase del ' + fechaDeDia(x.clase) + ', publicada el ' + fecha(x.a.agregado) + ')').join('; ') + '.');
      r.mejorar.push('Publicar la grabación de cada clase virtual a más tardar 24 horas después de la clase (esta vez llegó tarde en ' + plural(grabTarde.length, 'grabación', 'grabaciones') + ').');
    }
    r.porque = plural(grab.length, 'grabación', 'grabaciones') + ' para ' + plural(dictadas, 'clase virtual dictada', 'clases virtuales dictadas') + (faltan.length ? '; faltan las de las semanas ' + y(faltan.map(String)) : '') + '.';
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
    if (grabTarde.length && r.para_docente) r.para_docente += ' Le pedimos además publicar cada grabación a más tardar 24 horas después de la clase, como indica el Vicerrectorado Académico.';
    r.nota.push('Según las Recomendaciones del Vicerrectorado Académico para la modalidad virtual (vigentes en 2026-II): se graban todas las sesiones, el enlace se publica en el aula en 24 horas como máximo y Zoom o Meet se usan solo con el correo institucional. ' +
      'El plazo de 24 horas se mide con la fecha en que se agregó la grabación al aula y el día de la clase (de la guía de matrícula): cuenta la clase más cercana anterior a la publicación.');
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
    // Z: el .zip de «Descargar contenido del curso» (sin fechas, sin ocultos, sin rúbricas).
    const Z = H.fuente === 'zip';
    const inicioSemana = n => ini == null ? null : ini + 7 * (n - 1);
    const recursos = H.acts.filter(a => a.mod === 'resource' || a.mod === 'folder' || a.mod === 'page' || a.mod === 'book');
    recursos.forEach(a => a.clase = claseDeRecurso(a));
    H.acts.filter(a => a.mod === 'url').forEach(a => a.clase = claseDeUrl(a));
    H.acts.filter(a => a.mod === 'label').forEach(a => { if (/enlace.{0,40}clase|ingreso a (las )?clases|zoom|google meet|teams/i.test(a.titulo + ' ' + (a.texto || ''))) a.clase = 'reunion'; });
    const presentaciones = H.acts.filter(a => a.mod === 'url' && a.clase === 'clase');
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
      const dif = Z ? null : ini - diaLima(a.agregado);
      r.evidencia.push('«' + (f.nombre || a.titulo) + '» en ' + enSemana(a) + (Z ? '.' : ', publicado el ' + fecha(a.agregado) +
        (dif >= 0 ? ' (antes del inicio de clases).' : ' (' + plural(-dif, 'día', 'días') + ' después del inicio de clases, el ' + fechaDeDia(ini) + ').')));
      if (Z) r.nota.push('Con el archivo «Descargar contenido del curso» no se puede saber en qué fecha se publicó el sílabo ni si está oculto para los estudiantes: confírmelo en el aula.');
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
      if (Z && r.certeza === 'alta') r.certeza = 'media';
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
      r.evidencia.push('«' + (f.nombre || a.titulo) + '» en ' + enSemana(a) + (Z ? '.' : ', publicado el ' + fecha(a.agregado) + '.'));
      if (Z) r.nota.push('Con el archivo «Descargar contenido del curso» no se puede saber si el mensaje está oculto para los estudiantes.');
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
      const enlaces = H.acts.filter(a => a.mod === 'url' && a.visible && a.clase === 'lectura');
      const lecturas = visibles.filter(a => a.clase === 'lectura' || a.mod === 'folder' || a.mod === 'book');
      const excluidos = H.acts.filter(a => a.mod === 'url' && (a.clase === 'reunion' || a.clase === 'chat'));
      const otros = H.acts.filter(a => a.mod === 'url' && ['grabacion', 'retro', 'clase', 'rubrica'].includes(a.clase));
      if (otros.length) r.nota.push('Tampoco se cuentan ' + plural(otros.length, 'enlace', 'enlaces') + ' que son material de clase, grabaciones, rúbricas o resultados de evaluaciones (van en los puntos 05, 08 y 04).');
      enlaces.forEach(a => r.evidencia.push(nombreDominio(a.dominio) + ': «' + a.titulo + '» (' + enSemana(a) + (Z ? '' : ', ' + fecha(a.agregado)) + ').'));
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
      const conNum = s => norm(s).replace(/\((\d{1,2})\)/g, ' n$1 ');
      const palabras = s => [...new Set(conNum(s).split(/[^a-z0-9]+/).filter(w => (w.length > 4 || /^n\d+$/.test(w)) && !STOP.has(w)))];
      const kw = {}; semSil.forEach(s => kw[s.n] = palabras(s.rango ? s.contenido : s.titulo));
      const conTema = s => s && !s.sinMaterial && !/pr[aá]ctica calificada|sustentaci[oó]n/i.test(s.titulo || '');
      const df = {}; Object.values(kw).forEach(l => l.forEach(w => df[w] = (df[w] || 0) + 1));
      const nS = Math.max(1, semSil.length);
      // Las palabras que se repiten en muchos temas («distribución», «planta») no distinguen semanas.
      Object.keys(kw).forEach(n => kw[n] = kw[n].filter(w => df[w] <= Math.max(1, Math.floor(nS / 4))));
      const peso = w => Math.log(1 + nS / (df[w] || 1));
      const parecido = (n, texto) => { const l = kw[n] || []; if (!l.length) return 0; const t = ' ' + conNum(texto) + ' ';
        // «Estudio de mercado (2)» no es «(1)»: el número del tema tiene que estar.
        if (l.some(w => /^n\d+$/.test(w) && !new RegExp('\\b' + w + '\\b').test(t))) return 0;
        let a = 0, b = 0; l.forEach(w => { b += peso(w); if (new RegExp('\\b' + w + '\\b').test(t)) a += peso(w); }); return a / b; };

      const hashSemana = {};
      // Primera clase de la semana según el horario del grupo (48 horas antes de ella, VRA).
      // Sin horario, se cuenta desde el primer día de la semana.
      let desfase = 0, conHorario = false;
      if (ini != null && Array.isArray(ctx.horario) && ctx.horario.length) {
        const dIni = new Date(ini * DIA * 1000).getUTCDay();
        const ds = ctx.horario.map(h => DIAS[norm(h.dia).slice(0, 9).replace(/[^a-z]/g, '')]).filter(d => d != null).map(d => (d - dIni + 7) % 7);
        if (ds.length) { desfase = Math.min(...ds); conHorario = true; }
      }
      const inicioClase = n => inicioSemana(n) + desfase;
      // Sin calendario (solo pasa con el .zip): se revisa hasta la última semana que tiene material.
      const ultimaConMat = Math.max(0, ...recursos.filter(a => a.visible && ['clase', 'lectura', 'sesion'].includes(a.clase)).concat(presentaciones).map(a => a.seccion));
      for (let n = 1; n <= totalSem; n++) {
        const s = semSil.find(x => x.n === n) || {};
        const mats = recursos.filter(a => a.seccion === n && ['clase', 'lectura', 'sesion'].includes(a.clase)).concat(presentaciones.filter(a => a.seccion === n));
        const evals = H.acts.filter(a => a.seccion === n && (a.mod === 'assign' || a.mod === 'quiz' || (a.archivos.length && (a.clase === 'evaluacion' || a.clase === 'rubrica'))));
        const reun = H.acts.filter(a => a.seccion === n && a.clase === 'reunion');
        const limite = ini == null ? null : n === 1 && REGLAS.semana1DesdeInicio ? ini : inicioClase(n) - REGLAS.diasMaterial;
        const fila = { n, inicio: inicioSemana(n), tema: s.tituloVer || s.titulo || '', unidad: s.unidad || '', sinMaterial: !!s.sinMaterial,
          limite, materiales: [], evaluaciones: evals.map(a => a.titulo), reuniones: reun.map(a => nombreDominio(a.dominio) + ' «' + a.titulo + '»'),
          problemas: [], estado: '' };
        fila.corresponde = ini == null ? n <= ultimaConMat : limite <= diaCopia;
        fila.enCurso = n === H.semanaActual;
        mats.forEach(a => {
          const dias = inicioSemana(n) - diaLima(a.agregado);
          const m = { titulo: a.titulo, archivos: a.archivos.map(f => f.nombre), agregado: a.agregado, dias: Z ? null : dias, visible: a.visible,
            aTiempo: Z ? true : diaLima(a.agregado) <= limite, sesion: null, repetidoDe: null, pareceSemana: null };
          a.archivos.forEach(f => {
            if (f.sesionEnPdf != null && m.sesion == null) m.sesion = f.sesionEnPdf;
            const prev = hashSemana[f.hash];
            if (prev && prev.n !== n) { m.repetidoDe = prev.n; m.original = prev.m; }
            else if (!prev) hashSemana[f.hash] = { n, m };
            if (f.modificado && diaLima(f.modificado) > diaLima(a.agregado) + 1) m.reemplazado = f.modificado;
          });
          // Se compara con el título del tema: nombre del archivo y el título de su primera diapositiva.
          const texto = m.texto = a.titulo + ' ' + a.archivos.map(f => f.nombre + ' ' + (f.tituloDeclarado || '')).join(' ');
          // En enlaces (Genially, Canva…) y en planes de sesión, el título es el nombre que puso el docente.
          const porNombre = a.mod === 'url' || a.clase === 'sesion';
          const ft = porNombre ? { tituloDeclarado: quitarPrefijo(a.titulo) } : a.archivos.find(f => f.tituloDeclarado != null);
          m.tituloPpt = ft ? ft.tituloDeclarado : '';
          m.enlace = a.mod === 'url' ? nombreDominio(a.dominio) : '';
          // Solo si la semana del sílabo tiene un título claro (en MAYÚSCULAS al inicio).
          if (s.temas && conTema(s) && !m.repetidoDe && s.tituloVer === s.titulo) m.cmp = ft ? compararTitulo(m.tituloPpt, s.temasCmp || s.temas) : { estado: 'sin-texto' };
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
        else if (!vis.length) { fila.estado = 'falta'; if (fila.materiales.length) fila.problemas.push('el material está oculto'); }
        else {
          if (Z) fila.aTiempo = true;
          else { const primero = Math.min(...vis.map(m => diaLima(m.agregado)));
            fila.publicado = primero; fila.anticipacion = inicioClase(n) - primero;
            fila.aTiempo = primero <= limite; }
          if (!fila.aTiempo) fila.problemas.push(n === 1 && REGLAS.semana1DesdeInicio ? 'publicado después del inicio del curso' : 'publicado con menos de 48 horas de anticipación a la clase');
          vis.filter(m => m.repetidoDe).forEach(m => fila.problemas.push('«' + m.titulo + '» es el mismo archivo de la semana ' + m.repetidoDe));
          const sesOk = vis.some(m => m.sesion === n);
          vis.forEach(m => { if (m.sesion != null && m.sesion !== n && !m.repetidoDe && !sesOk) { m.sesionMal = true; fila.problemas.push('el archivo «' + m.titulo + '» dice «Sesión ' + m.sesion + '»'); } });
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
      cuadro.forEach(f => { if (!(f.temaSinMaterial || (f.estado === 'falta' && f.corresponde)) || !(kw[f.n] || []).length) return;
        const otra = cuadro.find(g => g.n !== f.n && g.materiales.some(m => m.visible && !m.repetidoDe && parecido(f.n, m.texto) >= 0.75));
        if (otra) f.temaEn = otra.n; });
      const evaluables = cuadro.filter(f => f.corresponde && !f.sinMaterial);
      const ok = evaluables.filter(f => f.estado === 'ok');
      const conMat = evaluables.filter(f => f.estado !== 'falta');
      const tarde = evaluables.filter(f => f.publicado != null && !f.aTiempo);
      const faltan = evaluables.filter(f => f.estado === 'falta');
      const rep = []; cuadro.forEach(f => f.materiales.forEach(m => { if (m.repetidoDe) rep.push([m.repetidoDe, f.n]); }));
      const sesionMal = []; cuadro.forEach(f => f.materiales.forEach(m => { if (m.sesionMal) sesionMal.push([f.n, m.sesion]); }));
      const sinTema = cuadro.filter(f => f.temaSinMaterial && f.corresponde && !f.sinMaterial);

      if (!evaluables.length) { r.sugerido = ''; r.certeza = 'baja'; r.evidencia.push('A la fecha de la copia todavía no corresponde publicar material de ninguna semana.'); r.para_docente = ''; return; }
      r.sugerido = ok.length === evaluables.length ? 'Cumple' : (conMat.length ? 'Parcial' : 'No cumple');
      { const otrasS = evaluables.filter(f => f.estado !== 'ok' && f.estado !== 'falta' && (f.temaSinMaterial || f.sinPropio || (f.conTitulo && !f.tituloOk) || f.problemas.some(p => /mismo archivo|Sesión/.test(p)))).length;
        r.porque = 'Cumplen ' + ok.length + ' de ' + plural(evaluables.length, 'semana', 'semanas') + ': ' +
          [faltan.length && plural(faltan.length, 'semana sin material', 'semanas sin material'), tarde.length && plural(tarde.length, 'publicada tarde', 'publicadas tarde'),
           otrasS && plural(otrasS, 'con material repetido, de otra semana o con título distinto al sílabo', 'con material repetido, de otra semana o con título distinto al sílabo')].filter(Boolean).join(', ') + '.'; }
      r.certeza = sinTema.length || sesionMal.length || Z ? 'media' : 'alta';
      r.evidencia.push('Se revisan ' + plural(evaluables.length, 'semana', 'semanas') + (ini == null ? ' (hasta la última semana que tiene material: falta el calendario académico para saber cuáles ya correspondían' : ' (las que a la fecha de la copia ya debían tener material') +
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
      // 28/10/2026 (auditoría interna): el auditor cruza, semana por semana, el tema del sílabo
      // con lo publicado en el aula. Se muestra esa comparación siempre, también cuando coincide,
      // para que el coordinador vea qué se comparó. No cambia el resultado sugerido: lo que no
      // se reconoce queda como «revisar a mano».
      const corr = [], revisarTema = [], verd = {};
      evaluables.forEach(f => {
        const vis = f.materiales.filter(m => m.visible);
        if (!vis.length || !f.tema) return;
        const s = semSil.find(x => x.n === f.n) || {};
        const igual = vis.find(m => m.cmp && m.cmp.estado === 'igual');
        const propio = vis.reduce((a, m) => Math.max(a, m.propio || 0), 0);
        const otra = vis.find(m => m.pareceSemana);
        const pare = vis.find(m => m.cmp && (m.cmp.estado === 'parecido' || m.cmp.estado === 'incompleto'));
        const ref = igual || pare || vis.find(m => m.tituloPpt) || vis[0];
        const enAula = '«' + (ref.tituloPpt || ref.titulo) + '»' + (vis.length > 1 ? ' y ' + plural(vis.length - 1, 'archivo más', 'archivos más') : '');
        let veredicto;
        if (igual) veredicto = '✔ el título es el del sílabo';
        else if (otra) { veredicto = '✖ parece el tema de la semana ' + otra.pareceSemana; revisarTema.push(f.n); }
        else if (propio >= 0.6) veredicto = '✔ el contenido corresponde al tema' + (pare ? ' (el título es parecido, no igual)' : '');
        else if (pare) { veredicto = '◐ título parecido, pero no igual al del sílabo'; revisarTema.push(f.n); }
        else if (!conTema(s) || !(kw[f.n] || []).length) veredicto = '? no se pudo comparar solo (el tema del sílabo es muy general): revíselo a mano';
        else { veredicto = '? no se reconoce el tema del sílabo en el material: revíselo a mano'; revisarTema.push(f.n); }
        verd[f.n] = { veredicto, ref, igual, pare, otra };
        const temaCorto = f.tema.length > 170 ? f.tema.slice(0, 170).replace(/\s+\S*$/, '') + '…' : f.tema;
        corr.push('Semana ' + f.n + ': sílabo' + (s.rango ? ' (semanas ' + s.rango + ')' : '') + ' «' + temaCorto + '» · aula ' + enAula + ' → ' + veredicto + '.');
      });
      if (corr.length) {
        const nOk = Object.values(verd).filter(v => /^✔/.test(v.veredicto)).length;
        r.evidencia.push('Correspondencia con el sílabo: en ' + nOk + ' de ' + plural(corr.length, 'semana con material', 'semanas con material') +
          ' lo publicado corresponde al tema del sílabo. El detalle, semana por semana, está en la tabla comparativa de abajo.');
      } else if (evaluables.length) r.evidencia.push('Correspondencia con el sílabo: no hay semanas con material publicado para comparar con los temas del sílabo.');
      if (revisarTema.length) {
        r.certeza = 'media';
        r.mejorar.push('Revisar que el material de ' + (revisarTema.length > 1 ? 'las semanas ' : 'la semana ') + y(revisarTema.map(String)) +
          ' trate el tema que indica el sílabo para esa semana, y que el título de la presentación sea el mismo del sílabo.');
      }
      // 28/10/2026: tabla comparativa por semana (aula | sílabo | hallazgo | recomendación).
      // Cada material se cruza con TODOS los temas del sílabo: si es de esta semana (o de su
      // bloque) se marca ✔; si es tema de otra semana, se dice de cuál; si no es ningún tema,
      // queda como material de apoyo. Y cada tema del sílabo se marca ✔ (está publicado) o ✖ (falta).
      const VAC = new Set('para como entre sobre desde segun mediante sesion sesiones aprendizaje clase clases semana tema temas unidad parte ppt pdf archivo material lectura video del las los una uno con por que sus este esta'.split(' '));
      const raizP = w => w.replace(/(es|s)$/, '').replace(/[ao]$/, '');
      const pals = t => [...new Set(norm(t).replace(/\(\s*\d+\s*\)/g, ' ').split(/[^a-z0-9ñ]+/).filter(w => w.length > 3 && !/^\d+$/.test(w)).map(raizP).filter(w => w.length > 2 && !VAC.has(w)))];
      const bloques = [];   // { semanas:[n…], etiqueta, temas:[{t, cab, cuerpo, en:[]}] , unidad }
      semSil.filter(x => conTema(x)).forEach(x => {
        const clave = x.rango || String(x.n);
        if (bloques.some(b => b.clave === clave)) return;
        const lista = (x.temas && x.temas.length && x.temas[0] ? x.temas : [x.titulo || x.contenido]).filter(Boolean);
        bloques.push({ clave, semanas: x.rango ? x.rango.split('-').map(Number) : [x.n], etiqueta: x.rango ? 'las semanas ' + x.rango : 'la semana ' + x.n,
          unidad: String(x.unidad || '').replace(/^[IVX\d]+\s*:\s*/, ''),
          temas: lista.map(t => ({ t, cab: pals(t.split(':')[0].replace(/\([^)]*\)/g, '')), cuerpo: pals(t), en: [] })) });
      });
      const todosT = [].concat(...bloques.map(b => b.temas));
      const dfT = {}; todosT.forEach(tm => tm.cuerpo.forEach(w => dfT[w] = (dfT[w] || 0) + 1));
      const pw = w => Math.log(1 + todosT.length / (dfT[w] || 0.5));
      const puntaje = (m, tm) => {
        const mp = pals(quitarPrefijo(m.titulo) + ' ' + (m.tituloPpt || '')); if (!mp.length || !tm.cuerpo.length) return 0;
        const enM = new Set(mp);
        const cab = tm.cab.length ? tm.cab : tm.cuerpo;
        const cubreCab = cab.reduce((a, w) => a + (enM.has(w) ? pw(w) : 0), 0) / cab.reduce((a, w) => a + pw(w), 0);
        const cuerpo = new Set(tm.cuerpo), cab2 = new Set(cab);
        const sig = mp.filter(w => (dfT[w] || 0) < todosT.length * 0.5);   // palabras del material que distinguen
        // Peso por rareza: «problema» pesa más que «investigación», que está en muchos temas.
        const tot = sig.reduce((a, w) => a + pw(w), 0);
        const cubreMat = tot ? sig.reduce((a, w) => a + pw(w) * (cab2.has(w) ? 1 : cuerpo.has(w) ? 0.6 : 0), 0) / tot : 0;
        // Una palabra que solo aparece en este tema del sílabo («hipótesis») basta si el título es corto.
        const unica = sig.length <= 3 && sig.some(w => w.length >= 7 && dfT[w] === 1 && cuerpo.has(w));
        // Si el material trae una palabra poco común del sílabo que este tema no tiene («teórico» frente a
        // «Marco histórico»), no es este tema aunque comparta otra palabra.
        const contradice = sig.some(w => !cuerpo.has(w) && (dfT[w] || 0) >= 1 && dfT[w] <= 3);
        return Math.max(cubreCab >= 0.6 ? cubreCab : 0, cubreMat >= 0.6 && !contradice ? cubreMat : 0, unica ? 0.5 : 0);
      };
      const ubicar = m => { let mejor = null, pm = 0;
        bloques.forEach(b => b.temas.forEach(tm => { const v = puntaje(m, tm); if (v > pm + 0.001) { pm = v; mejor = { b, tm }; } }));
        return pm >= 0.45 ? mejor : null; };
      // Todos los materiales visibles de las semanas que ya corresponden: dónde están y qué tema son.
      const ubic = new Map();
      cuadro.filter(f => f.corresponde || f.materiales.length).forEach(f => f.materiales.filter(m => m.visible).forEach(m => {
        const u = ubicar(m); ubic.set(m, u); if (u) u.tm.en.push(f.n); }));
      const bloqueDe = n => bloques.find(b => b.semanas.includes(n));
      const yaPaso = b => b.semanas.every(k => { const fk = cuadro.find(g => g.n === k); return fk && fk.corresponde; });
      const conProblemaTema = new Set();
      r.tabla = evaluables.map(f => {
        const s = semSil.find(x => x.n === f.n) || {}, b = bloqueDe(f.n);
        const vis = f.materiales.filter(m => m.visible), ocultos = f.materiales.filter(m => !m.visible);
        const hall = [], rec = [], fuera = [];
        const nombreM = m => (m.tituloPpt && norm(m.tituloPpt) !== norm(m.titulo) ? m.titulo + ' — título: «' + m.tituloPpt + '»' : m.titulo) + (Z ? '' : ' (publicado el ' + fecha(m.agregado) + ')');
        const aula = vis.map(m => {
          const u = ubic.get(m);
          if (u && b && u.b === b) return { t: nombreM(m), marca: 'ok', nota: 'Coincide con «' + u.tm.t.split(':')[0] + '»' };
          if (u) { fuera.push({ m, u }); return { t: nombreM(m), marca: 'otra', nota: 'Es tema de ' + u.b.etiqueta + ': «' + u.tm.t.split(':')[0] + '»' }; }
          if (b && b.unidad && pals(b.unidad).length && pals(b.unidad).every(w => pals(m.titulo + ' ' + (m.tituloPpt || '')).includes(w)))
            return { t: nombreM(m), marca: 'apoyo', nota: 'Es el nombre de la unidad («' + b.unidad.toLowerCase() + '»), no un tema de la semana' };
          return { t: nombreM(m), marca: 'apoyo', nota: 'No coincide con ningún tema del sílabo (¿material de apoyo?)' };
        }).concat(ocultos.map(m => ({ t: m.titulo, marca: 'oculto', nota: 'Oculto: los estudiantes no lo ven' })));
        const silabo = [];
        if (b) {
          if (b.semanas.length > 1) silabo.push({ t: 'Bloque de las semanas ' + b.clave + ':', marca: 'cab' });
          b.temas.forEach(tm => {
            const enBloque = tm.en.filter(k => b.semanas.includes(k)), afuera = tm.en.filter(k => !b.semanas.includes(k));
            if (enBloque.length) silabo.push({ t: tm.t, marca: 'ok', nota: b.semanas.length > 1 ? 'Publicado en la semana ' + y([...new Set(enBloque)].map(String)) : 'Publicado' });
            else if (afuera.length) silabo.push({ t: tm.t, marca: 'otra', nota: 'Está publicado en la semana ' + y([...new Set(afuera)].map(String)) + ', no en ' + b.etiqueta });
            else silabo.push({ t: tm.t, marca: 'falta', nota: b.semanas.length > 1 && !yaPaso(b) ? 'Aún no publicado (el bloque sigue en curso)' : 'Falta: no está publicado' });
          });
        } else silabo.push({ t: f.tema || '(no se pudo leer el tema de esta semana en el sílabo)', marca: 'cab' });
        const faltanT = b ? b.temas.filter(tm => !tm.en.some(k => b.semanas.includes(k))) : [];
        const ultimaDelBloque = b && f.n === Math.max(...b.semanas.filter(k => evaluables.some(g => g.n === k)));
        if (f.estado === 'falta') {
          hall.push(ocultos.length ? '✖ El material está oculto' : '✖ Sin material');
          rec.push(ocultos.length ? 'Hacer visible el material de esta semana.' : b && b.semanas.length > 1
            ? 'Subir el material de esta semana con los temas del bloque ' + b.clave + ' que le corresponden' + (faltanT.length ? '; aún faltan: «' + faltanT.map(tm => tm.t.split(':')[0]).join('», «') + '»' : '') + '.'
            : 'Subir el material de esta semana' + (faltanT.length ? ': «' + faltanT.map(tm => tm.t.split(':')[0]).join('», «') + '»' : '') + '.');
        } else {
          const okM = aula.filter(x => x.marca === 'ok').length;
          // Dos conteos distintos, cada uno con su columna: lo publicado (izquierda) y los temas del sílabo (derecha).
          hall.push((okM === vis.length ? '✔ ' : okM ? '◐ ' : '✖ ') + 'Aula: ' + okM + ' de ' + plural(vis.length, 'material publicado es', 'materiales publicados son') +
            ' de ' + (b && b.semanas.length > 1 ? 'este bloque' : 'esta semana'));
          if (b) { const pub = b.temas.length - faltanT.length;
            hall.push((pub === b.temas.length ? '✔ ' : pub ? '◐ ' : '✖ ') + 'Sílabo: ' + pub + ' de ' + plural(b.temas.length, 'tema publicado', 'temas publicados') +
              (b.semanas.length > 1 ? ' en el bloque ' + b.clave : '')); }
          fuera.forEach(x => { hall.push('◐ «' + (x.m.tituloPpt || x.m.titulo) + '» es tema de ' + x.u.b.etiqueta);
            rec.push('Mover «' + (x.m.tituloPpt || x.m.titulo) + '» a ' + x.u.b.etiqueta + ', donde lo pone el sílabo.'); });
          if (fuera.length) conProblemaTema.add(f.n);
          if (faltanT.length) {
            const enCurso = b.semanas.length > 1 && !yaPaso(b);
            rec.push((b.semanas.length > 1 ? 'Del bloque ' + b.clave + (enCurso ? ' (aún en curso)' : '') + ' falta publicar: «' : 'Subir el material de: «') +
              faltanT.map(tm => tm.t.split(':')[0] + (tm.en.length ? '» (hoy está en la semana ' + y([...new Set(tm.en)].map(String)) + ')' : '»')).join(', «').replace(/»$/, '') + (faltanT[faltanT.length - 1].en.length ? '.' : '».'));
            if (b.semanas.length === 1 || (ultimaDelBloque && yaPaso(b))) conProblemaTema.add(f.n);
          }
          const v = verd[f.n] || {};
          if (v.pare && !v.igual) rec.push('Poner como título de la presentación el tema exacto del sílabo: «' + v.pare.cmp.tema + '» (hoy dice «' + (v.pare.tituloPpt || v.pare.titulo) + '»).');
          if (!Z && f.publicado != null && !f.aTiempo) { hall.push('◐ Publicado tarde (' + diasTxt(f.anticipacion) + ' de su inicio)');
            rec.push('Publicar el material al menos 48 horas antes de la primera clase de la semana.'); }
          else if (!Z && f.publicado != null) hall.push('✔ Publicado a tiempo');
          f.problemas.filter(t => /mismo archivo|Sesión/.test(t)).forEach(t => hall.push('◐ ' + t.charAt(0).toUpperCase() + t.slice(1)));
        }
        return { n: f.n, aula, silabo, hallazgo: hall, recomendacion: rec.length ? rec : ['Ninguna: está conforme.'], ok: !rec.length };
      });
      if (conProblemaTema.size) {
        const l = [...conProblemaTema].sort((a, b) => a - b);
        r.evidencia.push('Temas fuera de su semana o que faltan publicar: semana' + (l.length > 1 ? 's ' : ' ') + y(l.map(String)) + ' (ver la tabla comparativa).');
        if (r.sugerido === 'Cumple') r.sugerido = 'Parcial';
        r.porque = (r.porque || '').replace(/\.$/, '') + '; ' + plural(l.length, 'semana con temas fuera de lugar o faltantes', 'semanas con temas fuera de lugar o faltantes') + '.';
        r.certeza = 'media';
        r.mejorar.push('Ordenar el material según el sílabo: cada tema debe estar publicado en la semana que el sílabo indica (semana' + (l.length > 1 ? 's ' : ' ') + y(l.map(String)) + ').');
      }
      // El auditor también corrobora que estén todas las sesiones antes del examen parcial.
      const semParcial = semSil.find(x => x.sinMaterial && /parcial/i.test(x.titulo || ''));
      if (semParcial) {
        const antes = evaluables.filter(f => f.n < semParcial.n), faltanAntes = antes.filter(f => f.estado === 'falta');
        if (antes.length) r.evidencia.push('Antes del examen parcial (semana ' + semParcial.n + '): ' + (faltanAntes.length
          ? 'faltan las sesiones de ' + (faltanAntes.length > 1 ? 'las semanas ' : 'la semana ') + y(faltanAntes.map(f => String(f.n))) + ' de ' + plural(antes.length, 'semana', 'semanas') + '.'
          : 'están las sesiones de las ' + plural(antes.length, 'semana', 'semanas') + '.'));
      }
      faltan.filter(f => f.temaEn).forEach(f => r.evidencia.push('El material del tema de la semana ' + f.n + ' («' + f.tema.toLowerCase() + '») está publicado en la semana ' + f.temaEn + '.'));
      // Títulos: lo que observó el auditor en 2025 (NC 8.5.2).
      const conT = evaluables.filter(f => f.conTitulo), titMal = conT.filter(f => !f.tituloOk);
      const sinLeer = evaluables.filter(f => !f.conTitulo && f.materiales.some(m => m.cmp && (m.cmp.estado === 'sin-titulo' || m.cmp.estado === 'sin-texto')));
      if (conT.length) r.evidencia.push('Títulos de las presentaciones: en ' + (conT.length - titMal.length) + ' de ' + plural(conT.length, 'semana', 'semanas') +
        ' el título es el mismo del tema del sílabo.');
      if (!r.tabla) titMal.forEach(f => { const m = f.materiales.find(x => x.cmp && x.cmp.tema && x.cmp.estado !== 'sin-texto');
        if (m) r.evidencia.push('Semana ' + f.n + ': el sílabo dice «' + m.cmp.tema + '»; la presentación dice «' + m.tituloPpt + '».'); });
      if (sinLeer.length) r.certeza = 'media';
      if (sinLeer.length) r.nota.push('No se pudo leer el título de la presentación en la semana' + (sinLeer.length > 1 ? 's ' : ' ') + y(sinLeer.map(f => String(f.n))) + ' (¿es una imagen escaneada?): revíselo a mano.');
      const proximas = cuadro.filter(f => !f.corresponde && !f.sinMaterial).slice(0, 1);
      // Qué mejorar: qué + dónde + cuándo.
      const corto = t => { t = String(t || '').toLowerCase(); return t.length > 90 ? t.slice(0, 90).replace(/\s+\S*$/, '') + '…' : t; };
      const rangoDe = n => (semSil.find(x => x.n === n) || {}).rango;
      if (faltan.length) r.mejorar.push('Subir el material de ' + (faltan.length > 1 ? 'las semanas ' : 'la semana ') + y(faltan.map(f => f.n +
        (rangoDe(f.n) ? ' (bloque de las semanas ' + rangoDe(f.n) + ': ' + corto(f.tema) + ')' : f.tema ? ' (' + corto(f.tema) + ')' : ''))) + '.');
      const aRevisar = [...new Set(rep.map(p => p[1]).concat(sinTema.map(f => f.n)))];
      if (aRevisar.length) r.mejorar.push((aRevisar.length > 1 ? 'Revisar las semanas ' : 'Revisar la semana ') + y(aRevisar.sort((a, b) => a - b).map(String)) + ': cada semana debe tener el material de su propio tema (hoy hay archivos repetidos o de otra semana).');
      if (Z) r.nota.push('Con el archivo «Descargar contenido del curso» no se puede revisar la anticipación (material publicado ' +
        '48 horas antes de la clase) ni si algo está oculto: no trae esos datos. Aquí se revisa solo que cada semana tenga su material y que corresponda a su tema.');
      if (!Z && (tarde.length || proximas.length)) r.mejorar.push('Publicar el material de cada semana al menos 48 horas antes de su primera clase' +
        (proximas.length ? ' (el de la semana ' + proximas[0].n + ', a más tardar el ' + fechaDeDia(proximas[0].limite) + ')' : '') + '.');
      if (titMal.length) {
        const ej = titMal[0], mj = ej.materiales.find(x => x.cmp && x.cmp.tema);
        r.mejorar.push('Poner en la primera diapositiva de cada clase el título exacto del tema del sílabo (semana' + (titMal.length > 1 ? 's ' : ' ') +
          y(titMal.map(f => String(f.n))) + ')' + (mj ? '; por ejemplo, en la semana ' + ej.n + ': «' + mj.cmp.tema + '»' : '') + '.');
        r.nota.push('En la auditoría interna 2025 (NC 8.5.2, trazabilidad) se observó una presentación cuyo título no era el del sílabo, aunque el tema fuera parecido. ' +
          'Aquí se exige el mismo texto del tema (sin importar mayúsculas, tildes ni signos).');
      }
      if (!Z) r.nota.push('Plazo del material: disponible 48 horas antes de la clase, según las Recomendaciones del Vicerrectorado Académico para la modalidad virtual (vigentes en 2026-II). ' + (conHorario
        ? 'Se toma la primera clase de la semana según el horario del grupo.' : 'Sin el horario del grupo, se cuenta desde el primer día de la semana: puede ser algo más exigente que la norma.'));
      if (sesionMal.length) r.nota.push('Puede que la numeración de sesiones del docente no sea por semana (p. ej., dos sesiones por semana). Confírmelo antes de observarlo.');
      if (cuadro.some(f => f.n === 1 && f.publicado != null && !f.aTiempo)) r.nota.push('La semana 1 se mide contra el primer día de clases (' + fechaDeDia(ini) + '), no 48 horas antes. Esta regla está por confirmar.');
      r.para_docente = r.sugerido === 'Cumple'
        ? (Z ? 'Gracias: cada semana tiene su material y corresponde a su tema.' : 'Gracias: el material de cada semana está publicado a tiempo y corresponde a su tema.')
        : 'Gracias por el material que ya publicó' + (conMat.length ? ' en las semanas ' + y(conMat.map(f => String(f.n))) : '') + '. Para completar este punto le pedimos:\n' +
          r.mejorar.map((t, i) => (i + 1) + '. ' + t).join('\n');
    })();

    /* 03, 04, 06, 08 · solo inventario (reglas en la siguiente etapa) -- */
    (function () {
      const sesiones = visibles.filter(a => a.clase === 'sesion');
      R['03'] = { punto: '03', sugerido: '', certeza: 'pendiente', mejorar: [], para_docente: '',
        porque: 'Lo revisa usted: ' + (sesiones.length ? plural(sesiones.length, 'plan de sesión publicado', 'planes de sesión publicados') + '; vea si siguen el Modelo Pedagógico URP.' : 'no hay planes de sesión publicados; confírmelo en el aula.'),
        evidencia: [sesiones.length ? 'Planes de sesión publicados: ' + y(sesiones.map(a => '«' + a.titulo + '» (semana ' + a.seccion + ')')) + '.' : 'No hay documentos llamados «sesión de aprendizaje» o «plan de sesión».'],
        nota: ['Qué revisar: (1) que cada plan de sesión siga el Modelo Pedagógico URP (Figura 14) y las directrices de la Escuela; (2) que la primera diapositiva de cada clase indique la unidad y los contenidos de la semana. ' +
          'El portal no puede juzgar el contenido de un plan de sesión: por eso este punto lo decide usted.'] };
      if (A.subgrupo === '0') R['03'].nota.push('Si el grupo tiene aula de taller, sus planes de sesión están en esa otra aula.');
      R['04'] = Z ? regla04Zip(H, cuadro) : regla04(H, recursos, cuadro, silabo, diaCopia);
      const vis = m => H.acts.filter(a => a.mod === m && a.visible);
      const evSil = ((silabo && silabo.semanas) || []).filter(x => /pr[aá]ctica calificada|examen|sustentaci|taller|trabajo|informe|evaluaci[oó]n del logro/i.test(x.contenido));
      const lista06 = vis('assign').concat(vis('quiz')).concat(vis('forum')).map(a => ({ assign: 'Tarea', quiz: 'Cuestionario', forum: 'Foro' }[a.mod]) + ' «' + a.titulo + '» (' + (a.seccion ? 'semana ' + a.seccion : 'sección general') + ')');
      R['06'] = { punto: '06', sugerido: '', certeza: 'pendiente', mejorar: [], para_docente: '',
        porque: 'Lo revisa usted: compare ' + plural(vis('assign').length, 'tarea', 'tareas') + ', ' + plural(vis('quiz').length, 'cuestionario', 'cuestionarios') + ' y ' + plural(vis('forum').length, 'foro', 'foros') +
          ' con ' + (evSil.length ? plural(evSil.length, 'evaluación', 'evaluaciones') + ' del sílabo' : 'lo que pide el sílabo') + '.',
        evidencia: ['En el aula: ' + (lista06.length ? lista06.join('; ') : 'no hay tareas, cuestionarios ni foros') + '.'].concat(evSil.length ? ['El sílabo programa: ' + evSil.map(x => 'semana ' + x.n + ' («' + (x.tituloVer || x.titulo).replace(/…$/, '') + '»)').join('; ') + '.'] : []),
        nota: ['Qué revisar: que cada evaluación del sílabo tenga su actividad en el aula (o que se haya tomado en clase) y que los foros y tareas correspondan a los contenidos del curso. ' +
          'El portal no puede juzgar si son coherentes: por eso este punto lo decide usted.'] };
      R['08'] = regla08(H, ctx, cuadro, inicioSemana, diaCopia);
    })();

    // Por qué de cada resultado, en una línea, para el resumen.
    const pq = (n, t) => { if (!R[n].porque) R[n].porque = t; };
    ['01', '02'].forEach(n => pq(n, R[n].evidencia[R[n].sugerido === 'Subió' ? 0 : 0] || ''));
    pq('07', R['07'].sugerido === 'Existen' ? R['07'].para_docente.replace(/^Gracias por compartir /, 'Hay ').replace(/\.$/, '') + '.' : 'No hay lecturas, videos ni enlaces de apoyo fuera del material de clase.');
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
  const semanaTxt = H => H.semanaActual != null ? ', semana ' + H.semanaActual + ' del ciclo' : '';
  const queCopia = H => (H.fuente === 'zip' ? 'archivo «Descargar contenido del curso» del ' : 'copia del ') + fechaHora(H.aula.copia);
  const LIMITE_ZIP = 'Se usó el archivo «Descargar contenido del curso» (segunda opción): con él no se pueden revisar las fechas de publicación, lo que está oculto ni las rúbricas de las tareas.';
  function textoBorrador(res) {
    const A = res.hechos.aula, L = [];
    L.push('Pre-verificación automática del aula virtual «' + A.nombre + '» (' + queCopia(res.hechos) + semanaTxt(res.hechos) + ').');
    if (res.hechos.fuente === 'zip') L.push(LIMITE_ZIP);
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
    'No aplica': ['neutro', '–'], '': ['manual', '👁']
  };
  const chip = s => { const e = ESTADOS[s] || ESTADOS['']; return '<span class="mbz-chip mbz-' + e[0] + '">' + e[1] + ' ' + esc(s || 'Lo revisa usted') + '</span>'; };
  const CERTEZA = { alta: 'Alta: es un dato del aula (existe o no, fechas).', media: 'Media: conviene que usted lo confirme.', baja: 'Baja: revíselo usted.', pendiente: 'Lo decide usted: el portal reúne los datos, pero este juicio es suyo.' };
  const ESTADO_SEMANA = {
    ok: ['ok', '✔ A tiempo'], tarde: ['parcial', '◐ Publicado tarde'], revisar: ['parcial', '◐ Revisar'], falta: ['falla', '✖ Sin material'],
    futuro: ['neutro', 'Aún no corresponde'], evaluacion: ['neutro', 'Semana de examen']
  };

  // Tabla comparativa del punto 05: aula virtual frente al sílabo, semana por semana.
  function tablaComparativaHTML(r) {
    const grupos = r.tablas && r.tablas.length ? r.tablas : (r.tabla && r.tabla.length ? [{ tabla: r.tabla }] : []);
    if (!grupos.some(g => g.tabla && g.tabla.length)) return '';
    const MARCA = { ok: ['✔', 'ok'], otra: ['⚠', 'parcial'], apoyo: ['?', 'neutro'], falta: ['✖', 'falla'], oculto: ['✖', 'falla'] };
    const li = l => l.length ? '<ul class="mbz-tc-l">' + l.map(x => {
      if (typeof x === 'string') return '<li>' + esc(x) + '</li>';
      if (x.marca === 'cab') return '<li class="mbz-tc-cab">' + esc(x.t) + '</li>';
      const m = MARCA[x.marca] || ['', 'neutro'];
      return '<li class="mbz-tc-i mbz-tc-' + m[1] + '"><span class="mbz-tc-m">' + m[0] + '</span> ' + esc(x.t) + (x.nota ? '<div class="mbz-tc-nota">' + esc(x.nota) + '</div>' : '') + '</li>';
    }).join('') + '</ul>' : '<span class="mbz-tc-vacio">— Nada publicado</span>';
    const tono = t => /^✖/.test(t) ? 'falla' : /^◐|^\?|^⚠/.test(t) ? 'parcial' : /^✔/.test(t) ? 'ok' : 'neutro';
    return '<dt>Tabla comparativa: aula virtual frente al sílabo</dt><dd><p class="mbz-sub">Cada fila es una semana que, a la fecha de la copia, ya debía tener material. ' +
      '<span style="float:right;font-size:12px;color:#7a8580">reglas ' + VERSION_REGLAS + '</span>A la izquierda, lo que hay en el aula; a su lado, lo que el sílabo indica. <b>✔ verde</b> = coincide · <b>⚠ ámbar</b> = es tema de otra semana · <b>✖ rojo</b> = falta · <b>? gris</b> = no es un tema del sílabo (material de apoyo).</p>' +
      grupos.filter(g => g.tabla && g.tabla.length).map(g => (g.etiqueta ? '<p class="mbz-sub"><b>Aula de ' + esc(g.etiqueta) + '</b></p>' : '') +
        '<div class="mbz-scroll"><table class="mbz-tabla mbz-tc"><colgroup><col style="width:7%"><col style="width:27%"><col style="width:27%"><col style="width:19%"><col style="width:20%"></colgroup>' +
        '<thead><tr><th>Semana</th><th>Lo que hay en el aula virtual</th><th>Lo que debería estar según el sílabo</th><th>Hallazgo</th><th>Recomendación</th></tr></thead><tbody>' +
        g.tabla.map(t => '<tr class="' + (t.ok ? 'mbz-tc-ok' : '') + '"><td class="mbz-n">' + t.n + '</td><td>' + li(t.aula) + '</td><td>' + li(t.silabo) + '</td><td>' +
          t.hallazgo.map(x => '<div class="mbz-tc-h mbz-' + tono(x) + '">' + esc(x) + '</div>').join('') + '</td><td>' + li(t.recomendacion) + '</td></tr>').join('') +
        '</tbody></table></div>').join('') + '</dd>';
  }

  function reporteHTML(res, op) {
    op = op || {};
    const H = res.hechos, A = H.aula, R = res.puntos, S = res.resumen;
    const h = [], pid = 'mbz-' + (op.prefijo || '') + 'p';
    h.push('<div class="mbz-rep' + (op.prefijo ? ' mbz-rep-aula' : '') + '">');
    h.push('<div class="mbz-cab"><div class="mbz-cab-t">Reporte de la copia del aula virtual</div>' +
      '<div class="mbz-cab-d"><b>' + esc(A.nombre) + '</b> · ' + esc(A.corto) + ' · ' + esc(A.tipo) +
      '<br>' + (H.fuente === 'zip' ? 'Contenido del curso descargado el <b>' : 'Copia descargada el <b>') + fechaHora(A.copia) + '</b>' +
      (H.inicioDia != null ? ' (semana ' + H.semanaActual + ' del ciclo; la semana 1 empezó el ' + fechaDeDia(H.inicioDia) + ')' : '') + '. ' +
      'El reporte describe el aula <b>ese día</b>.</div></div>');
    if (H.fuente === 'zip' && !op.sinNotaZip) h.push(notaZipHTML(H));
    // Administrador: el horario del ciclo, arriba y bien visible (sirve para todos los coordinadores).
    if (op.pedirHorario) h.push('<div class="mbz-horario"><div class="mbz-horario-t">📅 Administrador: cargue el horario de clases del ciclo</div>' +
      'Se hace <b>una sola vez</b> y sirve para todos los coordinadores: con él, el punto 08 (grabaciones de clases virtuales) se revisa solo. ' +
      '<a class="mbz-boton" href="docs/cargar-horario.html" target="_blank" rel="noopener">Abrir la herramienta para cargar el horario</a>' +
      '<details><summary>O pegue aquí las filas de la guía de matrícula (solo para este análisis)</summary>' +
      '<textarea id="mbzHorarioTxt" rows="4" placeholder="Pegue aquí las filas copiadas de la guía de matrícula…"></textarea>' +
      (op.codigoHorario === undefined ? '' : '<label class="mbz-sub">Código del curso en la guía: <input type="text" id="mbzHorarioCod" value="' + esc(op.codigoHorario || '') + '" placeholder="p. ej. IN-1001" style="width:120px"></label> ') +
      '<button type="button" id="mbzHorarioUsar">Usar este horario</button></details>' + (op.horarioAviso ? '<div class="mbz-alto" style="margin-top:8px">' + op.horarioAviso + '</div>' : '') + '</div>');
    if (op.aviso) h.push('<div class="mbz-info">' + op.aviso + '</div>');
    if (op.avisoVacia) h.push('<div class="mbz-alto">' + op.avisoVacia + '</div>');
    if (A.subgrupo === '0' && !op.sinAvisoTaller) h.push('<div class="mbz-info">ℹ️ Esta es el aula de <b>teoría</b> del grupo ' + esc(A.grupo) + '. Si el grupo también tiene aula de <b>taller</b> ' +
      '(su código termina en <b>-1</b>), puede descargar y analizar esa copia aparte: ahí están las sesiones y grabaciones del taller.</div>');

    // Resumen: resultado y porqué de cada punto.
    h.push('<section class="mbz-resumen"><h4>Resumen</h4><p class="mbz-grande">El portal revisó solo <b>' + S.revisados + ' de los 8 puntos</b>; <b>' + S.conformes + '</b> ' +
      (S.conformes === 1 ? 'aparece conforme' : 'aparecen conformes') + '.' + (S.manuales.length ? ' Los puntos ' + y(S.manuales) + ' los revisa usted, porque dependen de juzgar el contenido o falta un dato.' : '') + '</p>');
    h.push('<p class="mbz-leyenda"><b>Cómo leerlo:</b> <span class="mbz-chip mbz-ok">✔ Cumple / Subió / Existen</span> está bien · <span class="mbz-chip mbz-parcial">◐ Parcial</span> cumple solo en parte · ' +
      '<span class="mbz-chip mbz-falla">✖ No cumple</span> falta · <span class="mbz-chip mbz-manual">👁 Lo revisa usted</span> el portal no puede decidirlo solo. ' +
      'La columna «Por qué» lo explica en una línea; el detalle y el mensaje para el docente están más abajo, en <b>«Ficha por punto»</b>.</p>');
    h.push('<table class="mbz-tabla mbz-resu"><thead><tr><th style="width:44px">N°</th><th style="width:22%">Punto</th><th style="width:150px">Resultado</th><th>Por qué</th></tr></thead><tbody>' +
      PUNTOS.map(([n, et]) => '<tr><td class="mbz-n">' + n + '</td><td>' + esc(et) + '</td><td>' + chip(R[n].sugerido) + '</td><td>' + esc(R[n].porque || '') +
        ' <a class="mbz-ver" href="#' + pid + n + '">ver detalle ↓</a></td></tr>').join('') + '</tbody></table>');
    if (S.acciones.length) h.push('<p class="mbz-sub"><b>Lo más importante que debe corregir el docente</b></p><ol class="mbz-acc">' +
      S.acciones.map(a => '<li><b>' + a.punto + ' ' + esc(a.nombre) + ':</b> ' + esc(a.t) + '</li>').join('') + '</ol>');
    h.push('</section>');

    if (op.botones) h.push('<div class="mbz-botones">' + op.botones + '</div>');
    if (op.horarioUsado) h.push('<div class="mbz-sub">Horario usado para el punto 08 (guía de matrícula): ' + esc(op.horarioUsado) + '.</div>');

    // Fichas
    h.push('<h4 class="mbz-h">Ficha por punto</h4>');
    PUNTOS.forEach(([n, et]) => {
      const r = R[n];
      h.push('<details class="mbz-ficha" id="' + pid + n + '"' + ' open' + '><summary><span class="mbz-n">' + n + '</span> ' + esc(et) + ' ' + chip(r.sugerido) + '</summary>');
      if (r.estandar) h.push('<p class="mbz-std"><b>Estándar:</b> ' + esc(r.estandar) + '</p>');
      h.push('<dl>');
      h.push('<dt>Resultado sugerido</dt><dd>' + chip(r.sugerido) + (r.porque ? ' ' + esc(r.porque) : '') + '</dd>');
      h.push('<dt>Qué se encontró</dt><dd><ul>' + r.evidencia.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul></dd>');
      h.push(tablaComparativaHTML(r));
      if (r.mejorar.length) h.push('<dt>Qué mejorar</dt><dd><ul>' + r.mejorar.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul></dd>');
      h.push('<dt>Certeza</dt><dd>' + esc(CERTEZA[r.certeza] || r.certeza) + '</dd>');
      if (r.automatico && r.para_docente && op.soloLectura) h.push('<dt>Mensaje para el docente</dt><dd class="mbz-msj-ro">' + esc(r.para_docente) + '</dd>');
      else if (r.automatico && r.para_docente !== undefined) h.push('<dt>Mensaje para el docente <small>(puede corregirlo)</small></dt><dd><textarea class="mbz-msj" data-punto="' + n + '" rows="' +
        Math.min(8, 2 + (r.para_docente.match(/\n/g) || []).length) + '">' + esc(r.para_docente) + '</textarea></dd>');
      if (r.nota_interna) h.push('<dt>' + (r.automatico ? 'Nota para usted' : 'Qué revisar usted') + ' <small>(no se envía al docente)</small></dt><dd class="mbz-interna">' + esc(r.nota_interna) + '</dd>');
      h.push('</dl></details>');
    });

    // Cuadro por semanas
    h.push('<h4 class="mbz-h">Cuadro por semanas</h4><p class="mbz-sub">' + (H.fuente === 'zip'
      ? 'Con el archivo «Descargar contenido del curso» no hay fechas: se revisa que cada semana tenga material propio y de su tema, pero no la anticipación. Las semanas de examen no exigen material.'
      : 'Regla (VRA): el material de cada semana se publica al menos 48 horas antes de su primera clase' + (REGLAS.semana1DesdeInicio ? ' (la semana 1, a más tardar el primer día de clases)' : '') +
      '. «Publicado» es la fecha en que el docente agregó el archivo al aula. Las semanas de examen no exigen material.') + '</p>');
    h.push('<div class="mbz-scroll"><table class="mbz-tabla mbz-sem"><colgroup><col style="width:7%"><col style="width:17%"><col style="width:19%"><col style="width:15%"><col style="width:15%"><col style="width:15%"><col style="width:12%"></colgroup>' +
      '<thead><tr><th>Semana</th><th>Tema del sílabo</th><th>Material publicado</th><th>¿Título igual al sílabo?</th><th>Estado</th><th>Evaluaciones</th><th>Clase virtual</th></tr></thead><tbody>');
    res.cuadro.forEach(f => {
      const e = ESTADO_SEMANA[f.estado] || ['neutro', ''];
      const mats = f.materiales.length ? f.materiales.map(m => esc(m.titulo) + (m.visible ? '' : ' <i>(oculto)</i>') +
        (m.archivos.length && norm(m.archivos.join(' ')).indexOf(norm(m.titulo)) < 0 ? '<br><small>' + esc(m.archivos.join(', ')) + '</small>' : '') +
        (m.repetidoDe ? ' <span class="mbz-ojo">= semana ' + m.repetidoDe + '</span>' : '') +
        (m.sesionMal ? ' <span class="mbz-ojo">dice Sesión ' + m.sesion + '</span>' : '') + (m.enlace ? ' <small>(' + esc(m.enlace) + ')</small>' : '')).join('<br>') : '—';
      const TIT = { igual: ['ok', '✔ Igual al sílabo'], parecido: ['falla', '✖ No es el del sílabo'], incompleto: ['falla', '✖ No es el del sílabo'], distinto: ['falla', '✖ No es el del sílabo'],
        'sin-titulo': ['neutro', 'No se leyó'], 'sin-texto': ['neutro', 'No se leyó'] };
      const mt = f.materiales.filter(m => m.cmp);
      const tit = mt.length ? mt.map(m => { const t = TIT[m.cmp.estado] || ['neutro', '']; return '<span class="mbz-chip mbz-' + t[0] + '">' + t[1] + '</span>' +
        (m.tituloPpt ? '<br><small>«' + esc(m.tituloPpt) + '»</small>' : ''); }).join('<br>') : '—';
      const virt = (f.reuniones.map(esc).join('<br>') || '') + (f.virtuales ? (f.reuniones.length ? '<br>' : '') + f.virtuales + ' clase' + (f.virtuales > 1 ? 's' : '') + ' virtual' + (f.virtuales > 1 ? 'es' : '') : '') +
        ((f.grabaciones || []).length ? '<br>🎥 ' + f.grabaciones.map(esc).join('<br>🎥 ') : (f.virtuales ? '<br><span class="mbz-ojo">sin grabación</span>' : ''));
      const pub = f.publicado != null ? '<div class="mbz-fecha">Publicado el ' + fechaDeDia(f.publicado) + ' · ' + esc(diasTxt(f.anticipacion)) + ' de su inicio</div>' : '';
      h.push('<tr class="' + (f.enCurso ? 'mbz-hoy' : '') + '"><td class="mbz-n">' + f.n + '<br><small>' + (f.inicio != null ? fechaDeDia(f.inicio) : '') + (f.enCurso ? '<br>en curso' : '') + '</small></td><td>' + esc(f.tema || '—') + '</td><td>' + mats + pub + '</td><td>' + tit + '</td><td><span class="mbz-chip mbz-' + e[0] + '">' + e[1] + '</span>' +
        (f.problemas.length ? '<div class="mbz-prob">' + f.problemas.map(esc).join('<br>') + '</div>' : '') + '</td><td>' + ((f.evalDet && f.evalDet.length ? f.evalDet.map(e => esc(e.titulo) + (e.rub === 'ok' ? ' <span class="mbz-chip mbz-ok">✔ con rúbrica</span>' : e.rub === 'tarde' ? ' <span class="mbz-chip mbz-parcial">◐ rúbrica tardía</span>' : e.rub === 'sin' ? ' <span class="mbz-chip mbz-falla">✖ sin rúbrica</span>' : '')) : f.evaluaciones.map(esc)).join('<br>') || '—') + '</td><td>' + (virt || '—') + '</td></tr>');
    });
    h.push('</tbody></table></div>');

    h.push('<div class="mbz-pie"><b>Pre-verificación automática. La decisión final es del coordinador.</b><br>' +
      'Archivo analizado: ' + esc(H.archivo.nombre) + ' (' + (H.archivo.tamano / 1048576).toFixed(1) + ' MB, ' + (H.fuente === 'zip' ? esc(A.moodle) : 'Moodle ' + esc(A.moodle)) + '). ' +
      'Se leyeron ' + H.acts.length + ' elementos del aula y el texto de ' + plural(H.pdfLeidos.length, 'PDF', 'PDF') + (H.pdfLeidos.length ? ': ' + esc(H.pdfLeidos.join(' · ')) : '') + '. ' +
      'El archivo no se envió a ningún servidor. De los enlaces solo se muestra el dominio y los correos se ocultan. Reglas: ' + esc(VERSION_REGLAS) + '.' +
      (H.avisos.length ? '<br>' + H.avisos.map(esc).join('<br>') : '') + '</div>');
    h.push('</div>');
    return h.join('');
  }

  /* =================================================================
     Varias aulas por carga (26/10/2026, observación del prof. Juan Gómez)
     -----------------------------------------------------------------
     En Moodle cada subgrupo tiene su propia aula: la de teoría termina en
     «-G01-0» y la del taller, laboratorio o práctica en «-G01-1», «-G01-2»…
     La carga lectiva dice qué tipos y subgrupos dicta el docente en el
     grupo, y con eso el portal sabe cuántas copias pedir:
       · solo teoría ............................ 1 copia (la de teoría)
       · teoría y taller (mismo docente) ........ 2 copias
       · solo taller, laboratorio o práctica .... 1 copia, y es obligatorio
         que tenga información: es la única aula que tiene.
     Si el docente tiene dos aulas y una está vacía (p. ej. pone todo en
     teoría), no se cuenta como falta: se avisa para que el coordinador
     confirme que el material está en la otra aula.
     ================================================================= */
  const NOMBRE_TIPO = { teo: 'teoría', tal: 'taller', lab: 'laboratorio', pra: 'práctica' };
  const claveTipo = t => { const n = norm(t); return /^teo/.test(n) ? 'teo' : /^tal/.test(n) ? 'tal' : /^lab/.test(n) ? 'lab' : /^pr/.test(n) ? 'pra' : ''; };
  const subgrupoLimpio = v => { const t = String(v == null ? '' : v).trim(); return /^\d+$/.test(t) ? String(+t) : ''; };

  // partes: [{ tipo: 'Teo', subgrupo: '0' }, { tipo: 'Tal', subgrupo: '1' }] → una aula por subgrupo.
  function aulasDeLaCarga(partes, grupo) {
    const aulas = [];
    (partes || []).forEach(p => {
      const k = claveTipo(p.tipo); if (!k) return;
      let sg = subgrupoLimpio(p.subgrupo);
      if (k === 'teo' && sg === '') sg = '0';
      let a = aulas.find(x => x.subgrupo === sg);
      if (!a) { a = { subgrupo: sg, tipos: [] }; aulas.push(a); }
      if (!a.tipos.includes(k)) a.tipos.push(k);
    });
    const g = String(grupo || '').replace(/\D/g, ''), g2 = g ? String(+g).padStart(2, '0') : '';
    aulas.forEach(a => {
      a.tipos.sort((x, z) => ['teo', 'tal', 'lab', 'pra'].indexOf(x) - ['teo', 'tal', 'lab', 'pra'].indexOf(z));
      a.esTeoria = a.tipos.includes('teo');
      a.etiqueta = y(a.tipos.map(t => NOMBRE_TIPO[t]));
      a.terminacion = a.subgrupo === '' || !g2 ? '' : '-G' + g2 + '-' + a.subgrupo;
    });
    aulas.sort((a, b) => (a.subgrupo === '' ? 99 : +a.subgrupo) - (b.subgrupo === '' ? 99 : +b.subgrupo));
    return aulas;
  }
  // Por el nombre del archivo descargado («…-g01-1-20261026-0830-nu.mbz»): grupo y subgrupo.
  function aulaDelNombre(nombre) {
    // También el .zip de «Descargar contenido del curso»: «CU-20262-63P24301-G01-0_1793122369.zip».
    const m = String(nombre || '').match(/-g0*(\d+)-(\d+)(?:-\d{8}|_\d+\.zip$)/i);
    return m ? { grupo: String(+m[1]), subgrupo: String(+m[2]) } : null;
  }
  // Lo que el docente cargó: todo menos el foro de avisos que Moodle crea solo.
  function contenidoAula(H) {
    const propios = (H.acts || []).filter(a => !(a.mod === 'forum' && a.tipoForo === 'news'));
    const visibles = propios.filter(a => a.visible);
    return { elementos: propios.length, visibles: visibles.length, vacia: !visibles.length };
  }
  const nombreAula = au => 'aula de ' + au.etiqueta + (au.terminacion ? ' (termina en «' + au.terminacion + '»)' : '');

  // Une los resultados de las aulas de una misma carga.
  //   items:  [{ H, res, aula, archivo }] — copias que sí son de esta carga
  //   aulas:  las que pide la carga lectiva (puede venir vacía si no se sabe)
  //   extras: [{ nombre, motivo }] — copias que no se tomaron en cuenta
  const RANGO = s => ['Cumple', 'Subió', 'Existen'].includes(s) ? 3 : s === 'Parcial' ? 2 : /^No (cumple|subió|existen)$/.test(s) ? 1 : 0;
  const BASTA_UNA = ['01', '02', '07'];   // basta con que esté en una de sus aulas
  // Une las tablas comparativas del punto 05 de dos o más aulas del mismo grupo (teoría y taller…).
  function unirTablas(grupos) {
    const NIVEL = { ok: 3, otra: 2, falta: 1 };
    const sem = [...new Set([].concat(...grupos.map(g => g.tabla.map(t => t.n))))].sort((a, b) => a - b);
    return sem.map(n => {
      const filas = grupos.map(g => ({ g, t: g.tabla.find(x => x.n === n) })).filter(x => x.t);
      const aula = [].concat(...filas.map(x => x.t.aula.map(it => typeof it === 'string' ? '[' + x.g.etiqueta + '] ' + it
        : Object.assign({}, it, { t: '[Aula de ' + x.g.etiqueta + '] ' + it.t }))));
      // Sílabo: el mejor estado de cada tema entre las aulas.
      const silabo = [], vistos = {};
      filas.forEach(x => x.t.silabo.forEach(it => {
        if (typeof it === 'string' || it.marca === 'cab') { if (!silabo.some(z => (z.t || z) === (it.t || it))) silabo.push(it); return; }
        const prev = vistos[it.t];
        if (!prev) { const c = Object.assign({}, it, { nota: it.nota && it.marca !== 'falta' ? it.nota + ' (aula de ' + x.g.etiqueta + ')' : it.nota }); vistos[it.t] = c; silabo.push(c); }
        else if ((NIVEL[it.marca] || 0) > (NIVEL[prev.marca] || 0)) { prev.marca = it.marca; prev.nota = it.nota + ' (aula de ' + x.g.etiqueta + ')'; }
      }));
      const items = aula.filter(it => typeof it !== 'string' && it.marca !== 'oculto');
      const temas = silabo.filter(it => typeof it !== 'string' && it.marca !== 'cab');
      const okA = items.filter(it => it.marca === 'ok').length, pub = temas.filter(it => it.marca === 'ok').length;
      const hall = [], rec = [];
      if (!items.length) hall.push('✖ Sin material en ninguna de las aulas');
      else hall.push((okA === items.length ? '✔ ' : okA ? '◐ ' : '✖ ') + 'Aulas: ' + okA + ' de ' + plural(items.length, 'material publicado es', 'materiales publicados son') + ' de esta semana o su bloque');
      if (temas.length) hall.push((pub === temas.length ? '✔ ' : pub ? '◐ ' : '✖ ') + 'Sílabo: ' + pub + ' de ' + plural(temas.length, 'tema publicado', 'temas publicados') + ' (contando las dos aulas)');
      filas.forEach(x => x.t.hallazgo.filter(h => !/^(✔|◐|✖) (Aula|Sílabo):|Sin material|material está oculto/.test(h)).forEach(h => hall.push(h.replace(/^(\S+) /, '$1 [' + x.g.etiqueta + '] '))));
      filas.forEach(x => x.t.recomendacion.filter(t => !/falta publicar|^Subir el material de|^Ninguna/.test(t)).forEach(t => rec.push('[Aula de ' + x.g.etiqueta + '] ' + t)));
      const faltan = temas.filter(it => it.marca === 'falta' && !/en curso/.test(it.nota || ''));
      if (faltan.length) rec.push('Publicar, en el aula de teoría o en la de ' + grupos.filter(g => !/teor/i.test(g.etiqueta)).map(g => g.etiqueta).join(' o ') + ': «' + faltan.map(it => it.t.split(':')[0]).join('», «') + '».');
      if (!items.length && !faltan.length) rec.push('Subir el material de esta semana en alguna de las aulas.');
      return { n, aula, silabo, hallazgo: hall, recomendacion: rec.length ? rec : ['Ninguna: está conforme.'], ok: !rec.length };
    });
  }

  function combinar(items, aulas, extras) {
    aulas = (aulas || []).map(a => Object.assign({}, a));
    if (!aulas.length) items.forEach(it => { if (!aulas.some(a => a === it.aula)) aulas.push(it.aula); });
    aulas.forEach(a => { a.copia = items.find(it => it.aula.subgrupo === a.subgrupo || (it.aula === a)) || null; });
    items.forEach(it => { it.contenido = contenidoAula(it.H); });
    const faltan = aulas.filter(a => !a.copia);
    const usadas = items.slice();
    const llenas = usadas.filter(it => !it.contenido.vacia), vacias = usadas.filter(it => it.contenido.vacia);
    const consideradas = llenas.length ? llenas : usadas;
    const unica = aulas.length === 1;
    const notas = [];        // para el coordinador
    const lineasDocente = []; // contexto que va en el borrador

    vacias.forEach(it => {
      const otras = llenas.map(o => 'el ' + nombreAula(o.aula).replace(/ \(.*\)$/, ''));
      if (llenas.length) {
        notas.push({ nivel: 'aviso', t: 'El ' + nombreAula(it.aula) + ' no tiene información cargada (solo el foro de avisos que Moodle crea solo). ' +
          'Revise si todo lo de ' + it.aula.etiqueta + ' está en ' + y(otras) + ': muchos docentes publican todo en una sola aula. ' +
          'Si es así, no es una falta. Si ese material no está en ninguna de sus aulas, sí corresponde observarlo.' });
        lineasDocente.push('El aula de ' + it.aula.etiqueta + ' no tiene información cargada; se revisó lo publicado en ' + y(otras) + '.');
      } else if (unica) {
        notas.push({ nivel: 'alto', t: 'El ' + nombreAula(it.aula) + ' no tiene información cargada. Es la única aula de este docente en el grupo ' +
          '(según la carga lectiva dicta solo ' + it.aula.etiqueta + '), así que es obligatorio que tenga la información del curso.' });
        lineasDocente.push('Su aula de ' + it.aula.etiqueta + ' no tiene información cargada. Es la única aula que tiene en este grupo, por eso es necesario que publique en ella la información del curso.');
      }
    });
    if (!llenas.length && usadas.length > 1) {
      notas.push({ nivel: 'alto', t: 'Ninguna de las aulas de este docente tiene información cargada (' + y(usadas.map(it => it.aula.etiqueta)) + ').' });
      lineasDocente.push('Ninguna de sus aulas tiene información cargada todavía.');
    }
    faltan.forEach(a => notas.push({ nivel: 'falta', t: 'Falta la copia del ' + nombreAula(a) + '. Según la carga lectiva, este docente también dicta ' +
      a.etiqueta + ' en este grupo. Descárguela de esa aula y adjúntela junto con la otra; mientras tanto, el resultado de abajo no la incluye.' }));
    (extras || []).forEach(x => notas.push({ nivel: 'info', t: 'No se tomó en cuenta «' + x.nombre + '»: ' + x.motivo }));

    // Punto por punto.
    const varias = consideradas.length > 1;
    const etq = it => it.aula.etiqueta.charAt(0).toUpperCase() + it.aula.etiqueta.slice(1);
    const R = {};
    PUNTOS.forEach(([n, et]) => {
      const rs = consideradas.map(it => ({ it, r: it.res.puntos[n] }));
      const base = rs[0].r;
      const conDato = rs.filter(x => x.r.sugerido);
      let elegido = rs[0];
      if (conDato.length) {
        const orden = conDato.slice().sort((a, b) => RANGO(a.r.sugerido) - RANGO(b.r.sugerido));
        elegido = BASTA_UNA.includes(n) ? orden[orden.length - 1] : orden[0];
      }
      const r = Object.assign({}, elegido.r);
      r.porAula = usadas.map(it => ({ etiqueta: it.aula.etiqueta, sugerido: it.res.puntos[n].sugerido, vacia: it.contenido.vacia }));
      // 29/10/2026: teoría + taller/laboratorio/práctica. El sílabo es uno solo y el material puede
      // estar en cualquiera de las dos aulas: un tema cuenta como publicado si está en alguna.
      if (varias && n === '05' && rs.some(x => (x.r.tabla || []).length)) {
        r.tabla = unirTablas(rs.map(x => ({ etiqueta: x.it.aula.etiqueta, tabla: x.r.tabla || [] })));
        delete r.tablas;
        // El resultado sale de la tabla unida: una semana sin material en el aula de taller no es falta
        // si su material está en la de teoría.
        const conMat = r.tabla.filter(t => t.aula.length), okT = r.tabla.filter(t => t.ok);
        r.__sugerido05 = okT.length === r.tabla.length ? 'Cumple' : conMat.length ? 'Parcial' : 'No cumple';
        r.__porque05 = 'Mirando las dos aulas juntas: ' + okT.length + ' de ' + plural(r.tabla.length, 'semana está conforme', 'semanas están conformes') +
          (r.tabla.length - conMat.length ? '; ' + plural(r.tabla.length - conMat.length, 'semana sin material en ninguna aula', 'semanas sin material en ninguna aula') : '') + '.';
      } else if (varias) r.tablas = rs.map(x => ({ etiqueta: x.it.aula.etiqueta, tabla: x.r.tabla || [] }));
      if (varias) {
        r.evidencia = [].concat(...rs.map(x => x.r.evidencia.map(e => etq(x.it) + ': ' + e)));
        r.mejorar = [].concat(...rs.map(x => x.r.mejorar.map(e => (BASTA_UNA.includes(n) && RANGO(elegido.r.sugerido) === 3) ? null : etq(x.it) + ': ' + e))).filter(Boolean);
        if (r.automatico) {
          const conformes = rs.every(x => RANGO(x.r.sugerido) === 3);
          if (BASTA_UNA.includes(n) || conformes) r.para_docente = elegido.r.para_docente;
          else r.para_docente = rs.filter(x => RANGO(x.r.sugerido) < 3 && x.r.para_docente)
            .map(x => 'En el aula de ' + x.it.aula.etiqueta + ':\n' + x.r.para_docente).join('\n\n');
        }
        r.porque = (BASTA_UNA.includes(n)
          ? (RANGO(elegido.r.sugerido) === 3 ? 'Está en el aula de ' + elegido.it.aula.etiqueta + '. ' : '')
          : (conDato.length ? 'Se toma el resultado más bajo de sus aulas. ' : '')) + (elegido.r.porque || '');
      }
      const reglas = [];
      if (varias && r.automatico) reglas.push(BASTA_UNA.includes(n)
        ? 'Este punto basta con que esté en una de las aulas del docente.'
        : 'Este punto se revisa en cada aula que tiene información y se sugiere el resultado más bajo.');
      if (vacias.length && llenas.length && r.automatico) reglas.push('No se contó el aula vacía de ' + y(vacias.map(it => it.aula.etiqueta)) + ': confirme que su material está en la otra aula.');
      if (faltan.length) reglas.push('Falta la copia del aula de ' + y(faltan.map(a => a.etiqueta)) + '.');
      r.nota_interna = [r.nota_interna].concat(reglas).filter(Boolean).join(' ');
      if (r.automatico && (vacias.length && llenas.length || faltan.length) && r.certeza === 'alta') r.certeza = 'media';
      if (r.__sugerido05) { r.sugerido = r.__sugerido05; r.porque = r.__porque05; delete r.__sugerido05; delete r.__porque05; }
      r.nombre = et; r.estandar = base.estandar;
      R[n] = r;
    });

    const principal = (consideradas.find(it => it.aula.esTeoria) || consideradas[0]);
    const rc = { carga: true, aulas, items: usadas, faltan, vacias, llenas, notas, lineasDocente, puntos: R,
      hechos: principal.H, cuadro: principal.res.cuadro, versionReglas: VERSION_REGLAS };
    rc.resumen = resumen(rc);
    return rc;
  }

  function textoBorradorCarga(rc) {
    const L = [];
    const desc = rc.items.map(it => 'aula de ' + it.aula.etiqueta + ' «' + it.H.aula.corto + '» (' + queCopia(it.H) + ')' +
      (it.contenido.vacia ? ' — sin información cargada' : ''));
    L.push('Pre-verificación automática ' + (rc.items.length > 1 ? 'de las aulas virtuales' : 'del aula virtual') + ' de este curso y grupo: ' + y(desc) +
      (rc.hechos.semanaActual != null ? '. Semana ' + rc.hechos.semanaActual + ' del ciclo.' : '.'));
    if (rc.items.some(it => it.H.fuente === 'zip')) L.push(LIMITE_ZIP);
    rc.lineasDocente.forEach(t => L.push(t));
    PUNTOS.forEach(([n, et]) => {
      const r = rc.puntos[n];
      if (!r.automatico) return;
      L.push('');
      L.push(n + ' ' + et + ' — sugerido: ' + (r.sugerido || 'revisar a mano'));
      if (r.para_docente) L.push(r.para_docente);
    });
    L.push('');
    const man = PUNTOS.map(p => p[0]).filter(n => !rc.puntos[n].automatico);
    if (man.length) L.push('Puntos ' + y(man) + ': revisión a mano (reglas automáticas en preparación).');
    return 'BORRADOR DEL ASISTENTE — revíselo, corríjalo o bórrelo antes de guardar\n\n' + L.join('\n');
  }

  // Cuadro «qué copias corresponden»: sirve antes de adjuntar y en el reporte.
  function cuadroCopiasHTML(aulas, items) {
    items = items || [];
    if (!aulas.length) return '';
    const filas = aulas.map(a => {
      const it = items.find(x => x.aula.subgrupo === a.subgrupo || x.aula === a);
      const obligatoria = aulas.length === 1 ? 'Sí: es su única aula'
        : a.esTeoria ? 'Sí' : aulas.some(x => x.esTeoria) ? 'Puede estar vacía si todo está en teoría' : 'Puede estar vacía si todo está en su otra aula';
      let estado;
      if (!it) estado = '<span class="mbz-chip mbz-falla">✖ Falta la copia</span>';
      else if (it.contenido && it.contenido.vacia) estado = '<span class="mbz-chip ' + (aulas.length === 1 ? 'mbz-falla' : 'mbz-parcial') + '">' + (aulas.length === 1 ? '✖' : '◐') + ' Copia recibida, aula vacía</span>';
      else estado = '<span class="mbz-chip mbz-ok">✔ Copia recibida</span>' + (it.contenido ? '<div class="mbz-fecha">' + plural(it.contenido.visibles, 'elemento visible', 'elementos visibles') + '</div>' : '');
      return '<tr><td><b>' + esc(a.etiqueta.charAt(0).toUpperCase() + a.etiqueta.slice(1)) + '</b>' + (a.subgrupo !== '' ? '<div class="mbz-fecha">subgrupo ' + esc(a.subgrupo) + '</div>' : '') + '</td>' +
        '<td>' + (a.terminacion ? '<code>…' + esc(a.terminacion) + '</code>' : '—') + '</td><td>' + esc(obligatoria) + '</td><td>' + estado + '</td></tr>';
    }).join('');
    return '<table class="mbz-tabla mbz-copias"><thead><tr><th>Aula</th><th>El código del aula termina en</th><th>¿Debe tener información?</th><th>Estado</th></tr></thead><tbody>' + filas + '</tbody></table>';
  }

  function reporteCargaHTML(rc, op) {
    op = op || {};
    const R = rc.puntos, S = rc.resumen, h = [];
    const A = rc.hechos.aula;
    h.push('<div class="mbz-rep">');
    h.push('<div class="mbz-cab"><div class="mbz-cab-t">Reporte de las aulas virtuales de esta carga</div>' +
      '<div class="mbz-cab-d"><b>' + esc(A.nombre.replace(/^\S+\s+/, '')) + '</b> · grupo ' + esc(A.grupo) +
      (op.docente ? ' · ' + esc(op.docente) : '') + '<br>En Moodle, la teoría y el taller (o laboratorio, o práctica) son <b>aulas distintas</b>. ' +
      'Según la carga lectiva, a este docente le ' + (rc.aulas.length === 1 ? 'corresponde <b>1 aula</b>' : 'corresponden <b>' + rc.aulas.length + ' aulas</b>') + ' en este grupo.</div></div>');
    const zipItem = rc.items.find(it => it.H.fuente === 'zip');
    if (zipItem) h.push(notaZipHTML(zipItem.H));
    h.push('<h4 class="mbz-h">Copias que corresponden a esta carga</h4>' + cuadroCopiasHTML(rc.aulas, rc.items));
    const CL = { alto: 'mbz-alto', falta: 'mbz-alto', aviso: 'mbz-aviso', info: 'mbz-info' };
    rc.notas.forEach(n => h.push('<div class="' + CL[n.nivel] + '">' + (n.nivel === 'aviso' ? '⚠️ ' : n.nivel === 'info' ? 'ℹ️ ' : '') + esc(n.t) + '</div>'));

    h.push('<section class="mbz-resumen"><h4>Resumen de la carga</h4><p class="mbz-grande">El portal revisó solo <b>' + S.revisados + ' de los 8 puntos</b>; <b>' + S.conformes + '</b> ' +
      (S.conformes === 1 ? 'aparece conforme' : 'aparecen conformes') + '.' + (S.manuales.length ? ' Los puntos ' + y(S.manuales) + ' los revisa usted.' : '') + '</p>');
    h.push('<p class="mbz-leyenda"><b>Cómo se juntan las aulas:</b> el <b>sílabo</b>, el <b>mensaje de sensibilización</b> y los <b>materiales adicionales</b> basta con que estén en una de las aulas del docente. ' +
      'Los <b>materiales por semana</b>, las <b>rúbricas</b> y las <b>grabaciones</b> se revisan en cada aula que tiene información y se sugiere el resultado más bajo. ' +
      'Un aula vacía no se cuenta si el docente puso todo en la otra; si es su única aula, sí cuenta.</p>');
    const cols = rc.items;
    h.push('<div class="mbz-scroll"><table class="mbz-tabla mbz-resu"><thead><tr><th style="width:44px">N°</th><th style="width:20%">Punto</th>' +
      cols.map(it => '<th style="width:120px">Aula de ' + esc(it.aula.etiqueta) + '</th>').join('') +
      '<th style="width:150px">Sugerido para la carga</th><th>Por qué</th></tr></thead><tbody>' +
      PUNTOS.map(([n, et]) => '<tr><td class="mbz-n">' + n + '</td><td>' + esc(et) + '</td>' +
        cols.map(it => '<td>' + (it.contenido.vacia ? '<span class="mbz-chip mbz-neutro">Vacía</span>' : chip(it.res.puntos[n].sugerido)) + '</td>').join('') +
        '<td>' + chip(R[n].sugerido) + '</td><td>' + esc(R[n].porque || '') + ' <a class="mbz-ver" href="#mbz-p' + n + '">ver detalle ↓</a></td></tr>').join('') +
      '</tbody></table></div>');
    if (S.acciones.length) h.push('<p class="mbz-sub"><b>Lo más importante que debe corregir el docente</b></p><ol class="mbz-acc">' +
      S.acciones.map(a => '<li><b>' + a.punto + ' ' + esc(a.nombre) + ':</b> ' + esc(a.t) + '</li>').join('') + '</ol>');
    h.push('</section>');
    if (op.botones) h.push('<div class="mbz-botones">' + op.botones + '</div>');

    h.push('<h4 class="mbz-h">Ficha por punto (las aulas juntas)</h4>');
    PUNTOS.forEach(([n, et]) => {
      const r = R[n];
      h.push('<details class="mbz-ficha" id="mbz-p' + n + '" open><summary><span class="mbz-n">' + n + '</span> ' + esc(et) + ' ' + chip(r.sugerido) + '</summary>');
      if (r.estandar) h.push('<p class="mbz-std"><b>Estándar:</b> ' + esc(r.estandar) + '</p>');
      h.push('<dl><dt>Resultado sugerido</dt><dd>' + chip(r.sugerido) + (r.porque ? ' ' + esc(r.porque) : '') + '</dd>');
      h.push('<dt>Qué se encontró</dt><dd><ul>' + r.evidencia.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul></dd>');
      h.push(tablaComparativaHTML(r));
      if (r.mejorar.length) h.push('<dt>Qué mejorar</dt><dd><ul>' + r.mejorar.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul></dd>');
      h.push('<dt>Certeza</dt><dd>' + esc(CERTEZA[r.certeza] || r.certeza) + '</dd>');
      if (r.automatico && r.para_docente !== undefined) h.push('<dt>Mensaje para el docente <small>(puede corregirlo)</small></dt><dd><textarea class="mbz-msj" data-punto="' + n + '" rows="' +
        Math.min(10, 2 + (String(r.para_docente).match(/\n/g) || []).length) + '">' + esc(r.para_docente) + '</textarea></dd>');
      if (r.nota_interna) h.push('<dt>' + (r.automatico ? 'Nota para usted' : 'Qué revisar usted') + ' <small>(no se envía al docente)</small></dt><dd class="mbz-interna">' + esc(r.nota_interna) + '</dd>');
      h.push('</dl></details>');
    });

    h.push('<h4 class="mbz-h">Reporte completo de cada aula</h4><p class="mbz-sub">Aquí está el detalle de cada copia por separado, con su cuadro por semanas.</p>');
    rc.items.forEach((it, i) => {
      h.push('<details class="mbz-ficha mbz-aula-det"' + (it.contenido.vacia ? '' : '') + '><summary>Aula de ' + esc(it.aula.etiqueta) + ' · ' + esc(it.H.aula.corto) +
        (it.H.fuente === 'zip' ? ' <span class="mbz-chip mbz-parcial">.zip: sin fechas ni rúbricas</span>' : '') +
        (it.contenido.vacia ? ' <span class="mbz-chip mbz-neutro">Vacía</span>' : '') + '</summary>' +
        reporteHTML(it.res, { prefijo: 'a' + i + '-', soloLectura: true, sinAvisoTaller: true, sinNotaZip: true, horarioUsado: op.horarios && op.horarios[i] }) + '</details>');
    });
    h.push('<div class="mbz-pie"><b>Pre-verificación automática. La decisión final es del coordinador.</b> ' +
      'Copias leídas: ' + esc(rc.items.map(it => it.H.archivo.nombre).join(' · ')) + '. Ningún archivo se envió a un servidor. Reglas: ' + esc(VERSION_REGLAS) + '.</div>');
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
.mbz-tc{font-size:15px}.mbz-tc td{line-height:1.45}.mbz-tc-l{margin:0;padding-left:18px}.mbz-tc-l li{margin:2px 0}.mbz-tc-vacio{color:#8f2418;font-weight:600}
.mbz-tc-ok td{background:#f3faf6}.mbz-tc-l li.mbz-tc-i{list-style:none;margin:5px 0 5px -18px;padding:4px 6px;border-radius:6px}.mbz-tc-l li.mbz-tc-cab{list-style:none;margin-left:-18px;font-weight:700}
.mbz-tc-i.mbz-tc-ok{background:#e6f4ee}.mbz-tc-i.mbz-tc-parcial{background:#fff3d6}.mbz-tc-i.mbz-tc-falla{background:#fde8e5}.mbz-tc-i.mbz-tc-neutro{background:#f1f3f2}
.mbz-tc-m{font-weight:700;display:inline-block;width:1.2em}.mbz-tc-i.mbz-tc-ok .mbz-tc-m{color:#0b6e48}.mbz-tc-i.mbz-tc-parcial .mbz-tc-m{color:#8a5a00}.mbz-tc-i.mbz-tc-falla .mbz-tc-m{color:#8f2418}
.mbz-tc-nota{font-size:13px;color:#4b5a53;margin:2px 0 0 1.3em;font-style:italic}.mbz-tc-h{font-weight:600;margin:2px 0}.mbz-tc-h.mbz-falla{color:#8f2418}.mbz-tc-h.mbz-parcial{color:#8a5a00}.mbz-tc-h.mbz-ok{color:#0b6e48}
.mbz-tabla th{background:#f3f6f4;font-size:13.5px;text-transform:none;letter-spacing:0;font-weight:700;color:#2b3a33}
.mbz-sem{table-layout:fixed;width:100%}.mbz-sem td{word-wrap:break-word;overflow-wrap:anywhere}.mbz-sem .mbz-chip{white-space:normal;display:inline-block;max-width:100%}
.mbz-resu td{font-size:14.5px}.mbz-ver{font-size:13px;white-space:nowrap;color:#2a6fb0}
.mbz-leyenda{font-size:14px;line-height:1.9;margin:4px 0 8px}
.mbz-fecha{font-size:12.5px;color:var(--tinta-media,#5a6660);margin-top:3px}
.mbz-info{background:#eef5fc;border:1px solid #c3ddf3;border-radius:8px;padding:8px 12px;margin:8px 0;font-size:14.5px}
.mbz-horario-t{font-size:18px;font-weight:700;color:#1d4f80;margin-bottom:4px}
.mbz-boton{display:inline-block;margin:8px 0 4px;padding:10px 16px;border-radius:8px;background:#2a6fb0;color:#fff!important;text-decoration:none;font-weight:600;font-size:15.5px}.mbz-mini{max-width:560px}.mbz-n{font-weight:700;white-space:nowrap}
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
.mbz-horario{margin:10px 0;padding:14px 16px;border-radius:10px;background:#eef6fb;border:2px solid #2a6fb0;font-size:15px}
.mbz-horario textarea{width:100%;margin:8px 0;font:inherit;font-size:13.5px;border:1px solid #c9d3cd;border-radius:8px;padding:8px}
.mbz-horario button{padding:8px 14px;border-radius:8px;border:1px solid var(--brand,#0f8f5e);background:var(--brand,#0f8f5e);color:#fff;font-size:14.5px}
.mbz-copias td{font-size:14.5px}.mbz-copias code{font-size:14px;background:#f3f6f4;padding:1px 5px;border-radius:4px}
.mbz-aula-det>summary{font-size:16px}.mbz-aula-det .mbz-rep{border:0;padding:4px 0;margin:4px 0}
.mbz-msj-ro{white-space:pre-wrap;background:#f6f8f7;border-radius:6px;padding:6px 8px}
.mbz-zip{margin:10px 0 12px;padding:14px 16px;border-radius:10px;background:#fffaf0;border:2px solid #d99a1b;font-size:16px;line-height:1.55}
.mbz-zip-t{font-size:18px;font-weight:700;color:#7a4b00;margin-bottom:6px}.mbz-zip p{margin:6px 0}
.mbz-zip-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin:8px 0}
.mbz-zip-si,.mbz-zip-no{border-radius:8px;padding:10px 12px}.mbz-zip-si{background:#e6f4ee;border:1px solid #b5dcc8}.mbz-zip-no{background:#fdecea;border:1px solid #f1b9b2}
.mbz-zip-si>b{color:#0b6e48;font-size:16.5px}.mbz-zip-no>b{color:#8f2418;font-size:16.5px}.mbz-zip ul{margin:6px 0 0 20px;padding:0}.mbz-zip li{margin:4px 0}
.mbz-zip-rec{font-weight:600;color:#5a3d00}
.mbz-json{white-space:pre-wrap;font-family:'IBM Plex Mono',monospace;font-size:12px;background:#f6f8f7;border:1px solid #dfe4e1;border-radius:8px;padding:8px;max-height:320px;overflow:auto}
`;
  function ponerEstilos() {
    if (typeof document === 'undefined' || document.getElementById('mbz-css')) return;
    const s = document.createElement('style'); s.id = 'mbz-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  const API = { VERSION_REGLAS, REGLAS, PUNTOS, notaZipHTML, leerHorario, horarioDelAula, cargarHorarioPublicado, esCopiaMbz, buscarCopia, buscarCopias, leer, cruzar, evaluar, hallazgosJSON, textoBorrador, reporteHTML, ponerEstilos,
    aulasDeLaCarga, aulaDelNombre, contenidoAula, combinar, textoBorradorCarga, cuadroCopiasHTML, reporteCargaHTML, fecha, fechaHora, _prueba: { lineasPdf, leerSilabo } };
  raiz.MBZ = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
