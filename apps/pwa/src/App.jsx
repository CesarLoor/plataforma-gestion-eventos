import { useEffect, useState } from 'react';
import { alCambiarSesion, renovar, sesion } from './api.js';
import { Nav, useRuta, ir } from './comunes.jsx';
import Login from './pantallas/Login.jsx';
import Catalogo from './pantallas/Catalogo.jsx';
import Detalle from './pantallas/Detalle.jsx';
import Pago from './pantallas/Pago.jsx';
import Orden from './pantallas/Orden.jsx';
import Tickets from './pantallas/Tickets.jsx';
import Panel from './pantallas/Panel.jsx';
import NuevoEvento from './pantallas/NuevoEvento.jsx';
import Acceso from './pantallas/Acceso.jsx';
import Cuenta from './pantallas/Cuenta.jsx';

// Pantallas que exigen un rol; sin sesión se va a iniciar sesión
const PERMISOS = { pago: ['ASISTENTE'], orden: ['ASISTENTE'], panel: ['ORGANIZADOR', 'ADMIN'], acceso: ['ACCESO', 'ADMIN'], cuenta: null };

export default function App() {
  const [usuario, setUsuario] = useState(sesion());
  const [listo, setListo] = useState(false);
  const [pantalla, ...params] = useRuta();

  useEffect(() => {
    const quitar = alCambiarSesion(setUsuario);
    renovar().finally(() => setListo(true));
    return quitar;
  }, []);

  const requiere = pantalla in PERMISOS;
  useEffect(() => {
    if (listo && requiere && !usuario && pantalla !== 'tickets') ir(`login?volver=${encodeURIComponent(location.hash.slice(2))}`);
  }, [listo, requiere, usuario, pantalla]);

  if (!listo) return <main className="app"><p className="pantalla cargando">Cargando…</p></main>;
  const permitidos = PERMISOS[pantalla];
  const bloqueado = requiere && usuario && permitidos && !permitidos.includes(usuario.rol);

  const vistas = {
    login: <Login />,
    catalogo: <Catalogo />,
    evento: <Detalle id={params[0]} usuario={usuario} />,
    pago: <Pago reservaId={params[0]} usuario={usuario} />,
    orden: <Orden id={params[0]} />,
    tickets: <Tickets usuario={usuario} />,
    panel: params[0] === 'nuevo' ? <NuevoEvento /> : <Panel />,
    acceso: <Acceso usuario={usuario} />,
    cuenta: <Cuenta usuario={usuario} />,
  };

  return (
    <main className="app">
      {bloqueado ? (
        <div className="pantalla"><h1 className="titulo">Sin permiso</h1><p className="sub">Tu rol ({usuario.rol}) no puede abrir esta pantalla.</p></div>
      ) : requiere && !usuario ? null : (
        vistas[pantalla] ?? <Catalogo />
      )}
      {pantalla !== 'login' && <Nav rol={usuario?.rol} actual={pantalla} />}
    </main>
  );
}
