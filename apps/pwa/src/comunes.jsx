import { useEffect, useState } from 'react';

// Rutas con hash (#/evento/123): funcionan sin configuración del servidor y sin conexión
export function useRuta() {
  const leer = () => (location.hash.replace(/^#\/?/, '') || 'catalogo').split('?')[0].split('/');
  const [ruta, setRuta] = useState(leer);
  useEffect(() => {
    const cambio = () => {
      setRuta(leer());
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', cambio);
    return () => removeEventListener('hashchange', cambio);
  }, []);
  return ruta;
}
export const ir = (ruta) => {
  location.hash = `#/${ruta}`;
};

export function useEnLinea() {
  const [enLinea, setEnLinea] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setEnLinea(true);
    const off = () => setEnLinea(false);
    addEventListener('online', on);
    addEventListener('offline', off);
    return () => {
      removeEventListener('online', on);
      removeEventListener('offline', off);
    };
  }, []);
  return enLinea;
}

const TRAZOS = {
  escudo: <><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  candado: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  reloj: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  ticket: <path d="M3 9a3 3 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a3 3 0 0 0 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z" />,
  buscar: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  persona: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
  panel: <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></>,
  escaner: <><path d="M4 8V5a1 1 0 0 1 1-1h3" /><path d="M16 4h3a1 1 0 0 1 1 1v3" /><path d="M20 16v3a1 1 0 0 1-1 1h-3" /><path d="M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M7 12h10" /></>,
  atras: <path d="M15 18l-6-6 6-6" />,
  ok: <path d="M5 12l5 5 9-10" />,
  alerta: <><circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16h.01" /></>,
  descargar: <><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M5 21h14" /></>,
  musica: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  comida: <><path d="M4 3v8a3 3 0 0 0 6 0V3" /><path d="M7 3v18" /><path d="M17 3c-2 0-3 2.5-3 6s1 4 3 4v8" /></>,
  sinRed: <><path d="M2 2l20 20" /><path d="M8.5 16.5a5 5 0 0 1 7 0" /><path d="M5 12.9a10 10 0 0 1 5.2-2.8" /><path d="M12 20h.01" /></>,
  sincronizar: <><path d="M21 12a9 9 0 0 1-15.5 6.2" /><path d="M3 12a9 9 0 0 1 15.5-6.2" /><path d="M18 2v4h-4" /><path d="M6 22v-4h4" /></>,
  usado: <><circle cx="12" cy="12" r="10" /><path d="M12 6.5V12l3.5 2" /></>,
  invalido: <><circle cx="12" cy="12" r="10" /><path d="M8.5 8.5l7 7" /><path d="M15.5 8.5l-7 7" /></>,
  valido: <><circle cx="12" cy="12" r="10" /><path d="M7 12.5l3.2 3.2L17 9" /></>,
};

export const Icono = ({ nombre, tam = 20, grosor = 2 }) => (
  <svg aria-hidden="true" width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={grosor} strokeLinecap="round" strokeLinejoin="round">
    {TRAZOS[nombre]}
  </svg>
);

// Aviso de seguridad visible para el usuario: qué lo protege, sin tecnicismos
export const Sello = ({ titulo, lineas, suave }) => (
  <div className={`sello${suave ? ' suave' : ''}`}>
    {titulo && <div className="sello-titulo"><Icono nombre="escudo" tam={18} />{titulo}</div>}
    {lineas.map(([icono, texto]) => (
      <div className="sello-linea" key={texto}><Icono nombre={icono} tam={18} /><span>{texto}</span></div>
    ))}
  </div>
);

export const Alerta = ({ tipo = '', children }) => (
  <div role={tipo ? 'status' : 'alert'} className={`alerta ${tipo}`}>
    <Icono nombre={tipo === 'ok' ? 'ok' : 'alerta'} tam={20} />
    <div>{children}</div>
  </div>
);

export const Volver = ({ a, etiqueta }) => (
  <a href={`#/${a}`} aria-label={etiqueta} className="boton contorno" style={{ width: 44, minHeight: 44, padding: 0, borderRadius: 999, border: '1px solid var(--borde)' }}>
    <Icono nombre="atras" />
  </a>
);

const MENUS = {
  ASISTENTE: [['catalogo', 'buscar', 'Explorar'], ['tickets', 'ticket', 'Mis tickets'], ['cuenta', 'persona', 'Cuenta']],
  ORGANIZADOR: [['catalogo', 'buscar', 'Explorar'], ['panel', 'panel', 'Panel'], ['cuenta', 'persona', 'Cuenta']],
  ACCESO: [['acceso', 'escaner', 'Acceso'], ['cuenta', 'persona', 'Cuenta']],
  ADMIN: [['catalogo', 'buscar', 'Explorar'], ['panel', 'panel', 'Panel'], ['acceso', 'escaner', 'Acceso'], ['cuenta', 'persona', 'Cuenta']],
  INVITADO: [['catalogo', 'buscar', 'Explorar'], ['tickets', 'ticket', 'Mis tickets'], ['login', 'persona', 'Entrar']],
};

export const Nav = ({ rol, actual }) => (
  <nav className="nav" aria-label="Navegación principal">
    <a href="#/catalogo" className="nav-marca" aria-label="Aforo, inicio"><span className="marca-icono"><Icono nombre="ticket" tam={20} /></span>Aforo</a>
    {(MENUS[rol] ?? MENUS.INVITADO).map(([ruta, icono, texto]) => (
      <a key={ruta} href={`#/${ruta}`} aria-current={actual === ruta ? 'page' : undefined}>
        <Icono nombre={icono} tam={22} />
        {texto}
      </a>
    ))}
  </nav>
);
