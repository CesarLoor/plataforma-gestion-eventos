import { useState } from 'react';
import { api } from '../api.js';
import { Alerta, Volver, ir } from '../comunes.jsx';

const CATEGORIAS = ['Música', 'Gastronomía', 'Teatro', 'Universidad', 'Deportes', 'Otro'];

// CU10, CU11 · RF04, RF05: el organizador publica sin ayuda técnica
export default function NuevoEvento() {
  const [tipos, setTipos] = useState([{ nombre: 'General', precio: 10, cupo: 100 }]);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cambiarTipo = (i, campo, valor) => setTipos((ts) => ts.map((t, j) => (j === i ? { ...t, [campo]: valor } : t)));

  async function guardar(e) {
    e.preventDefault();
    const publicar = e.nativeEvent.submitter?.value === 'publicar';
    const d = Object.fromEntries(new FormData(e.currentTarget));
    setEnviando(true);
    setError('');
    try {
      const { id } = await api('/catalog/events', {
        method: 'POST',
        body: {
          titulo: d.titulo, descripcion: d.descripcion, categoria: d.categoria, ciudad: d.ciudad, lugar: d.lugar,
          fecha: new Date(d.fecha).toISOString(),
          tipos: tipos.map((t) => ({ nombre: t.nombre, precio: Number(t.precio), cupo: Number(t.cupo) })),
        },
      });
      if (publicar) await api(`/catalog/events/${id}/publish`, { method: 'POST' });
      ir('panel');
    } catch (err) {
      setError(err.message);
      setEnviando(false);
    }
  }

  return (
    <div className="pantalla">
      <div className="cabecera" style={{ justifyContent: 'flex-start' }}>
        <Volver a="panel" etiqueta="Volver al panel" />
        <h1 className="titulo chico">Nuevo evento</h1>
      </div>
      {error && <Alerta>{error}</Alerta>}
      <form onSubmit={guardar} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="campo"><label htmlFor="titulo">Nombre del evento</label><input id="titulo" name="titulo" required minLength={3} maxLength={100} /></div>
        <div className="campo"><label htmlFor="descripcion">Descripción</label><textarea id="descripcion" name="descripcion" rows={3} maxLength={1000} /></div>
        <div className="campo">
          <label htmlFor="categoria">Categoría</label>
          <select id="categoria" name="categoria">{CATEGORIAS.map((c) => <option key={c}>{c}</option>)}</select>
        </div>
        <div className="botones">
          <div className="campo"><label htmlFor="ciudad">Ciudad</label><input id="ciudad" name="ciudad" required defaultValue="Quito" maxLength={40} /></div>
          <div className="campo"><label htmlFor="fecha">Fecha y hora</label><input id="fecha" name="fecha" type="datetime-local" required /></div>
        </div>
        <div className="campo"><label htmlFor="lugar">Lugar</label><input id="lugar" name="lugar" required maxLength={120} /></div>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <legend className="leyenda" style={{ marginBottom: 8 }}>Tipos de entrada</legend>
          {tipos.map((t, i) => (
            <div key={i} className="tarjeta" style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
              <div className="campo" style={{ flex: 2 }}><label htmlFor={`tn${i}`}>Nombre</label><input id={`tn${i}`} value={t.nombre} required minLength={2} maxLength={40} onChange={(e) => cambiarTipo(i, 'nombre', e.target.value)} /></div>
              <div className="campo" style={{ flex: 1 }}><label htmlFor={`tp${i}`}>Precio $</label><input id={`tp${i}`} type="number" min="0" step="0.01" value={t.precio} required onChange={(e) => cambiarTipo(i, 'precio', e.target.value)} /></div>
              <div className="campo" style={{ flex: 1 }}><label htmlFor={`tc${i}`}>Cupo</label><input id={`tc${i}`} type="number" min="1" step="1" value={t.cupo} required onChange={(e) => cambiarTipo(i, 'cupo', e.target.value)} /></div>
            </div>
          ))}
          {tipos.length < 5 && <button type="button" className="enlace" onClick={() => setTipos([...tipos, { nombre: '', precio: 0, cupo: 50 }])}>Agregar tipo de entrada</button>}
        </fieldset>
        <div className="botones">
          <button className="boton contorno" value="borrador" disabled={enviando}>Guardar borrador</button>
          <button className="boton" value="publicar" disabled={enviando}>Publicar</button>
        </div>
      </form>
    </div>
  );
}
