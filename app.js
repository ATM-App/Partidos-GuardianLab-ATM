// --- FUNCIONES GLOBALES ---
function cerrarModal(id){ document.getElementById(id).style.display='none'; }

// --- CONFIGURACIÓN FIREBASE (COMPAT) ---
const firebaseConfig = {
  apiKey: "AIzaSyAciST9qvSnRNqjVD9Lkx-xyfbdU6PJLIc",
  authDomain: "guardianlab-5a64c.firebaseapp.com",
  projectId: "guardianlab-5a64c",
  storageBucket: "guardianlab-5a64c.firebasestorage.app",
  messagingSenderId: "538502071393",
  appId: "1:538502071393:web:21e9ba4fb8e11c87eb9620"
};

try {
    firebase.initializeApp(firebaseConfig);
    console.log("Firebase OK");
} catch(e) { console.error("Error Firebase", e); }

const db = firebase.firestore();
const auth = firebase.auth(); 

// HELPERS DB
function dbSave(storeName, data) {
    const id = String(data.id || Date.now());
    return db.collection(storeName).doc(id).set(data).then(() => true).catch(err => { console.error(err); return false; });
}
function dbGetAll(storeName) {
    return db.collection(storeName).get().then(snap => {
        const list = []; snap.forEach(doc => list.push(doc.data())); return list;
    }).catch(err => { console.error(err); return []; });
}
function dbDelete(storeName, id) {
    return db.collection(storeName).doc(String(id)).delete().catch(err => console.error(err));
}

// --- VARIABLES GLOBALES ---
let partidoLive = { config: {}, acciones: [], marcador: {local:0, rival:0}, porterosJugaron: new Set(), minutosJugados: {}, porteroActualId: null, parteActual: 'Pre-Partido', crono: {seg:0, int:null, run:false, startTs:0, savedSeg:0, lastUpdate:0} };
let accionTemporal = null;
let porteroEnEdicionId = null;
let partidoEnEdicion = null;

// CATÁLOGOS BASE
let CATALOGO_ACCIONES = {
    "DEFENSIVAS": { id: "def", grupos: { "BLOCAJES": ["Blocaje Frontal Raso", "Blocaje Lateral Raso", "Blocaje Frontal Media Altura", "Blocaje Lateral Media Altura", "Blocaje Aéreo"], "DESVÍOS": ["Desvío Mano Natural", "Desvío Mano Cambiada", "Desvío 2 Manos"], "JUEGO AÉREO": ["Despeje 1 Puño", "Despeje 2 Puños", "Prolongación"], "1 VS 1": ["Reducción de Espacios", "Posición Cruz", "Apertura", "Caída Lateral"], "OTRAS": ["Rechace"], "PERSONALIZADAS": [] } },
    "OFENSIVAS": { id: "of", grupos: { "PASES CON LA MANO": ["Pase Mano Raso", "Pase Mano Alto", "Pase Mano Picado"], "PASES CON PIE": ["Volea", "Pase Corto", "Pase Largo", "Despeje", "Despeje Orientado"], "CONTINUIDAD": ["Perfil + Control + Pase Corto", "Perfil + Control + Pase Largo", "Largo Control Previo", "Largo en Movimiento"], "PERSONALIZADAS": [] } },
    "TÁCTICAS": { id: "tac", grupos: { "POSICIONAMIENTO": ["Posición y Bisectriz", "Visión de Juego", "Saltar Líneas", "Posición Fase Ofensiva", "Posición Fase Defensiva", "Barrera"], "COMUNICACIÓN": ["Comunicación Verbal", "Comunicación NO Verbal"], "CONSTRUCCIÓN": ["Pase Espalda Defensa", "Desmarque de Apoyo"], "PERSONALIZADAS": [] } },
    "REINCORPORACIONES": { id: "rein", grupos: { "TIPOS": ["A Posición Básica", "A Mismo Lado", "A Lado Contrario", "Tras Blocaje"], "PERSONALIZADAS": [] } }
};

let categoriaAccionActiva = "DEFENSIVAS";

// --- INICIO ---
document.addEventListener('DOMContentLoaded', () => {
    auth.onAuthStateChanged((user) => {
        if (user) {
            cargarPorteros();
            cargarPartidosHistorial();
            cargarConceptosPersonalizados();
        } else {
            auth.signInAnonymously().catch(err => alert("Error de conexión. Revisa tu internet."));
        }
    });
    recuperarPartidoEnCurso();
    const today = new Date().toISOString().split('T')[0];
    const fConf = document.getElementById('conf-fecha'); if(fConf) fConf.value=today;
    
    if(localStorage.getItem('guardian_theme') === 'light'){ document.body.classList.add('light-mode'); }
});

window.onbeforeunload = function() {
    if (partidoLive.crono.run || (partidoLive.parteActual !== 'Pre-Partido' && partidoLive.parteActual !== 'Final')) {
        return "Partido en curso.";
    }
};

// --- NAVEGACIÓN ---
window.alternarTema = function() { document.body.classList.toggle('light-mode'); localStorage.setItem('guardian_theme', document.body.classList.contains('light-mode') ? 'light' : 'dark'); }

