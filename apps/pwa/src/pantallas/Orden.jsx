import { useEffect, useState } from 'react';
import { api, dinero } from '../api.js';
import { Alerta, Icono } from '../comunes.jsx';

const MENSAJES = {
  PAGADA: ['ok', 'Pago aprobado', 'Tus tickets con QR ya están listos. También te enviamos el comprobante por correo.'],
  PAGO_FALLIDO: ['', 'Pago rechazado', 'Tus cupos siguen apartados hasta que venza la reserva. Puedes intentarlo otra vez.'],
  EXPIRADA: ['', 'La reserva venció', 'No se completó el pago a tiempo y los cupos se liberaron.'],
  REEMBOLSADA: ['info', 'Pago devuelto', 'El cobro llegó cuando la reserva ya había vencido, así que se reembolsó automáticamente.'],
};

// Vuelta de la pasarela: se espera la confirmación del webhook (CU06 pasos 4-7)
export default function Orden({ id }) {
  const [orden, setOrden] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let vivo = true;
    let intentos = 0;
    const consultar = async () => {
      try {
        const o = await api(`/orders/orders/${id}`);
        if (!vivo) return;
        setOrden(o);
        if (o.estado === 'PENDIENTE_PAGO' && intentos++ < 60) setTimeout(consultar, 1500);
      } catch (e) {
        setError(e.message);
      }
    };
    consultar();
    return () => {
      vivo = false;
    };
  }, [id]);

  async function reintentar() {
    try {
      location.href = (await api(`/orders/orders/${id}/retry`, { method: 'POST' })).checkoutUrl;
    } catch (e) {
      setError(e.message);
    }
  }

  if (error) return <div className="pantalla"><Alerta>{error}</Alerta></div>;
  if (!orden) return <div className="pantalla"><p className="cargando">Consultando tu pago…</p></div>;
  const [tipo, titulo, texto] = MENSAJES[orden.estado] ?? ['info', 'Confirmando el pago…', 'La pasarela nos está avisando. Esto toma unos segundos.'];

  return (
    <div className="pantalla">
      <h1 className="titulo">{titulo}</h1>
      <Alerta tipo={tipo}>{texto}</Alerta>
      <div className="tarjeta">
        <strong>{orden.evento.titulo}</strong>
        {orden.items.map((i) => <div className="fila" key={i.tipoEntradaId}><span className="sub">{i.cantidad} × {i.nombre}</span><span>{dinero(i.precio * i.cantidad)}</span></div>)}
        {orden.descuento > 0 && <div className="fila" style={{ color: 'var(--ok-texto)', fontWeight: 600 }}><span>{orden.codigo}</span><span>−{dinero(orden.descuento)}</span></div>}
        <div className="separador" />
        <div className="fila" style={{ fontWeight: 700 }}><span>Total</span><span>{dinero(orden.total)}</span></div>
        <span className="ayuda">Orden {orden.id.slice(0, 8).toUpperCase()} · estado {orden.estado.replace('_', ' ').toLowerCase()}</span>
      </div>
      {orden.estado === 'PAGADA' && <a className="boton" href="#/tickets"><Icono nombre="ticket" />Ver mis tickets</a>}
      {orden.estado === 'PAGO_FALLIDO' && <button className="boton" onClick={reintentar}>Intentar de nuevo</button>}
      {['EXPIRADA', 'REEMBOLSADA'].includes(orden.estado) && <a className="boton contorno" href={`#/evento/${orden.evento.id}`}>Volver al evento</a>}
    </div>
  );
}
