import { useEffect, useState } from 'react';
import { api, dinero } from '../api.js';
import { Alerta, Icono, Volver, ir } from '../comunes.jsx';

// Pantalla 2 · CU03, CU04, CU05 · RF05, RF07, RF08, RF13
export default function Detalle({ id, usuario }) {
  const [evento, setEvento] = useState(null);
  const [cupos, setCupos] = useState({});
  const [cantidades, setCantidades] = useState({});
  const [codigo, setCodigo] = useState('');
  const [descuento, setDescuento] = useState(null);
  const [error, setError] = useState('');
  const [reservando, setReservando] = useState(false);

  const cargarCupos = async () => setCupos(Object.fromEntries((await api(`/inventory/availability/${id}`)).map((c) => [c.tipoEntradaId, c.disponible])));
  useEffect(() => {
    api(`/catalog/events/${id}`).then(setEvento).catch((e) => setError(e.message));
    cargarCupos().catch(() => {});
  }, [id]);

  if (!evento) return <div className="pantalla">{error ? <Alerta>{error}</Alerta> : <p className="cargando">Cargando…</p>}</div>;

  const cambiar = (tipoId, delta) => setCantidades((c) => ({ ...c, [tipoId]: Math.max(0, Math.min((c[tipoId] ?? 0) + delta, cupos[tipoId] ?? 0, 10)) }));
  const items = evento.tipos.filter((t) => cantidades[t.id] > 0).map((t) => ({ tipoEntradaId: t.id, cantidad: cantidades[t.id], precio: t.precio }));
  const subtotal = items.reduce((s, i) => s + i.precio * i.cantidad, 0);
  const rebaja = !descuento?.valido ? 0 : descuento.porcentaje ? (subtotal * descuento.porcentaje) / 100 : Math.min(subtotal, descuento.monto);
  const entradas = items.reduce((s, i) => s + i.cantidad, 0);

  async function aplicar() {
    if (!codigo.trim()) return;
    const d = await api(`/catalog/events/${id}/discounts/${encodeURIComponent(codigo.trim())}`).catch(() => ({ valido: false }));
    setDescuento(d);
  }

  async function reservar() {
    if (!usuario) return ir(`login?volver=${encodeURIComponent(`evento/${id}`)}`);
    setReservando(true);
    setError('');
    try {
      const r = await api('/inventory/reservations', { method: 'POST', body: { eventoId: id, items: items.map(({ tipoEntradaId, cantidad }) => ({ tipoEntradaId, cantidad })) } });
      sessionStorage.setItem(`codigo:${r.id}`, descuento?.valido ? descuento.codigo : '');
      ir(`pago/${r.id}`);
    } catch (e) {
      // CU03 5a: se agotaron mientras elegía; se actualizan los cupos para proponer una cantidad menor
      setError(e.status === 429 ? 'Demasiadas reservas seguidas desde esta conexión. Espera un minuto.' : e.message);
      await cargarCupos().catch(() => {});
      setCantidades({});
    } finally {
      setReservando(false);
    }
  }

  const cancelado = evento.estado === 'CANCELADO';
  return (
    <>
      <div className={`banda portada ${evento.categoria}`} style={{ height: 168, flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'space-between', padding: 20 }}>
        <Volver a="catalogo" etiqueta="Volver al catálogo" />
        <span>{evento.categoria} · Organiza {evento.organizador}</span>
      </div>
      <div className="detalle-cuerpo">
      <div className="pantalla con-pie" style={{ paddingTop: 18 }}>
        <div>
          <h1 className="titulo" style={{ fontSize: 26 }}>{evento.titulo}</h1>
          <p className="sub" style={{ fontSize: 14 }}>{new Date(evento.fecha).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'full', timeStyle: 'short' })}</p>
          <p className="sub" style={{ fontSize: 14 }}>{evento.lugar}, {evento.ciudad}</p>
        </div>
        {evento.descripcion && <p className="sub">{evento.descripcion}</p>}
        {cancelado && <Alerta>Este evento fue cancelado. Las compras se reembolsaron.</Alerta>}
        {error && <Alerta>{error}</Alerta>}
        <h2 style={{ margin: 0, fontSize: 15 }}>Elige tus entradas</h2>
        {evento.tipos.map((t) => {
          const quedan = cupos[t.id] ?? 0;
          const n = cantidades[t.id] ?? 0;
          return (
            <div key={t.id} className={`tipo${n ? ' elegido' : ''}`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <strong>{t.nombre} · {dinero(t.precio)}</strong>
                <span style={{ fontSize: 13, fontWeight: quedan <= 10 ? 700 : 400, color: quedan === 0 ? 'var(--tenue)' : quedan <= 10 ? 'var(--ambar-texto)' : 'var(--tenue)' }}>
                  {quedan === 0 ? 'Agotado' : quedan <= 10 ? `¡Solo quedan ${quedan}!` : `Quedan ${quedan} de ${t.cupo}`}
                </span>
              </div>
              <div className="stepper">
                <button type="button" aria-label={`Quitar una entrada ${t.nombre}`} disabled={!n} onClick={() => cambiar(t.id, -1)}>−</button>
                <output aria-live="polite">{n}</output>
                <button type="button" className={n || quedan ? 'mas' : ''} aria-label={`Agregar una entrada ${t.nombre}`} disabled={cancelado || n >= Math.min(quedan, 10)} onClick={() => cambiar(t.id, 1)}>+</button>
              </div>
            </div>
          );
        })}
        <div className="campo">
          <label htmlFor="codigo">Código de descuento</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="codigo" style={{ flex: 1, letterSpacing: 1, fontWeight: 600, textTransform: 'uppercase' }} value={codigo} maxLength={20} onChange={(e) => { setCodigo(e.target.value); setDescuento(null); }} />
            <button type="button" className="boton contorno" style={{ minHeight: 48 }} onClick={aplicar}>Aplicar</button>
          </div>
          {descuento?.valido && <span className="ayuda" style={{ color: 'var(--ok-texto)', fontWeight: 600 }}>{descuento.codigo} aplicado: {descuento.porcentaje ? `${descuento.porcentaje} % de descuento` : `${dinero(descuento.monto)} menos`}</span>}
          {descuento && !descuento.valido && <span className="ayuda" style={{ color: 'var(--peligro)', fontWeight: 600 }}>Código no válido o vencido: se cobra sin descuento.</span>}
        </div>
      </div>
      <div className="pie-fijo">
        <div className="sello-linea" style={{ fontSize: 13 }}>
          <Icono nombre="escudo" tam={18} />
          <span>Cupos en tiempo real. Al reservar quedan apartados para ti 10 minutos: nadie más puede comprarlos.</span>
        </div>
        <div className="fila">
          <span className="sub" style={{ fontSize: 14 }}>{entradas} {entradas === 1 ? 'entrada' : 'entradas'}{rebaja > 0 && <> · <s>{dinero(subtotal)}</s></>}</span>
          <span className="total">{dinero(subtotal - rebaja)}</span>
        </div>
        <button className="boton" disabled={!entradas || reservando || cancelado} onClick={reservar}>{reservando ? 'Reservando…' : 'Reservar y pagar'}</button>
      </div>
      </div>
    </>
  );
}