window.cambiarSeccion = function(sec) {
    document.getElementById('modal-pdf-preview').style.display = 'none';
    document.getElementById('modal-fin-partido').style.display = 'none';
    
    ['porteros','partidos','conceptos','live'].forEach(id => {
        const secEl = document.getElementById('section-'+id);
        const btnEl = document.getElementById('btn-'+id);
        if(secEl) secEl.style.display = 'none';
        if(btnEl) btnEl.classList.remove('active');
    });
    
    const destEl = document.getElementById('section-'+sec);
    if(destEl) destEl.style.display = 'block';
    
    // Activar botón en el dock
    let realBtnId = sec === 'live' ? 'btn-partidos' : 'btn-'+sec;
    const btnDest = document.getElementById(realBtnId);
    if(btnDest) btnDest.classList.add('active');
    
    const banner = document.getElementById('live-match-banner');
    if(banner){
        if(sec !== 'live' && partidoLive.parteActual !== 'Pre-Partido' && partidoLive.parteActual !== 'Final'){
            banner.style.display = 'block';
        } else {
            banner.style.display = 'none';
        }
    }
}

// --- CONCEPTOS PERSONALIZADOS ---
function cargarConceptosPersonalizados() {
    db.collection('conceptos').onSnapshot(snap => {
        const listDiv = document.getElementById('lista-conceptos-custom');
        if(listDiv) listDiv.innerHTML = '';

        // Reset
        CATALOGO_ACCIONES["DEFENSIVAS"].grupos["PERSONALIZADAS"] = [];
        CATALOGO_ACCIONES["OFENSIVAS"].grupos["PERSONALIZADAS"] = [];
        CATALOGO_ACCIONES["TÁCTICAS"].grupos["PERSONALIZADAS"] = [];
        CATALOGO_ACCIONES["REINCORPORACIONES"].grupos["PERSONALIZADAS"] = [];

        snap.forEach(doc => {
            const c = doc.data();
            let labelType = "";
            
            if (c.tipo.startsWith("LIVE_")) {
                const map = { "LIVE_DEF": "DEFENSIVAS", "LIVE_OF": "OFENSIVAS", "LIVE_TAC": "TÁCTICAS", "LIVE_REIN": "REINCORPORACIONES" };
                const cat = map[c.tipo];
                if (CATALOGO_ACCIONES[cat]) {
                    CATALOGO_ACCIONES[cat].grupos["PERSONALIZADAS"].push(c.nombre);
                }
                labelType = `Live Pro (${cat})`;

                if(listDiv) {
                    listDiv.innerHTML += `<div class="item-temp-eval" style="display:flex;justify-content:space-between;align-items:center;">
                        <div><strong>${c.nombre}</strong><br><span style="font-size:0.7em;color:#aaa">${labelType}</span></div>
                        <button class="btn-trash" onclick="borrarConcepto('${doc.id}')"><span class="material-symbols-outlined">delete</span></button>
                    </div>`;
                }
            }
        });
        
        if(document.getElementById('section-live').style.display === 'block') {
            window.renderizarPanelAcciones();
        }
    });
}

window.guardarNuevoConcepto = function() {
    const nombre = document.getElementById('new-concepto-nombre').value;
    const tipo = document.getElementById('new-concepto-tipo').value;
    if(!nombre) return alert("Escribe un nombre");
    
    db.collection('conceptos').add({ nombre, tipo, id: Date.now() });
    document.getElementById('new-concepto-nombre').value = '';
    alert("Acción guardada correctamente");
}

window.borrarConcepto = function(id) {
    if(confirm("¿Borrar esta acción?")) db.collection('conceptos').doc(id).delete();
}

