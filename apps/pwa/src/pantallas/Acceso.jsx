import { useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader } from '@zxing/browser';
import { api, hora } from '../api.js';
import { guardarPaquete, limpiarPendientes, paqueteGuardado, pendientes, validarSinConexion } from '../offline.js';
import { Alerta, Icono, Sello, useEnLinea } from '../comunes.jsx';

const RESULTADOS = {
  VALIDO: ['valido', 'Ingreso permitido'],
  USADO: ['usado', 'Ya fue usado'],
  INVALIDO: ['invalido', 'Ticket inválido'],
};

function idDispositivo() {
  try {
    let id = localStorage.getItem('dispositivo');
    if (!id) localStorage.setItem('dispositivo', (id = `lector-${crypto.randomUUID().slice(0, 8)}`));
    return id;
  } catch {
    return 'lector-sin-id';
  }
}

const tidDe = (qr) => {
  try {
    return JSON.parse(atob(qr.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))).tid;
  } catch {
    return null;
  }
};

// Pantalla 6 · CU20-CU25 · RF21, RF22, RF23: validación en línea o sin conexión, con sincronización posterior
export default function Acceso() {
  const enLinea = useEnLinea();
  const [forzarLocal, setForzarLocal] = useState(false);
  const local = forzarLocal || !enLinea;
  const [eventos, setEventos] = useState([]);
  const [eventoId, setEventoId] = useState('');
  const [paquete, setPaquete] = useState(null);
  const [cola, setCola] = useState([]);
  const [resultado, setResultado] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [camara, setCamara] = useState(false);
  const [manual, setManual] = useState('');
  const video = useRef(null);
  const ultimo = useRef({ qr: '', t: 0 });

  useEffect(() => {
    api('/catalog/events').then((l) => {
      setEventos(l);
      setEventoId((e) => e || l[0]?.id || '');
    }).catch(() => setAviso(['info', 'Sin conexión: elige un evento cuya lista ya esté guardada.']));
    pendientes().then(setCola);
  }, []);

  const actualizarResumen = () => eventoId && !local && api(`/checkin/events/${eventoId}/summary`).then(setResumen).catch(() => {});
  useEffect(() => {
    if (!eventoId) return;
    paqueteGuardado(eventoId).then((p) => setPaquete(p ?? null));
    actualizarResumen();
  }, [eventoId, local]);

  async function descargarLista() {
    try {
      const p = await api(`/checkin/events/${eventoId}/offline-package`);
      await guardarPaquete(p);
      setPaquete(p);
      setAviso(['ok', `Lista guardada: ${p.tickets.length} tickets. Ya puedes validar sin conexión.`]);
    } catch (e) {
      setAviso(['', e.message]);
    }
  }

  async function validar(qr) {
    qr = qr.trim();
    if (!qr || !eventoId) return;
    const ahora = Date.now();
    if (qr === ultimo.current.qr && ahora - ultimo.current.t < 3000) return; // evita leer dos veces el mismo QR seguido
    ultimo.current = { qr, t: ahora };
    let r = null;
    if (!local) {
      r = await api('/checkin/validate', { method: 'POST', body: { qr, eventoId, dispositivo: idDispositivo() } }).catch((e) => (e instanceof TypeError ? null : { resultado: 'INVALIDO', motivo: e.message }));
      // Se refleja en la lista local para que el modo sin conexión no deje pasar el mismo ticket
      if (r?.resultado === 'VALIDO' && paquete) {
        const t = paquete.tickets.find((x) => x.tid === tidDe(qr));
        if (t) {
          t.ingresoEn = r.ingresoEn;
          await guardarPaquete(paquete);
        }
      }
    }
    if (!r) {
      if (!paquete) {
        setResultado({ resultado: 'INVALIDO', motivo: 'Sin conexión y sin la lista del evento: descárgala antes de abrir la puerta.' });
        return;
      }
      r = await validarSinConexion(qr, paquete);
      setPaquete({ ...paquete });
      setCola(await pendientes());
    }
    setResultado(r);
    navigator.vibrate?.(r.resultado === 'VALIDO' ? 80 : [60, 60, 60]);
    actualizarResumen();
  }

  useEffect(() => {
    if (!camara) return;
    let controles;
    new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 250 })
      .decodeFromVideoDevice(undefined, video.current, (res) => res && validar(res.getText()))
      .then((c) => (controles = c))
      .catch(() => {
        setAviso(['', 'No se pudo abrir la cámara. Revisa el permiso o pega el código del ticket abajo.']);
        setCamara(false);
      });
    return () => controles?.stop();
  }, [camara, eventoId, local, paquete]);

  async function sincronizar() {
    try {
      const r = await api('/checkin/sync', { method: 'POST', body: { dispositivo: idDispositivo(), registros: cola } });
      await limpiarPendientes();
      setCola([]);
      setAviso(r.duplicados
        ? ['', `Sincronizado. ${r.duplicados} ticket(s) ya habían entrado por otra puerta: revisa los duplicados.`]
        : ['ok', `Sincronizados ${r.resultados.length} ingresos sin duplicados.`]);
      await descargarLista();
      actualizarResumen();
    } catch (e) {
      setAviso(['', e.message]);
    }
  }

  const ingresosLocales = paquete?.tickets.filter((t) => t.ingresoEn).length ?? 0;
  const [icono, titulo] = resultado ? RESULTADOS[resultado.resultado] : [];
  const evento = eventos.find((e) => e.id === eventoId);

  return (
    <div className="pantalla">
      <div className="cabecera" style={{ alignItems: 'flex-start' }}>
        <div>
          <span className="etiqueta">Control de acceso</span>
          <h1 className="titulo chico">{evento?.titulo ?? 'Elige el evento'}</h1>
        </div>
        <span className={`conexion ${local ? 'sin-red' : 'en-linea'}`}>
          <Icono nombre={local ? 'sinRed' : 'ok'} tam={14} grosor={2.4} />{local ? 'Sin conexión' : 'En línea'}
        </span>
      </div>
      {eventos.length > 0 && (
        <div className="campo">
          <label htmlFor="evento-acceso">Evento</label>
          <select id="evento-acceso" value={eventoId} onChange={(e) => { setEventoId(e.target.value); setResultado(null); }}>
            {eventos.map((e) => <option key={e.id} value={e.id}>{e.titulo}</option>)}
          </select>
        </div>
      )}
      {aviso && <Alerta tipo={aviso[0]}>{aviso[1]}</Alerta>}

      <div className="camara">
        {camara ? <video ref={video} muted playsInline aria-label="Vista de la cámara" /> : (
          <button className="boton" onClick={() => { setAviso(null); setCamara(true); }}><Icono nombre="escaner" />Abrir cámara</button>
        )}
        {camara && <><div className="marco" aria-hidden="true" /><span className="aviso-camara">Apunta la cámara al código QR</span></>}
      </div>

      {resultado && (
        <div role="status" className={`resultado ${resultado.resultado}`}>
          <Icono nombre={icono} tam={52} grosor={2.4} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <strong>{titulo}</strong>
            {resultado.titular && <span>{resultado.tipo} · {resultado.titular}</span>}
            {resultado.resultado === 'VALIDO' && <span style={{ fontSize: 13 }}>Firma verificada · {resultado.local ? 'registrado en este teléfono' : 'registrado'} {hora(resultado.ingresoEn)}</span>}
            {resultado.resultado === 'USADO' && <span style={{ fontSize: 13 }}>Primer ingreso: {hora(resultado.primerIngreso)}. No dejes pasar.</span>}
            {resultado.motivo && <span style={{ fontSize: 13 }}>{resultado.motivo}</span>}
          </div>
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); validar(manual); setManual(''); }} className="campo">
        <label htmlFor="manual">O pega el código del ticket</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input id="manual" style={{ flex: 1 }} value={manual} onChange={(e) => setManual(e.target.value)} autoComplete="off" />
          <button className="boton contorno" style={{ minHeight: 48 }}>Validar</button>
        </div>
      </form>

      <div className="kpis">
        <div className="kpi"><span>Ingresos</span><strong>{local ? ingresosLocales : resumen?.ingresos ?? '—'}<small>{!local && resumen ? ` / ${resumen.emitidos}` : ''}</small></strong></div>
        <div className="kpi"><span>Por sincronizar</span><strong style={{ color: cola.length ? 'var(--ambar-texto)' : undefined }}>{cola.length}</strong></div>
      </div>

      <div className="botones">
        <button className="boton contorno" onClick={descargarLista} disabled={local || !eventoId}>
          <Icono nombre="descargar" tam={18} />{paquete ? 'Actualizar lista' : 'Guardar lista'}
        </button>
        <button className="boton oscuro" onClick={sincronizar} disabled={local || !cola.length}>
          <Icono nombre="sincronizar" tam={18} />Sincronizar {cola.length || ''}
        </button>
      </div>
      {paquete && <span className="ayuda">Lista guardada a las {hora(paquete.generadoEn)} con {paquete.tickets.length} tickets.</span>}
      <label className="casilla">
        <input type="checkbox" checked={forzarLocal} onChange={(e) => setForzarLocal(e.target.checked)} />
        <span>Simular sin conexión (para la demostración)</span>
      </label>
      <Sello lineas={[['escudo', 'Sin internet se valida la firma con la lista guardada del evento. Al volver la conexión se sincroniza y se marcan los duplicados.']]} />
    </div>
  );
}
