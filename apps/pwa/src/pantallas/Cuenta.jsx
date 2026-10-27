import { salir } from '../api.js';
import { Sello, ir } from '../comunes.jsx';

const ROLES = { ASISTENTE: 'Asistente', ORGANIZADOR: 'Organizador', ACCESO: 'Personal de acceso', ADMIN: 'Administración' };

export default function Cuenta({ usuario }) {
  return (
    <div className="pantalla">
      <h1 className="titulo">Cuenta</h1>
      <div className="tarjeta">
        <strong style={{ fontSize: 18 }}>{usuario.nombre}</strong>
        <span className="sub">{usuario.correo}</span>
        <span className="insignia verde" style={{ alignSelf: 'flex-start' }}>{ROLES[usuario.rol]}</span>
      </div>
      <button className="boton contorno" onClick={async () => { await salir(); ir('login'); }}>Cerrar sesión</button>
      <Sello titulo="Tus datos" lineas={[
        ['candado', 'Solo guardamos tu nombre, correo y compras (LOPDP). Nunca los datos de tu tarjeta.'],
        ['reloj', 'Cerrar sesión invalida tu sesión también en el servidor.'],
      ]} />
    </div>
  );
}