// --- PORTEROS ---
window.previsualizarFoto = function() {
    const file = document.getElementById('fotoPorteroInput').files[0];
    if(file){
        const r = new FileReader();
        r.onload = (e) => document.getElementById('fotoPreview').src = e.target.result;
        r.readAsDataURL(file);
    }
}
window.actualizarEquipos = function() {
    const cat = document.getElementById('catPortero').value;
    const sel = document.getElementById('equipoPortero');
    sel.innerHTML = '<option value="">Selecciona Categoría...</option>';
    if(!cat) return;
    ['A','B','C','D','E','F'].forEach(l => sel.innerHTML += `<option value="${cat} ${l}">${cat} ${l}</option>`);
}
function cargarPorteros() {
    db.collection("porteros").onSnapshot((snapshot) => {
        const lista = [];
        snapshot.forEach(doc => lista.push({...doc.data(), id: doc.id}));
        document.getElementById('total-porteros').innerText = lista.length;
        const c = document.getElementById('lista-porteros');
        c.innerHTML = '';
        const def = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjY2NjIiBzdHJva2Utd2lkdGg9IjEiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiLz48cGF0aCBkPSJNMTIgOGEzIDMgMCAxIDAgMCA2IDMgMyAwIDAgMCAwLTZ6bS01IDlsMTAgMGE3IDcgMCAwIDEtMTAgMHoiLz48L3N2Zz4=";
        lista.forEach(p => {
            c.innerHTML += `<div class="portero-card"><div style="display:flex; align-items:center;"><img src="${p.foto||def}" class="mini-foto-list"><div><div class="card-title">${p.nombre}</div><div class="card-subtitle">${p.equipo} (${p.anio||'-'})</div></div></div><div><button class="btn-icon-action" onclick="window.cargarDatosEdicion('${p.id}')"><span class="material-symbols-outlined" style="font-size: 18px;">edit</span></button><button class="btn-trash" onclick="window.borrarPortero('${p.id}')"><span class="material-symbols-outlined" style="font-size: 20px;">delete</span></button></div></div>`;
        });
        const opts = '<option value="">Seleccionar...</option>' + lista.map(p=>`<option value="${p.id}">${p.nombre}</option>`).join('');
        const confSelect = document.getElementById('conf-portero-titular');
        if(confSelect) confSelect.innerHTML = opts;
    });
}
window.procesarPortero = function() {
    const n = document.getElementById('nombrePortero').value;
    const a = document.getElementById('anioPortero').value;
    const c = document.getElementById('catPortero').value;
    const eq = document.getElementById('equipoPortero').value;
    const file = document.getElementById('fotoPorteroInput').files[0];

    if(!n || !c || !eq) return alert("Faltan datos");
    
    const btn = document.getElementById('btn-save');
    btn.innerText = "Guardando..."; btn.disabled = true;

    const guardar = (url) => {
        const data = { nombre:n, anio:a, categoria:c, equipo:eq };
        if(url) data.foto = url;
        const prom = porteroEnEdicionId ? db.collection("porteros").doc(porteroEnEdicionId).update(data) : db.collection("porteros").add(data);
        prom.then(() => { window.cancelarEdicion(); }).catch(e => alert("Error: " + e.message)).finally(() => { btn.innerText = "Añadir Jugador"; btn.disabled = false; });
    };

    if(file) {
        const r = new FileReader();
        r.onload = (e) => {
            const img = new Image();
            img.src = e.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
                const max = 300; 
                let w = img.width; let h = img.height;
                if(w>h){ if(w>max){ h*=max/w; w=max; } } else { if(h>max){ w*=max/h; h=max; } }
                canvas.width = w; canvas.height = h;
                ctx.drawImage(img, 0, 0, w, h);
                guardar(canvas.toDataURL('image/jpeg', 0.5));
            };
        };
        r.readAsDataURL(file);
    } else {
        guardar(null);
    }
}
window.cargarDatosEdicion = function(id) {
    db.collection("porteros").doc(id).get().then(doc => {
        const p = doc.data();
        document.getElementById('nombrePortero').value = p.nombre; document.getElementById('anioPortero').value = p.anio;
        document.getElementById('catPortero').value = p.categoria; window.actualizarEquipos();
        document.getElementById('equipoPortero').value = p.equipo; document.getElementById('fotoPreview').src = p.foto || "";
        porteroEnEdicionId = id; document.getElementById('btn-save').innerText = "Guardar Cambios";
        document.getElementById('btn-cancel').style.display = "inline-block"; window.scrollTo({top:0, behavior:'smooth'});
    });
}
window.cancelarEdicion = function() {
    porteroEnEdicionId = null; document.getElementById('nombrePortero').value = ''; document.getElementById('anioPortero').value = '';
    document.getElementById('catPortero').value = ''; document.getElementById('equipoPortero').innerHTML = '';
    document.getElementById('fotoPreview').src = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjY2NjIiBzdHJva2Utd2lkdGg9IjEiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiLz48cGF0aCBkPSJNMTIgOGEzIDMgMCAxIDAgMCA2IDMgMyAwIDAgMCAwLTZ6bS01IDlsMTAgMGE3IDcgMCAwIDEtMTAgMHoiLz48L3N2Zz4=";
    document.getElementById('btn-save').innerText = "Añadir Jugador"; document.getElementById('btn-cancel').style.display = "none";
}
window.borrarPortero = function(id) { if(confirm("¿Borrar?")) db.collection("porteros").doc(id).delete(); }


