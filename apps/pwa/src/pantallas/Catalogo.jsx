import { useEffect, useState } from 'react';
import { api, dinero, fechaCorta } from '../api.js';
import { Alerta, Icono } from '../comunes.jsx';

const CATEGORIAS = ['Todos', 'Música', 'Gastronomía', 'Teatro', 'Universidad'];
const ICONO = { Música: 'musica', Gastronomía: 'comida' };

// Pantalla 1 · CU02, CU04 · RF06, RF07: búsqueda con filtros y cupos al momento
export default function Catalogo() {
  const [q, setQ] = useState('');
  const [categoria, setCategoria] = useState('Todos');
  const [eventos, setEventos] = useState(null);
  const [cupos, setCupos] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    const filtros = new URLSearchParams({ ...(q && { q }), ...(categoria !== 'Todos' && { categoria }) });
    const t = setTimeout(async () => {
      try {
        const lista = await api(`/catalog/events?${filtros}`);
        setEventos(lista);
        setError('');
        if (lista.length) setCupos(await api(`/inventory/availability?eventos=${lista.map((e) => e.id).join(',')}`));
      } catch (e) {
        setError(e.message);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, categoria]);

  return (
    <div className="pantalla">
      <div className="cabecera">
        <h1 className="titulo">Eventos cerca</h1>
        <span className="sub" style={{ fontSize: 14, fontWeight: 600 }}>Ecuador</span>
      </div>
      <div className="buscador">
        <label htmlFor="buscar" className="oculto">Buscar eventos</label>
        <Icono nombre="buscar" />
        <input id="buscar" type="search" placeholder="Buscar por nombre, ciudad o lugar" value={q} onChange={(e) => setQ(e.target.value)} maxLength={80} />
      </div>
      <div className="chips" role="group" aria-label="Categorías">
        {CATEGORIAS.map((c) => (
          <button key={c} type="button" className="chip" aria-pressed={categoria === c} onClick={() => setCategoria(c)}>{c}</button>
        ))}
      </div>
      {error && <Alerta>{error}</Alerta>}
      {!eventos && !error && <p className="cargando">Cargando eventos…</p>}
      {eventos?.length === 0 && <p className="vacio">No hay eventos con esos filtros.</p>}
      <div className="rejilla">
      {eventos?.map((e) => {
        const c = cupos[e.id];
        const agotado = c && c.disponible === 0;
        const contenido = (
          <>
            <div className={`banda ${agotado ? 'agotado' : e.categoria}`} style={agotado ? { height: 68 } : undefined}>
              {!agotado && <Icono nombre={ICONO[e.categoria] ?? 'ticket'} tam={60} grosor={1.5} />}
              {e.categoria}
            </div>
            <div className="evento-cuerpo">
              <span className="evento-nombre" style={agotado ? { color: 'var(--tenue)' } : undefined}>{e.titulo}</span>
              <span className="evento-datos">{fechaCorta(e.fecha)} · {e.lugar}, {e.ciudad}</span>
              <div className="fila" style={{ marginTop: 4 }}>
                <strong style={{ fontSize: 15 }}>Desde {dinero(e.precioDesde)}</strong>
                {c && (agotado
                  ? <span className="insignia gris">Agotado</span>
                  : c.disponible <= 50 ? <span className="insignia ambar">Últimos {c.disponible} cupos</span>
                  : <span className="insignia verde">{c.disponible} disponibles</span>)}
              </div>
            </div>
          </>
        );
        // Agotado: visible pero no comprable
        return agotado
          ? <div key={e.id} className="evento" aria-disabled="true">{contenido}</div>
          : <a key={e.id} className="evento" href={`#/evento/${e.id}`}>{contenido}</a>;
      })}
      </div>
    </div>
  );
}
