import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, fechaCorta } from '../api.js';
import { guardarTickets, ticketsGuardados } from '../offline.js';
import { Alerta, Icono, Sello } from '../comunes.jsx';

const ESTADOS = { VALIDO: ['solida', 'Válido · sin usar'], USADO: ['gris', 'Ya usado'], INVALIDADO: ['roja', 'Anulado'] };

function Ticket({ t, n, total }) {
  const [qr, setQr] = useState('');
  useEffect(() => {
    QRCode.toDataURL(t.qr, { errorCorrectionLevel: 'M', margin: 1, width: 480 }).then(setQr);
  }, [t.qr]);
  const [clase, texto] = ESTADOS[t.estado] ?? ESTADOS.VALIDO;
  const numero = t.id.slice(0, 8).toUpperCase().replace(/(.{4})/, '$1-');
  return (
    <article className={`ticket${t.estado === 'VALIDO' ? '' : ' apagado'}`} aria-label={`Ticket ${n} de ${total}`}>
      <div className="ticket-cabeza">
        <span className="etiqueta">Entrada {t.tipo} · {n} de {total}</span>
        <strong style={{ fontSize: 19 }}>{t.evento.titulo}</strong>
        <span style={{ fontSize: 14, color: '#E3E4FD' }}>{fechaCorta(t.evento.fecha)} · {t.evento.lugar}, {t.evento.ciudad}</span>
      </div>
      <div className="ticket-cuerpo">
        {qr && <img src={qr} alt={`Código QR firmado del ticket ${numero}`} />}
        <span className={`insignia ${clase}`} style={{ fontSize: 15, padding: '8px 14px' }}>{texto}{t.motivo ? `: ${t.motivo}` : ''}</span>
        <div className="fila" style={{ width: '100%', fontSize: 13, color: 'var(--tenue)' }}>
          <span>Titular: <strong style={{ color: 'var(--tinta)' }}>{t.titular}</strong></span>
          <span>N.º {numero}</span>
        </div>
      </div>
      <div className="ticket-pie">
        <div className="botones">
          <a className="boton oscuro" href={qr} download={`ticket-${numero}.png`} style={{ minHeight: 48 }}><Icono nombre="descargar" tam={18} />Descargar</a>
          <button className="boton" disabled style={{ minHeight: 48, fontSize: 14 }}>Transferir · próximamente</button>
        </div>
      </div>
    </article>
  );
}

// Pantalla 4 · CU08 · RF17, RF18: los tickets quedan en el teléfono y se ven en modo avión
export default function Tickets({ usuario }) {
  const [tickets, setTickets] = useState(null);
  const [sinConexion, setSinConexion] = useState(false);

  useEffect(() => {
    (async () => {
      if (usuario) {
        try {
          const lista = await api('/tickets/me/tickets');
          await guardarTickets(lista);
          setTickets(lista);
          return;
        } catch {
          // sin red: se muestran los guardados
        }
      }
      setTickets(await ticketsGuardados());
      setSinConexion(true);
    })();
  }, [usuario]);

  return (
    <div className="pantalla">
      <div className="cabecera">
        <h1 className="titulo">Mis tickets</h1>
        <span className="insignia verde" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icono nombre="descargar" tam={16} />Guardados sin conexión</span>
      </div>
      {sinConexion && <Alerta tipo="info">Estás viendo los tickets guardados en este teléfono.{!usuario && ' Inicia sesión para actualizarlos.'}</Alerta>}
      {tickets === null && <p className="cargando">Cargando…</p>}
      {tickets?.length === 0 && <p className="vacio">Aún no tienes tickets. <a href="#/catalogo">Explora eventos</a></p>}
      <div className="rejilla dos">{tickets?.map((t, i) => <Ticket key={t.id} t={t} n={i + 1} total={tickets.length} />)}</div>
      <Sello suave lineas={[
        ['escudo', 'QR firmado digitalmente. Un QR alterado o inventado se rechaza en la puerta.'],
        ['alerta', 'Un solo ingreso: no compartas capturas, quien entra primero usa el ticket.'],
      ]} />
    </div>
  );
}