// --- LIVE MATCH ---
window.abrirConfigPartido = function() {
    if(partidoLive.parteActual !== 'Pre-Partido' && partidoLive.parteActual !== 'Final') { if(!confirm("⚠️ Hay un partido en curso. ¿Iniciar uno nuevo?")) return; }
    const selEq = document.getElementById('conf-equipo');
    if (selEq.options.length <= 1) {
        db.collection("porteros").get().then(snap => {
            const eqs = new Set(); snap.forEach(doc => eqs.add(doc.data().equipo));
            selEq.innerHTML = '<option value="">Equipo ATM...</option>';
            [...eqs].sort().forEach(e => selEq.innerHTML += `<option value="${e}">${e}</option>`);
        });
    }
    document.getElementById('modal-config-partido').style.display = 'flex';
}
window.filtrarPorterosPorEquipo = function() {
    const eq = document.getElementById('conf-equipo').value; const sel = document.getElementById('conf-portero-titular');
    sel.innerHTML = '<option value="">Cargando...</option>';
    db.collection("porteros").where("equipo", "==", eq).get().then(snap => {
        sel.innerHTML = '<option value="">Titular...</option>'; snap.forEach(doc => { sel.innerHTML += `<option value="${doc.id}">${doc.data().nombre}</option>`; });
    });
}
window.iniciarLivePro = function() {
    const eq = document.getElementById('conf-equipo').value; const riv = document.getElementById('conf-rival').value; const titId = document.getElementById('conf-portero-titular').value;
    if(!eq || !riv || !titId) return alert("Faltan datos");
    localStorage.removeItem('guardian_live_backup');
    if(partidoLive.crono.int) clearInterval(partidoLive.crono.int);
    partidoLive = { config: { equipo: eq, rival: riv, titular: titId, tipo: document.getElementById('conf-tipo').value, fecha: document.getElementById('conf-fecha').value, jornada: document.getElementById('conf-jornada').value, dificultad: document.getElementById('conf-dificultad').value, entrenador: document.getElementById('conf-entrenador').value, campo: document.getElementById('conf-campo').value, condicion: document.getElementById('conf-condicion').value }, acciones: [], marcador: {local:0, rival:0}, porterosJugaron: [titId], minutosJugados: {}, porteroActualId: titId, parteActual: 'Pre-Partido', crono: {seg:0, int:null, run:false, startTs:0, savedSeg:0, lastUpdate:0} };
    partidoLive.minutosJugados[titId] = 0;
    document.getElementById('live-equipo-local').innerText = eq; document.getElementById('live-equipo-rival').innerText = riv; document.getElementById('score-local').innerText = '0'; document.getElementById('score-rival').innerText = '0'; document.getElementById('crono').innerText = '00:00'; document.getElementById('live-log').innerHTML = '';
    window.actualizarUI(); categoriaAccionActiva = "DEFENSIVAS"; window.renderizarPanelAcciones(); window.cerrarModal('modal-config-partido'); window.cambiarSeccion('live'); guardarEstadoLive();
}
window.actualizarUI = function() {
    if(!partidoLive.porteroActualId) return;
    document.getElementById('live-portero-nombre').innerText = "Cargando...";
    db.collection("porteros").doc(String(partidoLive.porteroActualId)).get().then(doc => {
        if(doc.exists) { const p = doc.data(); document.getElementById('live-portero-nombre').innerText = p.nombre; document.getElementById('live-portero-foto').src = p.foto || "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjY2NjIiBzdHJva2Utd2lkdGg9IjEiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiLz48cGF0aCBkPSJNMTIgOGEzIDMgMCAxIDAgMCA2IDMgMyAwIDAgMCAwLTZ6bS01IDlsMTAgMGE3IDcgMCAwIDEtMTAgMHoiLz48L3N2Zz4="; }
    });
}
window.controlCrono = function(act) {
    const c = partidoLive.crono;
    if(act === 'start' || act === 'ini2') {
        if(c.run) return;
        c.run = true; c.startTs = Date.now(); c.savedSeg = c.seg; c.lastUpdate = Date.now();
        c.int = setInterval(() => {
            const now = Date.now(); const diff = Math.floor((now - c.startTs)/1000); c.seg = c.savedSeg + diff; window.updCrono();
            if(partidoLive.porteroActualId && c.run) {
                const delta = (now - c.lastUpdate) / 1000;
                if(delta > 0) {
                    if(!partidoLive.minutosJugados[partidoLive.porteroActualId]) partidoLive.minutosJugados[partidoLive.porteroActualId] = 0;
                    partidoLive.minutosJugados[partidoLive.porteroActualId] += delta;
                    c.lastUpdate = now;
                    const m = Math.floor(partidoLive.minutosJugados[partidoLive.porteroActualId] / 60);
                    const elM = document.getElementById('live-minutos');
                    if(elM) elM.innerText = `⏱️ ${m}'`;
                }
            }
        }, 1000);
        partidoLive.parteActual = (act === 'start') ? '1ª Parte' : '2ª Parte'; window.regEv('HITO', partidoLive.parteActual);
        document.getElementById('live-parte-txt').innerText = partidoLive.parteActual;
    }
    if(act === 'fin1' || act === 'fin') { clearInterval(c.int); c.run = false; c.savedSeg = c.seg; partidoLive.parteActual = (act === 'fin1') ? 'Descanso' : 'Final'; window.regEv('HITO', partidoLive.parteActual); document.getElementById('live-parte-txt').innerText = partidoLive.parteActual; if(act === 'fin') window.abrirModalFin(); }
    guardarEstadoLive();
    ['btn-start-partido','btn-fin-1','btn-ini-2','btn-fin-partido'].forEach(i=>document.getElementById(i).style.display='none');
    if(act==='start') document.getElementById('btn-fin-1').style.display='block'; if(act==='fin1') document.getElementById('btn-ini-2').style.display='block'; if(act==='ini2') document.getElementById('btn-fin-partido').style.display='block';
}
window.updCrono = function() { const m = Math.floor(partidoLive.crono.seg/60); const s = partidoLive.crono.seg%60; document.getElementById('crono').innerText = `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`; }

window.deshacerUltimaAccion = function() {
    if (partidoLive.acciones.length === 0) return alert("No hay acciones registradas para deshacer.");
    
    if (confirm("¿Deshacer el último registro?")) {
        const ultima = partidoLive.acciones.pop(); 

        if (ultima.tipo === 'GOL_FAVOR') {
            partidoLive.marcador.local = Math.max(0, partidoLive.marcador.local - 1);
            document.getElementById('score-local').innerText = partidoLive.marcador.local;
        } else if (ultima.tipo === 'GOL_CONTRA') {
            partidoLive.marcador.rival = Math.max(0, partidoLive.marcador.rival - 1);
            document.getElementById('score-rival').innerText = partidoLive.marcador.rival;
        }

        const log = document.getElementById('live-log');
        log.innerHTML = '';
        partidoLive.acciones.forEach(ev => {
            let cl='',ic=''; 
            if(ev.tipo==='ACCION'){cl=ev.res==='CORRECTO'?'log-ok':'log-error';ic=ev.res==='CORRECTO'?'✅':'❌';}
            if(ev.tipo==='GOL_FAVOR'){cl='log-gol-atm';ic='⚽';} 
            if(ev.tipo==='GOL_CONTRA'){cl='log-gol-rival';ic='🥅';} 
            if(ev.tipo==='GOL_ANULADO'){cl='log-anulado';ic='🚫';}
            if(ev.tipo==='HITO'){ log.innerHTML=`<div class="log-item" style="background:#444;color:white;justify-content:center;"><strong>${ev.nom}</strong></div>` + log.innerHTML; return; }
            log.innerHTML=`<div class="log-item ${cl}"><div><strong>${ev.min}</strong> ${ev.nom} (${ev.pnom})</div><div>${ic}</div></div>`+log.innerHTML;
        });

        guardarEstadoLive();
    }
}

