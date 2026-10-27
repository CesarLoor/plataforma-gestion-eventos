import { useEffect, useState } from 'react';
import { api, dinero } from '../api.js';
import { Alerta, Icono, Volver } from '../comunes.jsx';

const DURACION = 10 * 60;

// Pantalla 3 · CU06 · RF08, RF12, RF14: cuenta regresiva de la reserva y paso a la pasarela
export default function Pago({ reservaId, usuario }) {
  const [reserva, setReserva] = useState(null);
  const [evento, setEvento] = useState(null);
  const [restante, setRestante] = useState(null);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const codigo = sessionStorage.getItem(`codigo:${reservaId}`) || undefined;

  useEffect(() => {
    api(`/inventory/reservations/${reservaId}`)
      .then(async (r) => {
        setReserva(r);
        setEvento(await api(`/catalog/events/${r.eventoId}`));
      })
      .catch((e) => setError(e.message));
  }, [reservaId]);

  useEffect(() => {
    if (!reserva) return;
    const tic = () => setRestante(Math.max(0, Math.round((new Date(reserva.expiraEn) - Date.now()) / 1000)));
    tic();
    const t = setInterval(tic, 1000);
    return () => clearInterval(t);
  }, [reserva]);

  async function pagar(e) {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(e.currentTarget));
    setEnviando(true);
    setError('');
    try {
      const orden = await api('/orders/orders', { method: 'POST', body: { reservaId, codigo, nombre: datos.nombre, correo: datos.correo, aceptaTerminos: datos.terminos === 'on' } });
      location.href = orden.checkoutUrl; // la tarjeta se escribe en la pasarela, nunca en esta app (RN09)
    } catch (err) {
      setError(err.message);
      setEnviando(false);
    }
  }

  if (!reserva || !evento) return <div className="pantalla">{error ? <Alerta>{error}</Alerta> : <p className="cargando">Cargando tu reserva…</p>}</div>;
  const lineas = reserva.items.map((i) => ({ ...i, tipo: evento.tipos.find((t) => t.id === i.tipoEntradaId) }));
  const subtotal = lineas.reduce((s, l) => s + l.tipo.precio * l.cantidad, 0);
  const vencida = restante === 0 || reserva.estado !== 'ACTIVA';
  const mmss = `${String(Math.floor((restante ?? 0) / 60)).padStart(2, '0')}:${String((restante ?? 0) % 60).padStart(2, '0')}`;
  const entradas = lineas.reduce((s, l) => s + l.cantidad, 0);

  return (
    <div className="detalle-cuerpo">
      <div className="pantalla con-pie" style={{ paddingTop: 24 }}>
        <div className="cabecera" style={{ justifyContent: 'flex-start' }}>
          <Volver a={`evento/${evento.id}`} etiqueta="Volver al evento" />
          <h1 className="titulo" style={{ fontSize: 24 }}>Confirma tu compra</h1>
        </div>
        {vencida ? (
          <Alerta>La reserva venció y los cupos volvieron a estar disponibles. <a href={`#/evento/${evento.id}`}>Reservar de nuevo</a></Alerta>
        ) : (
          <div className="temporizador" role="timer" aria-label={`Tiempo restante de la reserva: ${mmss}`}>
            <div className="fila">
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
                <span style={{ color: 'var(--ambar)', display: 'flex' }}><Icono nombre="reloj" tam={18} /></span>
                Tus {entradas} {entradas === 1 ? 'cupo está apartado' : 'cupos están apartados'}
              </span>
              <span className="reloj">{mmss}</span>
            </div>
            <div className="progreso"><div style={{ width: `${((restante ?? 0) / DURACION) * 100}%` }} /></div>
            <span style={{ fontSize: 13, color: '#C9CED6' }}>Si no pagas a tiempo, los cupos vuelven a estar disponibles.</span>
          </div>
        )}
        <div className="tarjeta" style={{ fontSize: 14 }}>
          <strong style={{ fontSize: 16 }}>{evento.titulo}</strong>
          {lineas.map((l) => (
            <div className="fila" key={l.tipoEntradaId}><span className="sub" style={{ fontSize: 14 }}>{l.cantidad} × {l.tipo.nombre}</span><span>{dinero(l.tipo.precio * l.cantidad)}</span></div>
          ))}
          {codigo && <div className="fila" style={{ color: 'var(--ok-texto)', fontWeight: 600 }}><span>Código {codigo}</span><span>se aplica al pagar</span></div>}
          <div className="separador" />
          <div className="fila" style={{ fontWeight: 700, fontSize: 16 }}><span>Subtotal</span><span>{dinero(subtotal)}</span></div>
        </div>
        {error && <Alerta>{error}</Alerta>}
        <form id="form-pago" onSubmit={pagar} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="campo">
            <label htmlFor="nombre">Nombre del comprador</label>
            <input id="nombre" name="nombre" defaultValue={usuario?.nombre} autoComplete="name" required minLength={2} maxLength={80} />
          </div>
          <div className="campo">
            <label htmlFor="correo">Correo para el comprobante</label>
            <input id="correo" name="correo" type="email" defaultValue={usuario?.correo} autoComplete="email" required maxLength={120} />
          </div>
          <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', gap: 8 }}>
            <legend className="leyenda" style={{ marginBottom: 6, padding: 0 }}>Forma de pago</legend>
            <label className="tipo elegido" style={{ flex: 1, minHeight: 48, justifyContent: 'flex-start', fontWeight: 700, fontSize: 14 }}>
              <input type="radio" name="metodo" defaultChecked style={{ accentColor: 'var(--acento)', width: 18, height: 18 }} /> Tarjeta
            </label>
            <label className="tipo" style={{ flex: 1, minHeight: 48, justifyContent: 'flex-start', fontSize: 14, color: 'var(--tenue)', background: 'var(--fondo)' }}>
              <input type="radio" name="metodo" disabled style={{ width: 18, height: 18 }} /> Transferencia · próximamente
            </label>
          </fieldset>
          <label className="casilla">
            <input type="checkbox" name="terminos" required />
            <span>Acepto los términos y la política de datos personales (LOPDP). Solo se usan mi nombre y correo para esta compra.</span>
          </label>
        </form>
      </div>
      <div className="pie-fijo">
        <div className="sello-linea" style={{ fontSize: 13 }}>
          <Icono nombre="candado" tam={18} />
          <span>Pagarás en la pasarela de pagos (modo de pruebas). Nunca vemos ni guardamos los datos de tu tarjeta, y un pago no se cobra dos veces.</span>
        </div>
        <button className="boton" form="form-pago" disabled={vencida || enviando}>{enviando ? 'Abriendo la pasarela…' : 'Ir a pagar'}</button>
      </div>
    </div>
  );
}
