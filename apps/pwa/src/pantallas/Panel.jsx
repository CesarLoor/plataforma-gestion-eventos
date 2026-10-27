import { useEffect, useState } from 'react';
import { api, descargar, dinero, hora } from '../api.js';
import { Alerta, Icono, Sello } from '../comunes.jsx';

// Pantalla 5 · CU10, CU13, CU14, CU15 · RF04, RF25, RF26
export default function Panel() {
  const [eventos, setEventos] = useState(null);
  const [elegido, setElegido] = useState('');
  const [tablero, setTablero] = useState(null);
  const [mensaje, setMensaje] = useState(null);

  const cargarEventos = () => api('/catalog/mine').then((l) => {
    setEventos(l);
    setElegido((e) => e || l.find((x) => x.estado === 'PUBLICADO')?.id || l[0]?.id || '');
  });
  useEffect(() => {
    cargarEventos().catch((e) => setMensaje(['', e.message]));
  }, []);

  const evento = eventos?.find((e) => e.id === elegido);
  useEffect(() => {
    if (!evento || evento.estado === 'BORRADOR') return setTablero(null);
    let vivo = true;
    const traer = () => api(`/reports/events/${evento.id}/dashboard`).then((d) => vivo && setTablero(d)).catch(() => {});
    traer();
    const t = setInterval(traer, 10_000); // RNF/OE5: el panel se actualiza en menos de 1 minuto
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [evento?.id, evento?.estado]);

  async function accion(ruta, confirmacion, exito) {
    if (confirmacion && !confirm(confirmacion)) return;
    try {
      await api(`/catalog/events/${evento.id}/${ruta}`, { method: 'POST' });
      setMensaje(['ok', exito]);
      await cargarEventos();
    } catch (e) {
      setMensaje(['', e.message]);
    }
  }

  if (!eventos) return <div className="pantalla">{mensaje ? <Alerta>{mensaje[1]}</Alerta> : <p className="cargando">Cargando…</p>}</div>;

  return (
    <div className="pantalla">
      <div className="cabecera">
        <span className="etiqueta">Panel del organizador</span>
        <a className="boton" href="#/panel/nuevo" style={{ minHeight: 44, fontSize: 14 }}>Crear evento</a>
      </div>
      {eventos.length === 0 ? <p className="vacio">Todavía no tienes eventos.</p> : (
        <div className="campo">
          <label htmlFor="evento">Evento</label>
          <select id="evento" value={elegido} onChange={(e) => { setElegido(e.target.value); setMensaje(null); }}>
            {eventos.map((e) => <option key={e.id} value={e.id}>{e.titulo} · {e.estado.toLowerCase()}</option>)}
          </select>
        </div>
      )}
      {mensaje && <Alerta tipo={mensaje[0]}>{mensaje[1]}</Alerta>}
      {evento && (
        <>
          <div>
            <h1 className="titulo chico">{evento.titulo}</h1>
            {tablero && <span className="sub" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--ok)' }} />En vivo · actualizado {hora(tablero.actualizadoEn)}
            </span>}
          </div>
          {evento.estado === 'BORRADOR' && (
            <>
              <Alerta tipo="info">Borrador: todavía no aparece en el catálogo.</Alerta>
              <button className="boton" onClick={() => accion('publish', null, 'Evento publicado: ya se puede comprar.')}>Publicar evento</button>
            </>
          )}
          {evento.estado === 'CANCELADO' && <Alerta>Evento cancelado: sus tickets quedaron anulados y las compras se reembolsaron.</Alerta>}
          {tablero && (
            <>
              <div className="kpis">
                <div className="kpi"><span>Entradas vendidas</span><strong>{tablero.vendidas}<small> / {tablero.aforo}</small></strong></div>
                <div className="kpi"><span>Recaudado</span><strong>{dinero(tablero.recaudado)}</strong></div>
                <div className="kpi"><span>Aforo ocupado</span><strong>{tablero.ocupacion} %</strong><div className="barra fina"><div style={{ width: `${tablero.ocupacion}%` }} /></div></div>
                <div className="kpi"><span>Ya ingresaron</span><strong>{tablero.ingresos}</strong><div className="barra fina"><div style={{ width: `${tablero.vendidas ? (tablero.ingresos / tablero.vendidas) * 100 : 0}%`, background: 'var(--ok)' }} /></div></div>
              </div>
              <div className="tarjeta" style={{ gap: 14 }}>
                <h2 style={{ margin: 0, fontSize: 15 }}>Ventas por tipo de entrada</h2>
                {tablero.porTipo.map((t) => (
                  <div key={t.nombre} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div className="fila" style={{ fontSize: 14 }}><strong>{t.nombre} · {dinero(t.precio)}</strong><span>{t.vendidas} / {t.cupo}</span></div>
                    <div className="barra"><div style={{ width: `${(t.vendidas / t.cupo) * 100}%` }} /></div>
                  </div>
                ))}
                {tablero.reembolsadas > 0 && <span className="ayuda">{tablero.reembolsadas} órdenes reembolsadas.</span>}
              </div>
            </>
          )}
          <Sello suave lineas={[
            ['escudo', 'Solo tú, como organizador de este evento, ves estos datos. Los compradores aparecen resumidos, sin datos de pago.'],
            ['panel', 'Reembolsos, cancelaciones y cambios de rol quedan registrados en la bitácora.'],
          ]} />
          {evento.estado === 'PUBLICADO' && (
            <div className="botones">
              <button className="boton oscuro" onClick={() => descargar(`/reports/events/${evento.id}/export.csv`, `ventas-${evento.id.slice(0, 8)}.csv`).catch((e) => setMensaje(['', e.message]))}>
                <Icono nombre="descargar" tam={18} />Exportar CSV
              </button>
              <button className="boton peligro" onClick={() => accion('cancel', `¿Cancelar "${evento.titulo}"? Se anulan todos los tickets y se reembolsan las compras.`, 'Evento cancelado. Se están procesando los reembolsos.')}>
                Cancelar evento
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