window.regEv = function(tipo, nom, res=null, obs=null) {
    const min = Math.floor(partidoLive.crono.seg/60)+1;
    const ev = {id:Date.now(), min:min+"'", parte:partidoLive.parteActual, seg:partidoLive.crono.seg, tipo, nom, pid:partidoLive.porteroActualId, pnom:'...', res, obs};
    if(partidoLive.porteroActualId) ev.pnom = document.getElementById('live-portero-nombre').innerText;
    partidoLive.acciones.push(ev);
    const log = document.getElementById('live-log'); let cl='',ic='';
    if(tipo==='ACCION'){cl=res==='CORRECTO'?'log-ok':'log-error';ic=res==='CORRECTO'?'✅':'❌';}
    if(tipo==='GOL_FAVOR'){cl='log-gol-atm';ic='⚽';} if(tipo==='GOL_CONTRA'){cl='log-gol-rival';ic='🥅';} if(tipo==='GOL_ANULADO'){cl='log-anulado';ic='🚫';}
    if(tipo==='HITO') { log.innerHTML=`<div class="log-item" style="background:#444;color:white;justify-content:center;"><strong>${nom}</strong></div>` + log.innerHTML; } 
    else { log.innerHTML=`<div class="log-item ${cl}"><div><strong>${ev.min}</strong> ${nom} (${ev.pnom})</div><div>${ic}</div></div>`+log.innerHTML; }
    guardarEstadoLive();
}
window.renderizarPanelAcciones = function() {
    const panel = document.getElementById('panel-acciones-avanzado'); panel.innerHTML = '';
    const tabs = document.createElement('div'); tabs.className='tabs-container';
    Object.keys(CATALOGO_ACCIONES).forEach(k => { const btn = document.createElement('button'); btn.innerText = k; btn.className = `tab-btn ${categoriaAccionActiva===k?'active':''}`; btn.dataset.cat = CATALOGO_ACCIONES[k].id; btn.onclick = () => { categoriaAccionActiva = k; window.renderizarPanelAcciones(); }; tabs.appendChild(btn); });
    panel.appendChild(tabs);
    
    const gr = CATALOGO_ACCIONES[categoriaAccionActiva].grupos; 
    const catId = CATALOGO_ACCIONES[categoriaAccionActiva].id;
    
    Object.keys(gr).forEach(gName => {
        let acciones = gr[gName];
        if (acciones && acciones.length > 0) {
            const tit = document.createElement('div'); tit.className='action-group-title'; tit.innerText=gName; panel.appendChild(tit);
            const grid = document.createElement('div'); grid.className='actions-grid-new';
            acciones.forEach(act => { 
                const b = document.createElement('button'); 
                b.innerText=act; 
                b.className=`action-btn-new btn-${catId}`; 
                b.onclick = () => window.prepararAccion(act); 
                grid.appendChild(b); 
            });
            panel.appendChild(grid);
        }
    });
}
window.prepararAccion = function(n) { if(!partidoLive.crono.run) return alert("Crono parado"); accionTemporal = n; document.getElementById('accion-titulo').innerText = n; document.getElementById('modal-accion').style.display='flex'; }
window.guardarAccionLive = function(r) { window.regEv('ACCION', accionTemporal, r, document.getElementById('accion-obs').value); document.getElementById('modal-accion').style.display='none'; document.getElementById('accion-obs').value=''; }
window.gestionarGol = function(equipo, accion) {
    if(!partidoLive.crono.run) return alert("Crono parado");
    if(equipo === 'local') { if(accion === 'sumar') { partidoLive.marcador.local++; window.regEv('GOL_FAVOR', 'Gol ATM'); } else { if(partidoLive.marcador.local>0) { partidoLive.marcador.local--; window.regEv('GOL_ANULADO', 'Gol ATM Anulado'); } } document.getElementById('score-local').innerText = partidoLive.marcador.local; } 
    else { if(accion === 'sumar') { document.getElementById('modal-gol-rival').style.display='flex'; } else { if(partidoLive.marcador.rival>0) { partidoLive.marcador.rival--; window.regEv('GOL_ANULADO', 'Gol Rival Anulado'); document.getElementById('score-rival').innerText = partidoLive.marcador.rival; } } }
    guardarEstadoLive();
}
window.registrarGolContra = function(isError) {
    partidoLive.marcador.rival++; document.getElementById('score-rival').innerText = partidoLive.marcador.rival;
    let obs = isError ? "ERROR: " + document.getElementById('gol-error-detalle').value : "";
    window.regEv('GOL_CONTRA', 'Gol Rival', isError?'ERROR':null, obs);
    document.getElementById('div-error-detalle').style.display='none'; document.getElementById('gol-error-detalle').value=''; document.getElementById('modal-gol-rival').style.display='none';
    guardarEstadoLive();
}
window.mostrarInputError = function() { document.getElementById('div-error-detalle').style.display='block'; }
window.abrirModalCambio = function() {
    if(!partidoLive.crono.run && partidoLive.parteActual!=='Descanso') return alert("Solo en juego o descanso");
    db.collection("porteros").get().then(snap => {
        const sel = document.getElementById('select-cambio-portero'); sel.innerHTML='';
        let count = 0;
        snap.forEach(doc => { const p = doc.data(); if(p.equipo === partidoLive.config.equipo && doc.id !== partidoLive.porteroActualId) { sel.innerHTML += `<option value="${doc.id}">${p.nombre}</option>`; count++; } });
        if(count === 0) return alert("No hay suplentes");
        document.getElementById('modal-cambio').style.display='flex';
    });
}
window.confirmarCambio = function() {
    const pid = document.getElementById('select-cambio-portero').value;
    if(partidoLive.crono.run && partidoLive.porteroActualId) {
        const now = Date.now(); const delta = (now - partidoLive.crono.lastUpdate)/1000;
        if(!partidoLive.minutosJugados[partidoLive.porteroActualId]) partidoLive.minutosJugados[partidoLive.porteroActualId] = 0;
        partidoLive.minutosJugados[partidoLive.porteroActualId] += delta; partidoLive.crono.lastUpdate = now;
    }
    db.collection("porteros").doc(pid).get().then(doc => {
        const entra = doc.data(); partidoLive.porteroActualId = pid;
        if(!partidoLive.porterosJugaron.includes(pid)) partidoLive.porterosJugaron.push(pid);
        if(!partidoLive.minutosJugados[pid]) partidoLive.minutosJugados[pid] = 0;
        window.regEv('CAMBIO', `Entra ${entra.nombre}`); window.actualizarUI(); document.getElementById('modal-cambio').style.display='none'; guardarEstadoLive();
    });
}
window.abrirModalFin = function() {
    document.getElementById('fin-res-local').innerText = partidoLive.marcador.local; document.getElementById('fin-res-rival').innerText = partidoLive.marcador.rival;
    const cont = document.getElementById('container-analisis-porteros'); cont.innerHTML = '';
    db.collection("porteros").get().then(snap => {
        const ps = []; snap.forEach(d => ps.push({...d.data(), id:d.id}));
        partidoLive.porterosJugaron.forEach(pid => {
            const p = ps.find(x => x.id == pid);
            if(p) { cont.innerHTML += `<div class="pdf-obs-box"><div class="pdf-obs-header">ANÁLISIS: ${p.nombre}</div><textarea id="pos_${pid}" class="pdf-input-read" placeholder="Lo POSITIVO..."></textarea><textarea id="neg_${pid}" class="pdf-input-read" placeholder="Lo NEGATIVO..."></textarea><textarea id="tras_${pid}" class="pdf-input-read" placeholder="Trascendencia..."></textarea></div>`; }
        });
        document.getElementById('modal-fin-partido').style.display='flex'; localStorage.removeItem('guardian_live_backup');
    });
}
function guardarEstadoLive() { const st = { ...partidoLive, porterosJugaron: [...partidoLive.porterosJugaron] }; localStorage.setItem('guardian_live_backup', JSON.stringify(st)); }
function recuperarPartidoEnCurso() {
    const bk = localStorage.getItem('guardian_live_backup');
    if(bk) {
        if(confirm("⚠️ Recuperar partido en curso?")) {
            const st = JSON.parse(bk); st.porterosJugaron = new Set(st.porterosJugaron); partidoLive = st;
            window.cambiarSeccion('live');
            document.getElementById('live-equipo-local').innerText = st.config.equipo; document.getElementById('live-equipo-rival').innerText = st.config.rival;
            document.getElementById('score-local').innerText = st.marcador.local; document.getElementById('score-rival').innerText = st.marcador.rival;
            const log = document.getElementById('live-log'); log.innerHTML = '';
            st.acciones.forEach(ev => {
                let cl='',ic=''; if(ev.tipo==='ACCION'){cl=ev.res==='CORRECTO'?'log-ok':'log-error';ic=ev.res==='CORRECTO'?'✅':'❌';}
                if(ev.tipo==='GOL_FAVOR'){cl='log-gol-atm';ic='⚽';} if(ev.tipo==='GOL_CONTRA'){cl='log-gol-rival';ic='🥅';} if(ev.tipo==='GOL_ANULADO'){cl='log-anulado';ic='🚫';}
                if(ev.tipo==='HITO'){ log.innerHTML=`<div class="log-item" style="background:#444;color:white;justify-content:center;"><strong>${ev.nom}</strong></div>` + log.innerHTML; return; }
                log.innerHTML=`<div class="log-item ${cl}"><div><strong>${ev.min}</strong> ${ev.nom} (${ev.pnom})</div><div>${ic}</div></div>`+log.innerHTML;
            });
            window.actualizarUI();
            if(st.crono.run) {
                st.crono.int = setInterval(() => { const now = Date.now(); const diff = Math.floor((now - st.crono.startTs)/1000); st.crono.seg = st.crono.savedSeg + diff; window.updCrono(); if(st.porteroActualId) { const delta = (now - st.crono.lastUpdate)/1000; if(delta > 0) { if(!st.minutosJugados[st.porteroActualId]) st.minutosJugados[st.porteroActualId] = 0; st.minutosJugados[st.porteroActualId] += delta; st.crono.lastUpdate = now; } } }, 1000);
            } else { window.updCrono(); document.getElementById('live-parte-txt').innerText = st.parteActual; }
            ['btn-start-partido','btn-fin-1','btn-ini-2','btn-fin-partido'].forEach(i=>document.getElementById(i).style.display='none');
            if(st.parteActual === 'Pre-Partido') document.getElementById('btn-start-partido').style.display='block'; else if(st.parteActual === '1ª Parte') document.getElementById('btn-fin-1').style.display='block'; else if(st.parteActual === 'Descanso') document.getElementById('btn-ini-2').style.display='block'; else if(st.parteActual === '2ª Parte') document.getElementById('btn-fin-partido').style.display='block';
            window.renderizarPanelAcciones();
        } else { localStorage.removeItem('guardian_live_backup'); }
    }
}
window.prepararVistaPreviaPDF = function() {
    const cfg = partidoLive.config;
    let analisisData = {};
    partidoLive.porterosJugaron.forEach(pid => { analisisData[pid] = { pos: document.getElementById('pos_'+pid).value || "", neg: document.getElementById('neg_'+pid).value || "", tras: document.getElementById('tras_'+pid).value || "" }; });
    db.collection("porteros").get().then(snap => {
        const ps = []; snap.forEach(d => ps.push({...d.data(), id:d.id}));
        const htmlContent = generarHTMLPartido(partidoLive, ps, analisisData);
        db.collection("partidos").add({ fecha: cfg.fecha, equipo: cfg.equipo, rival: cfg.rival, res: `${partidoLive.marcador.local}-${partidoLive.marcador.rival}`, raw: { ...partidoLive, analisis: analisisData }, htmlData: htmlContent, timestamp: Date.now() });
        document.getElementById('preview-content').innerHTML = htmlContent; document.getElementById('printable-area').innerHTML = htmlContent; document.getElementById('modal-pdf-preview').style.display = 'flex';
        window.cerrarModal('modal-fin-partido'); window.cambiarSeccion('partidos');
    });
}
function generarHTMLPartido(datos, listaP, anaData) {
    const cfg = datos.config; let porterosHTML = ''; let analisisHTML = '';
    datos.porterosJugaron.forEach(pid => {
        const p = listaP.find(x => x.id == pid); if(!p) return;
        const acs = datos.acciones.filter(a => a.pid == pid && a.tipo === 'ACCION');
        const ok = acs.filter(a => a.res === 'CORRECTO').length; const perc = acs.length ? Math.round((ok/acs.length)*100) : 0;
        const mins = Math.ceil((datos.minutosJugados[pid] || 0)/60);
        const foto = p.foto || "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjY2NjIiBzdHJva2Utd2lkdGg9IjEiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiLz48cGF0aCBkPSJNMTIgOGEzIDMgMCAxIDAgMCA2IDMgMyAwIDAgMCAwLTZ6bS01IDlsMTAgMGE3IDcgMCAwIDEtMTAgMHoiLz48L3N2Zz4=";
        porterosHTML += `<div class="pdf-portero-ficha"><img src="${foto}" class="pdf-portero-foto" style="width:50px!important; height:50px!important; object-fit:cover!important; border-radius:50%!important;"><div class="pdf-portero-datos"><h4>${p.nombre}</h4><p>${acs.length} Acciones (${perc}% Acierto) | ✅${ok} ❌${acs.length-ok} | ⏱️ ${mins}'</p></div></div>`;
        const a = anaData[pid] || {pos:'', neg:'', tras:''};
        analisisHTML += `<div class="pdf-obs-box"><div class="pdf-obs-header">${p.nombre} (${mins}')</div><div style="font-size:11px; margin-bottom:5px;"><strong>(+)</strong> ${a.pos||"-"}</div><div style="font-size:11px; margin-bottom:5px;"><strong>(-)</strong> ${a.neg||"-"}</div><div style="font-size:11px;"><strong>Trascendencia:</strong> ${a.tras||"-"}</div></div>`;
    });
    let cronoHTML = '';
    const sorted = [...datos.acciones].sort((a,b)=>a.seg - b.seg);
    sorted.forEach(ev => {
        if(ev.tipo === 'HITO') { cronoHTML += `<tr style="background:#444; color:white;"><td colspan="5" style="text-align:center; font-weight:bold;">${ev.nom}</td></tr>`; } 
        else {
            let resTxt = ev.res || '-'; let cl = '';
            if(ev.res === 'CORRECTO') resTxt = '<span class="text-success">CORRECTO</span>'; if(ev.res === 'ERROR') resTxt = '<span class="text-danger">ERROR</span>';
            if(ev.tipo === 'GOL_FAVOR') cl = 'pdf-crono-gol-atm'; if(ev.tipo === 'GOL_CONTRA') cl = 'pdf-crono-gol-rival';
            cronoHTML += `<tr class="${cl}"><td><strong>${ev.min}</strong></td><td class="pdf-crono-evento">${ev.nom}</td><td>${ev.pnom}</td><td>${resTxt}</td><td style="font-size:10px;">${ev.obs||''}</td></tr>`;
        }
    });
    return `<div class="pdf-container"><div class="pdf-header-pro"><img src="ESCUDO ATM.png" class="pdf-logo"><div class="pdf-title-box"><h1>ATLÉTICO DE MADRID</h1><h2>SEGUIMIENTO DE PORTEROS</h2></div></div><div class="pdf-divider-red"></div><div class="pdf-section-pro"><h3 class="pdf-section-title">INFORMACIÓN DEL PARTIDO</h3><table class="pdf-table-info"><tr><td><strong>Equipo:</strong> ${cfg.equipo}</td><td><strong>Categoría:</strong> ${cfg.tipo}</td><td><strong>Tipo:</strong> ${cfg.tipo}</td><td><strong>Jornada:</strong> ${cfg.jornada}</td></tr><tr><td><strong>Rival:</strong> ${cfg.rival}</td><td><strong>Fecha:</strong> ${cfg.fecha}</td><td><strong>Dificultad:</strong> ${cfg.dificultad}</td><td><strong>Entrenador:</strong> ${cfg.entrenador}</td></tr><tr><td><strong>Campo:</strong> ${cfg.campo}</td><td><strong>Condición:</strong> ${cfg.condicion}</td><td colspan="2"></td></tr><tr><td colspan="4" style="background-color: #f4f4f4; text-align: center; font-size: 14px; padding: 10px;"><strong>RESULTADO:</strong> ATM <span style="color:#CB3524; font-size:16px; font-weight:bold">${datos.marcador.local}</span> - <span style="color:#CB3524; font-size:16px; font-weight:bold">${datos.marcador.rival}</span> RIVAL</td></tr></table></div><div class="pdf-section-pro"><h3 class="pdf-section-title">PORTEROS Y ESTADÍSTICAS</h3>${porterosHTML}</div><div class="pdf-section-pro"><h3 class="pdf-section-title">REGISTRO CRONOLÓGICO</h3><table class="pdf-crono-table"><thead><tr><th>Min</th><th>Acción</th><th>Portero</th><th>Calif.</th><th>Obs.</th></tr></thead><tbody>${cronoHTML}</tbody></table></div><div class="pdf-section-pro"><h3 class="pdf-section-title">ANÁLISIS TÉCNICO INDIVIDUAL</h3>${analisisHTML}</div><div class="pdf-footer"><p>Guardian Lab ATM Pro - Informe Técnico</p></div></div>`;
}
window.imprimirPDFNativo = function() { window.print(); }
function cargarPartidosHistorial() {
    db.collection("partidos").orderBy("timestamp", "desc").onSnapshot(snap => {
        const c = document.getElementById('lista-partidos'); c.innerHTML = '';
        snap.forEach(doc => { const p = doc.data(); c.innerHTML += `<div class="match-card"><div><div class="card-title">${p.equipo} vs ${p.rival} (${p.res})</div><div class="card-subtitle">${p.fecha}</div></div><div><button class="btn-icon-action" onclick="window.abrirEdicionAnalisis('${doc.id}')"><span class="material-symbols-outlined" style="font-size:18px;">edit</span></button><button class="btn-icon-action" onclick="window.verPDFHistorial('${doc.id}')"><span class="material-symbols-outlined" style="font-size:18px;">description</span></button><button class="btn-icon-action" onclick="window.borrarHistorial('${doc.id}')"><span class="material-symbols-outlined" style="font-size:18px;">delete</span></button></div></div>`; });
        const liveBanner = document.getElementById('live-match-banner'); 
        if(partidoLive.parteActual !== 'Pre-Partido' && partidoLive.parteActual !== 'Final'){ liveBanner.style.display = 'block'; } else { liveBanner.style.display = 'none'; }
    });
}
window.verPDFHistorial = function(id) { db.collection("partidos").doc(String(id)).get().then(doc => { if(doc.exists) { document.getElementById('preview-content').innerHTML = doc.data().htmlData; document.getElementById('printable-area').innerHTML = doc.data().htmlData; document.getElementById('modal-pdf-preview').style.display = 'flex'; } }); }
window.borrarHistorial = function(id) { if(confirm("¿Borrar?")) db.collection("partidos").doc(String(id)).delete(); }
window.abrirEdicionAnalisis = function(id) {
    db.collection("partidos").doc(String(id)).get().then(doc => {
        if(!doc.exists) return;
        partidoEnEdicion = { ...doc.data(), id: doc.id };
        const container = document.getElementById('container-editar-analisis'); container.innerHTML = '';
        db.collection("porteros").get().then(snap => {
            const ps = []; snap.forEach(d => ps.push({...d.data(), id:d.id}));
            partidoEnEdicion.raw.porterosJugaron.forEach(pid => {
                const p = ps.find(x => x.id == pid); const nombre = p ? p.nombre : "Portero";
                const ana = partidoEnEdicion.raw.analisis[pid] || {pos:'', neg:'', tras:''};
                container.innerHTML += `<div class="pdf-obs-box"><div class="pdf-obs-header">EDITAR: ${nombre}</div><textarea id="edit_pos_${pid}" class="pdf-input-read" placeholder="Positivo...">${ana.pos}</textarea><textarea id="edit_neg_${pid}" class="pdf-input-read" placeholder="Negativo...">${ana.neg}</textarea><textarea id="edit_tras_${pid}" class="pdf-input-read" placeholder="Trascendencia...">${ana.tras}</textarea></div>`;
            });
            document.getElementById('modal-editar-analisis').style.display = 'flex';
        });
    });
}
window.guardarEdicionAnalisis = function() {
    if(!partidoEnEdicion) return;
    db.collection("porteros").get().then(snap => {
        const ps = []; snap.forEach(d => ps.push({...d.data(), id:d.id}));
        let newAna = {};
        partidoEnEdicion.raw.porterosJugaron.forEach(pid => { newAna[pid] = { pos: document.getElementById('edit_pos_'+pid).value, neg: document.getElementById('edit_neg_'+pid).value, tras: document.getElementById('edit_tras_'+pid).value }; });
        partidoEnEdicion.raw.analisis = newAna;
        const newHtml = generarHTMLPartido(partidoEnEdicion.raw, ps, newAna);
        db.collection("partidos").doc(String(partidoEnEdicion.id)).update({ raw: partidoEnEdicion.raw, htmlData: newHtml }).then(() => { alert("Actualizado"); document.getElementById('modal-editar-analisis').style.display='none'; });
    });
}
