import { useEffect, useState } from 'react';
import { api, fechaCorta } from '../api.js';
import { Alerta, Sello } from '../comunes.jsx';

// Pantalla 7 · CU17, CU18 · RF03, RF27, RF28: usuarios, roles y eventos
const ROLES = { ASISTENTE: 'Asistente', ORGANIZADOR: 'Organizador', ACCESO: 'Personal de acceso', ADMIN: 'Administración' };

export default function Admin({ usuario }) {
  const [pestana, setPestana] = useState('usuarios');
  const [usuarios, setUsuarios] = useState(null);
  const [eventos, setEventos] = useState(null);
  const [filtro, setFiltro] = useState('');
  const [cambios, setCambios] = useState({}); // id -> { rol, motivo }
  const [mensaje, setMensaje] = useState(null);

  const cargar = () => api('/auth/users').then(setUsuarios).catch((e) => setMensaje(['', e.message]));
  useEffect(() => {
    cargar();
    api('/catalog/mine').then(setEventos).catch(() => setEventos([]));
  }, []);

  async function guardar(u) {
    const { rol, motivo = '' } = cambios[u.id];
    if (motivo.trim().length < 5) return setMensaje(['', 'Escribe el motivo del cambio (queda en la bitácora).']);
    try {
      await api(`/auth/users/${u.id}/role`, { method: 'PATCH', body: { rol, motivo: motivo.trim() } });
      setMensaje(['ok', `${u.nombre} ahora es ${ROLES[rol]}. El cambio quedó en la bitácora.`]);
      setCambios(({ [u.id]: _, ...resto }) => resto);
      cargar();
    } catch (e) {
      setMensaje(['', e.message]);
    }
  }

  const f = filtro.toLowerCase();
  const lista = usuarios?.filter((u) => `${u.nombre} ${u.correo}`.toLowerCase().includes(f));

  return (
    <div className="pantalla">
      <h1 className="titulo">Administración</h1>
      <div className="fila" role="tablist" style={{ justifyContent: 'flex-start' }}>
        {[['usuarios', 'Usuarios y roles'], ['eventos', 'Eventos']].map(([id, texto]) => (
          <button key={id} role="tab" aria-selected={pestana === id} className={`boton ${pestana === id ? '' : 'contorno'}`} onClick={() => setPestana(id)}>{texto}</button>
        ))}
      </div>
      {mensaje && <Alerta tipo={mensaje[0]}>{mensaje[1]}</Alerta>}

      {pestana === 'usuarios' && (
        <>
          <div className="campo">
            <label htmlFor="buscar-u">Buscar cuenta</label>
            <input id="buscar-u" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Nombre o correo" />
          </div>
          {!lista && <p className="sub">Cargando…</p>}
          {lista?.map((u) => {
            const c = cambios[u.id];
            return (
              <div className="tarjeta" key={u.id}>
                <div className="fila">
                  <strong>{u.nombre}</strong>
                  <span className={`insignia ${u.bloqueado ? 'ambar' : 'verde'}`}>{u.bloqueado ? 'Bloqueada' : ROLES[u.rol]}</span>
                </div>
                <span className="sub">{u.correo} · desde {fechaCorta(u.creado_en)}</span>
                {u.id !== usuario.id && (
                  <div className="campo">
                    <label htmlFor={`rol-${u.id}`}>Rol</label>
                    <select id={`rol-${u.id}`} value={c?.rol ?? u.rol} onChange={(e) => setCambios({ ...cambios, [u.id]: { ...c, rol: e.target.value } })}>
                      {Object.entries(ROLES).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                    </select>
                    {c && c.rol !== u.rol && (
                      <>
                        <label htmlFor={`motivo-${u.id}`}>Motivo del cambio</label>
                        <input id={`motivo-${u.id}`} value={c.motivo ?? ''} onChange={(e) => setCambios({ ...cambios, [u.id]: { ...c, motivo: e.target.value } })} />
                        <button className="boton" onClick={() => guardar(u)}>Guardar cambio de rol</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {pestana === 'eventos' && (
        <>
          {!eventos && <p className="sub">Cargando…</p>}
          {eventos?.map((e) => (
            <div className="tarjeta" key={e.id}>
              <div className="fila"><strong>{e.titulo}</strong><span className="insignia gris">{e.estado}</span></div>
              <span className="sub">{e.ciudad} · {fechaCorta(e.fecha)}</span>
              <a className="boton contorno" href="#/panel">Ver en el panel (ventas, cancelar)</a>
            </div>
          ))}
        </>
      )}

      <Sello titulo="Acciones críticas" lineas={[
        ['escudo', 'Solo el administrador ve esta pantalla. Nadie puede darse a sí mismo otro rol.'],
        ['reloj', 'Cada cambio guarda quién lo hizo, cuándo y el motivo.'],
      ]} />
    </div>
  );
}
