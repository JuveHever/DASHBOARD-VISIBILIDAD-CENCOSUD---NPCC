import { useState, useMemo, useEffect, useCallback, useRef } from 'react'

/* Cada cuánto vuelve a pedir los datos una pestaña que quedó abierta. */
const REFRESCO_MS = 10 * 60 * 1000   // 10 minutos

/* Color fijo por tipo de exhibición: funciona como leyenda de planograma,
   el mismo color identifica al tipo en toda la vista. */
const TIPO_COLOR = {
  'Balconera': '#2563EB',
  'Mueble': '#7C3AED',
  'Ristra': '#DB2777',
  'Rejilla': '#0891B2',
  'Estiba': '#B45309',
  'PDG': '#059669',
  'Tope': '#E11D48',
  'Chimenea / Columna': '#4F46E5',
  'Isla': '#0D9488',
  'Metro cuadrado': '#9333EA',
  'Espacio adicional': '#EA580C',
  'Sin especificar': '#64748B',
}
const color = t => TIPO_COLOR[t] || '#64748B'

const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort()

/* Trae data.json sin pasar por caché y lo revisa cada cierto tiempo, para que
   un dashboard abierto en pantalla se actualice sin que nadie recargue. */
function useDatos() {
  const [estado, setEstado] = useState({ cargando: true, error: null, data: null })
  const [revisado, setRevisado] = useState(Date.now())
  const montado = useRef(true)

  const traer = useCallback(async () => {
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}data.json?v=${Date.now()}`, { cache: 'no-store' })
      if (!r.ok) throw new Error(`El servidor respondió ${r.status}`)
      const json = await r.json()
      if (montado.current) {
        setEstado({ cargando: false, error: null, data: json })
        setRevisado(Date.now())
      }
    } catch (e) {
      if (montado.current) setEstado(s => ({ cargando: false, error: e.message, data: s.data }))
    }
  }, [])

  useEffect(() => {
    montado.current = true
    traer()
    const id = setInterval(traer, REFRESCO_MS)
    // al volver a la pestaña, revisa de una vez
    const alVolver = () => { if (document.visibilityState === 'visible') traer() }
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      montado.current = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [traer])

  return { ...estado, revisado, recargar: traer }
}

function haceCuanto(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'hace un momento'
  const m = Math.floor(s / 60)
  if (m < 60) return `hace ${m} min`
  const h = Math.floor(m / 60)
  return `hace ${h} h`
}

export default function App() {
  const { cargando, error, data, revisado, recargar } = useDatos()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000)
    return () => clearInterval(id)
  }, [])

  if (cargando && !data) {
    return <div className="estado-pag">Cargando el informe…</div>
  }
  if (!data) {
    return (
      <div className="estado-pag">
        <p>No se pudieron cargar los datos.</p>
        <p className="detalle">{error}</p>
        <button className="chipbtn" onClick={recargar}>Reintentar</button>
      </div>
    )
  }
  return <Dashboard data={data} revisado={revisado} error={error} recargar={recargar} tick={tick} />
}

function Dashboard({ data, revisado, error, recargar }) {
  const { meta, pdvs } = data

  const [sup, setSup] = useState('')
  const [ciudad, setCiudad] = useState('')
  const [estado, setEstado] = useState('')
  const [tipo, setTipo] = useState('')
  const [q, setQ] = useState('')
  const [lb, setLb] = useState(null)   // {fotos, idx, pdv}

  const supervisores = useMemo(() => uniq(pdvs.map(p => p.supervisor)), [pdvs])
  const ciudades = useMemo(() => uniq(pdvs.map(p => p.ciudad)), [pdvs])

  /* Conteo de PDV por tipo — sobre tipos ya deduplicados. */
  const tipoStats = useMemo(() => {
    const m = new Map()
    pdvs.forEach(p => p.tipos.forEach(t => {
      const e = m.get(t.tipo) || { tipo: t.tipo, pdv: 0 }
      e.pdv += 1
      m.set(t.tipo, e)
    }))
    return [...m.values()].sort((a, b) => b.pdv - a.pdv)
  }, [pdvs])
  const maxTipo = Math.max(1, ...tipoStats.map(t => t.pdv))

  const filtrados = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return pdvs.filter(p => {
      if (sup && p.supervisor !== sup) return false
      if (ciudad && p.ciudad !== ciudad) return false
      if (estado === 'CAPTURADO' && p.estado !== 'CAPTURADO') return false
      if (estado === 'PENDIENTE' && p.estado !== 'PENDIENTE') return false
      if (estado === 'CON' && p.tieneExh !== 'SI') return false
      if (estado === 'SIN' && !(p.estado === 'CAPTURADO' && p.tieneExh !== 'SI')) return false
      if (tipo && !p.tipos.some(t => t.tipo === tipo)) return false
      if (needle) {
        const hay = `${p.nombre} ${p.codigo} ${p.ciudad} ${p.cadena}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [pdvs, sup, ciudad, estado, tipo, q])

  const k = useMemo(() => {
    const cap = pdvs.filter(p => p.estado === 'CAPTURADO')
    const con = cap.filter(p => p.tieneExh === 'SI')
    return {
      panel: pdvs.length,
      cap: cap.length,
      pend: pdvs.length - cap.length,
      con: con.length,
      sin: cap.length - con.length,
      cobertura: Math.round((cap.length / pdvs.length) * 1000) / 10,
      fotos: cap.reduce((a, p) => a + p.nFotos, 0),
      capturas: cap.reduce((a, p) => a + (p.nCapturasFoto || 0), 0),
      visitas: cap.reduce((a, p) => a + p.visitas, 0),
      tipos: cap.reduce((a, p) => a + p.nTipos, 0),
    }
  }, [pdvs])

  const filtroActivo = sup || ciudad || estado || tipo || q
  const limpiar = () => { setSup(''); setCiudad(''); setEstado(''); setTipo(''); setQ('') }

  const abrir = useCallback((p, i) => {
    const fotos = p.tipos.filter(t => t.foto)
      .map(t => ({ ...t.foto, tipo: t.tipo, nCapturas: t.nCapturas }))
    if (fotos.length) setLb({ fotos, idx: i, pdv: p })
  }, [])

  const idsFiltrados = useMemo(() => new Set(filtrados.map(p => p.codigo)), [filtrados])

  return (
    <>
      <header className="top">
        <div className="wrap top-in">
          <div>
            <p className="eyebrow">Auditoría en punto de venta · Cadena CENCOSUD</p>
            <h1>Exhibiciones {meta.cliente}</h1>
            <p className="sub">
              Qué material de exhibición hay instalado en cada almacén, con la foto que lo respalda.
            </p>
          </div>
          <div className="stamp">
            Corte <b>{meta.corte}</b> · desde {meta.desde}<br />
            Panel <b>{k.panel}</b> almacenes · <b>{k.fotos}</b> fotos
            <span className="fresh">
              {meta.generado && <>Datos del {meta.generado}. </>}
              Revisado {haceCuanto(revisado)}.
              <button className="relink" onClick={recargar}>Actualizar ahora</button>
              {error && <em className="warn">Sin conexión al último intento.</em>}
            </span>
          </div>
        </div>
      </header>

      <main className="wrap">

        {/* ---- signature: el panel completo como cuadrícula ---- */}
        <section className="rail-sec">
          <div className="rail-head">
            <div>
              <h2 className="sec-title">Cobertura del panel</h2>
              <p className="sec-note">
                Cada cuadro es uno de los {k.panel} almacenes del panel. Pasa el cursor para ver
                cuál es; el color indica si ya fue visitado y si tiene exhibición instalada.
              </p>
            </div>
          </div>

          <div className="rail">
            {pdvs.map(p => {
              const cls = p.estado === 'PENDIENTE' ? 'c-pe' : (p.tieneExh === 'SI' ? 'c-si' : 'c-no')
              const dim = filtroActivo && !idsFiltrados.has(p.codigo)
              return (
                <button
                  key={p.codigo}
                  className={`cellbtn ${cls}${dim ? ' dim' : ''}`}
                  title={`${p.nombre} · ${p.ciudad} · ${p.estado === 'PENDIENTE' ? 'Sin visitar' : (p.tieneExh === 'SI' ? `${p.nTipos} tipo(s) de exhibición` : 'Visitado, sin exhibición')}`}
                  onClick={() => { setQ(p.nombre); window.scrollTo({ top: 520, behavior: 'smooth' }) }}
                />
              )
            })}
          </div>

          <div className="legend">
            <span><i className="sw" style={{ background: 'var(--ok)' }} /> Con exhibición ({k.con})</span>
            <span><i className="sw" style={{ background: 'var(--none)' }} /> Visitado sin exhibición ({k.sin})</span>
            <span><i className="sw" style={{ background: 'var(--pend)' }} /> Sin visitar ({k.pend})</span>
          </div>

          <div className="reads">
            <div className="read">
              <div className="n">{k.cobertura}%</div>
              <div className="l">Cobertura del panel</div>
            </div>
            <div className="read">
              <div className="n">{k.cap}<small> / {k.panel}</small></div>
              <div className="l">Almacenes visitados</div>
            </div>
            <div className="read">
              <div className="n">{k.con}<small> / {k.cap}</small></div>
              <div className="l">Con exhibición instalada</div>
            </div>
            <div className="read">
              <div className="n">{k.tipos}</div>
              <div className="l">Exhibiciones únicas registradas</div>
            </div>
            <div className="read">
              <div className="n">{k.fotos}</div>
              <div className="l">Fotos, una por exhibición</div>
            </div>
          </div>
        </section>

        {/* ---- tipos ---- */}
        <section className="types-sec">
          <div className="rail-head">
            <div>
              <h2 className="sec-title">Qué hay instalado</h2>
              <p className="sec-note">
                Almacenes donde existe cada tipo de exhibición. Un tipo cuenta una sola vez por
                almacén, aunque se haya fotografiado en varias visitas. Toca un tipo para filtrar.
              </p>
            </div>
          </div>
          <div className="tgrid">
            {tipoStats.map(t => (
              <button
                key={t.tipo}
                className="trow"
                aria-pressed={tipo === t.tipo}
                onClick={() => setTipo(tipo === t.tipo ? '' : t.tipo)}
              >
                <span className="tt">
                  <i className="sw" style={{ background: color(t.tipo) }} />
                  {t.tipo}
                  <span className="tn">{t.pdv}</span>
                </span>
                <span className="bar">
                  <i style={{ width: `${(t.pdv / maxTipo) * 100}%`, background: color(t.tipo) }} />
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* ---- filtros ---- */}
        <div className="filters">
          <div className="frow">
            <input
              className="search"
              placeholder="Buscar almacén, código o ciudad…"
              value={q}
              onChange={e => setQ(e.target.value)}
              aria-label="Buscar almacén"
            />
            <select value={sup} onChange={e => setSup(e.target.value)} aria-label="Supervisor">
              <option value="">Todos los supervisores</option>
              {supervisores.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={ciudad} onChange={e => setCiudad(e.target.value)} aria-label="Ciudad">
              <option value="">Todas las ciudades</option>
              {ciudades.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button className="chipbtn" aria-pressed={estado === 'CON'}
              onClick={() => setEstado(estado === 'CON' ? '' : 'CON')}>Con exhibición</button>
            <button className="chipbtn" aria-pressed={estado === 'SIN'}
              onClick={() => setEstado(estado === 'SIN' ? '' : 'SIN')}>Sin exhibición</button>
            <button className="chipbtn" aria-pressed={estado === 'PENDIENTE'}
              onClick={() => setEstado(estado === 'PENDIENTE' ? '' : 'PENDIENTE')}>Sin visitar</button>
            {filtroActivo && <button className="clear" onClick={limpiar}>Quitar filtros</button>}
            <span className="count">{filtrados.length} de {pdvs.length}</span>
          </div>
        </div>

        {/* ---- tarjetas ---- */}
        <section className="cards">
          {filtrados.map(p => {
            const conFoto = p.tipos.filter(t => t.foto)
            return (
              <article className="card" key={p.codigo}>
                <div className="card-h">
                  <div className="nm">{p.nombre}</div>
                  <div className="mt">
                    <code>{p.codigo}</code>
                    <span>{p.ciudad}</span>
                    <span>{p.cadena}</span>
                    {p.estado === 'PENDIENTE'
                      ? <span className="state s-pe">Sin visitar</span>
                      : p.tieneExh === 'SI'
                        ? <span className="state s-si">{p.nTipos} exhibición{p.nTipos === 1 ? '' : 'es'}</span>
                        : <span className="state s-no">Sin exhibición</span>}
                    {p.estado === 'CAPTURADO' &&
                      <span>{p.visitas} visita{p.visitas === 1 ? '' : 's'} · últ. {p.ultimaVisita}</span>}
                  </div>
                </div>

                {conFoto.length > 0 ? (
                  <div className="exhs">
                    {conFoto.map((t, i) => (
                      <button className="exh" key={t.tipo} onClick={() => abrir(p, i)}
                        title={`Ver ${t.tipo} en ${p.nombre}`}>
                        <span className="exh-img">
                          <img src={t.foto.url} alt={`${t.tipo} en ${p.nombre}`} loading="lazy" />
                        </span>
                        <span className="exh-lb">
                          <i className="dot" style={{ background: color(t.tipo) }} />
                          {t.tipo}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty-ph">
                    {p.estado === 'PENDIENTE'
                      ? 'Este almacén todavía no ha sido visitado.'
                      : 'Visitado, sin exhibición registrada.'}
                  </div>
                )}
              </article>
            )
          })}
          {filtrados.length === 0 && (
            <p style={{ color: 'var(--muted)', padding: '30px 0' }}>
              Ningún almacén coincide con estos filtros. Prueba quitando alguno.
            </p>
          )}
        </section>

        <footer className="foot">
          {meta.encuesta} · {meta.cliente} · Visión &amp; Marketing S.A.S.<br />
          Un tipo de exhibición se cuenta una vez por almacén; las visitas repetidas no lo duplican.
        </footer>
      </main>

      {lb && <Lightbox lb={lb} setLb={setLb} />}
    </>
  )
}

function Lightbox({ lb, setLb }) {
  const { fotos, idx, pdv } = lb
  const f = fotos[idx]
  const ir = useCallback(d => {
    setLb(s => {
      const n = s.idx + d
      return n < 0 || n >= s.fotos.length ? s : { ...s, idx: n }
    })
  }, [setLb])

  useEffect(() => {
    const h = e => {
      if (e.key === 'Escape') setLb(null)
      if (e.key === 'ArrowRight') ir(1)
      if (e.key === 'ArrowLeft') ir(-1)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [ir, setLb])

  return (
    <div className="lb" role="dialog" aria-modal="true" aria-label={`Foto de ${pdv.nombre}`}
      onClick={e => { if (e.target === e.currentTarget) setLb(null) }}>
      <div className="lb-in">
        <div className="lb-img">
          {f.url
            ? <img src={f.url} alt={`${f.tipo} en ${pdv.nombre}`} />
            : <p className="noimg">Esta foto no tiene enlace disponible.</p>}
        </div>
        <div className="lb-bar">
          <div>
            <div className="t">
              <span className="sw" style={{ background: color(f.tipo), marginRight: 8 }} />
              {f.tipo}
            </div>
            <div className="m">
              {pdv.nombre} · foto del {f.fecha} · registrado en campo como “{f.raw || 's/d'}”
            </div>
            {f.nCapturas > 1 && (
              <div className="m">
                Se fotografió en {f.nCapturas} visitas; se muestra la más reciente.
              </div>
            )}
            <div className="m">
              {f.cod} {f.url && <> · <a className="lb-link" href={f.url} target="_blank" rel="noreferrer">abrir original</a></>}
            </div>
          </div>
          <div className="sp">
            <button className="nav" onClick={() => ir(-1)} disabled={idx === 0}>← Anterior</button>
            <span className="nav" style={{ cursor: 'default' }}>{idx + 1} / {fotos.length}</span>
            <button className="nav" onClick={() => ir(1)} disabled={idx === fotos.length - 1}>Siguiente →</button>
            <button className="nav" onClick={() => setLb(null)}>Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  )
}
