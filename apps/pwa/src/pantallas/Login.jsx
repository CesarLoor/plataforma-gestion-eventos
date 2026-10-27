import { useState } from 'react';
import { entrar } from '../api.js';
import { Alerta, Icono, ir } from '../comunes.jsx';

const INICIO = { ASISTENTE: 'catalogo', ORGANIZADOR: 'panel', ACCESO: 'acceso', ADMIN: 'panel' };

// CU01 · RF01: registro e inicio de sesión; los mensajes de bloqueo los decide el servidor (RNF05)
export default function Login() {
  const [registro, setRegistro] = useState(false);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(e.currentTarget));
    setError('');
    setEnviando(true);
    try {
      const u = await entrar(registro ? '/auth/register' : '/auth/login', datos);
      const volver = new URLSearchParams(location.hash.split('?')[1]).get('volver');
      ir(volver && !volver.startsWith('login') ? volver : INICIO[u.rol]);
    } catch (err) {
      setError(err.status === 429 ? 'Demasiados intentos desde esta conexión. Espera un minuto.' : err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login">
    <aside className="login-lado">
      <div className="marca"><span className="marca-icono" style={{ background: '#fff', color: 'var(--acento-oscuro)' }}><Icono nombre="ticket" tam={22} /></span>Aforo</div>
      <h2>Entradas para eventos locales, sin sobreventa ni copias.</h2>
      <p>Publica tu evento, vende con cupos al momento y controla el ingreso desde el celular, incluso sin internet.</p>
      <ul>
        <li><Icono nombre="ok" />Cupos apartados 10 minutos mientras pagas</li>
        <li><Icono nombre="ok" />Tickets con QR firmado de un solo uso</li>
        <li><Icono nombre="ok" />Panel de ventas e ingresos en vivo</li>
      </ul>
    </aside>
    <div className="pantalla" style={{ paddingTop: 48, paddingBottom: 32 }}>
      <div className="marca"><span className="marca-icono"><Icono nombre="ticket" tam={22} /></span>Aforo</div>
      <div>
        <h1 className="titulo" style={{ fontSize: 32 }}>{registro ? 'Crea tu cuenta' : 'Inicia sesión'}</h1>
        <p className="sub">Compra entradas, guarda tus tickets o controla el ingreso a tu evento.</p>
      </div>
      {error && <Alerta><strong>{error}</strong></Alerta>}
      <form onSubmit={enviar} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {registro && (
          <div className="campo">
            <label htmlFor="nombre">Nombre completo</label>
            <input id="nombre" name="nombre" autoComplete="name" required minLength={2} maxLength={80} />
          </div>
        )}
        <div className="campo">
          <label htmlFor="correo">Correo electrónico</label>
          <input id="correo" name="correo" type="email" autoComplete="email" required maxLength={120} />
        </div>
        <div className="campo">
          <label htmlFor="password">Contraseña</label>
          <input id="password" name="password" type="password" autoComplete={registro ? 'new-password' : 'current-password'} required minLength={registro ? 10 : 1}
            aria-invalid={Boolean(error) || undefined} aria-describedby="ayuda-clave" />
          <span id="ayuda-clave" className="ayuda">Mínimo 10 caracteres.</span>
        </div>
        {registro && (
          <div className="campo">
            <label htmlFor="rol">Quiero</label>
            <select id="rol" name="rol" defaultValue="ASISTENTE">
              <option value="ASISTENTE">Comprar entradas</option>
              <option value="ORGANIZADOR">Publicar mis eventos</option>
            </select>
          </div>
        )}
        <button className="boton" disabled={enviando}>{enviando ? 'Un momento…' : registro ? 'Crear cuenta' : 'Iniciar sesión'}</button>
        <button type="button" className="enlace" onClick={() => { setRegistro(!registro); setError(''); }}>
          {registro ? 'Ya tengo cuenta' : 'Crear cuenta'}
        </button>
      </form>
    </div>
    </div>
  );
}
