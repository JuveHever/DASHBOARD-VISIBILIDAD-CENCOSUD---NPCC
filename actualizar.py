# -*- coding: utf-8 -*-
"""
actualizar.py — Regenera los datos del dashboard y los publica.

Uso:
    python actualizar.py

Qué hace:
    1. Lee el Excel de la encuesta y el de enlaces de fotos.
    2. Regenera public/data.json (normaliza tipos y deduplica por almacén).
    3. Si hubo cambios, hace commit y push a GitHub.
       Vercel detecta el push y redespliega solo (~40 s).

Programarlo en Windows:
    Programador de tareas -> Crear tarea básica -> diaria a las 7:00 a.m.
    Acción: Iniciar un programa
      Programa:   python
      Argumentos: actualizar.py
      Iniciar en: C:\\ruta\\al\\proyecto
"""

import os, re, sys, json, subprocess, unicodedata
from datetime import datetime, timezone, timedelta
from collections import defaultdict
import pandas as pd

# ------------------------------------------------------------------ config
BASE = os.path.dirname(os.path.abspath(__file__))
SRC_ENCUESTA = os.path.join(BASE, 'datos', 'STATUS_CENCOSUD_BASE.xlsx')
SRC_FOTOS    = os.path.join(BASE, 'datos', 'FOTOS_ENCUESTA_NPCC.xlsx')
SALIDA       = os.path.join(BASE, 'public', 'data.json')
HACER_PUSH   = True          # False = solo regenera el archivo, sin publicar
BOG = timezone(timedelta(hours=-5))


def log(msg):
    print(f'[{datetime.now(BOG):%H:%M:%S}] {msg}')


# ------------------------------------------------------- normalización tipos
def _sin_acentos(t):
    t = unicodedata.normalize('NFD', t)
    return ''.join(c for c in t if unicodedata.category(c) != 'Mn')


def normaliza(raw):
    """Texto libre de campo -> lista de tipos estándar (puede devolver varios)."""
    t = _sin_acentos(str(raw).lower()).strip()
    t = re.sub(r'[^a-z0-9 ]', ' ', t)
    t = re.sub(r'\s+', ' ', t).strip()
    if not t or t in ('ninguna', 'ninguno', 'no', 'na'):
        return []
    out, h = [], lambda *k: any(x in t for x in k)
    if h('balconera', 'valconera', 'balconwra'): out.append('Balconera')
    if h('mueble'):                              out.append('Mueble')
    if h('ristra', 'rista', 'ritra') or t == 'ri': out.append('Ristra')
    if h('rejilla'):                             out.append('Rejilla')
    if h('estiba', 'estiva'):                    out.append('Estiba')
    if h('isla'):                                out.append('Isla')
    if h('pdg', 'punta de gondola', 'punta gondola', 'punta de dandola'): out.append('PDG')
    if h('tope'):                                out.append('Tope')
    if h('chimenea', 'columna'):                 out.append('Chimenea / Columna')
    if h('metro cuadrado'):                      out.append('Metro cuadrado')
    if not out and h('adicional', 'promocional', 'promocionar'): out.append('Espacio adicional')
    if not out:
        out.append('Sin especificar' if re.fullmatch(r'[0-9]+', t) else 'Otro')
    return list(dict.fromkeys(out))


# ------------------------------------------------------------------ proceso
def construir():
    for ruta in (SRC_ENCUESTA, SRC_FOTOS):
        if not os.path.exists(ruta):
            log(f'ERROR: no encuentro {ruta}')
            sys.exit(1)

    hojas = pd.read_excel(SRC_ENCUESTA, sheet_name=None)
    panel = hojas['PANEL'].copy()
    enc   = hojas['EXHIBICIONES CENCOSUD'].copy()
    for df in (panel, enc):
        df.columns = [str(c).strip() for c in df.columns]

    panel['CODIGO PDV'] = panel['CODIGO PDV'].astype(str).str.strip()
    enc['CODIGO PDV']   = enc['CODIGO PDV'].astype(str).str.strip()
    panel['NOMBRE SUPERVISOR'] = (panel['NOMBRE SUPERVISOR'].astype(str)
                                  .str.replace('GURIERREZ', 'GUTIERREZ', regex=False).str.strip())

    enc['R']  = enc['RESPUESTA'].apply(lambda x: '' if pd.isna(x) else str(x).strip())
    enc['CF'] = enc['CODIGO FOTO'].apply(lambda x: '' if pd.isna(x) else str(x).strip())
    enc['FV'] = pd.to_datetime(enc['FECHA VISITA'], dayfirst=True, errors='coerce')
    enc['FC'] = pd.to_datetime(enc['FECHA CREACIÓN RESPUESTA'], dayfirst=True, errors='coerce')
    enc = enc.sort_values(['CODIGO RUTA', 'FC'])

    f = pd.read_excel(SRC_FOTOS, sheet_name=0)
    f.columns = [str(c).strip() for c in f.columns]
    links = dict(zip(f['COD FOTO'].astype(str).str.strip(),
                     f['LINK FOTO'].astype(str).str.strip()))

    pdv_tipos = defaultdict(lambda: defaultdict(list))
    info = defaultdict(lambda: {'visitas': 0, 'tieneSI': False, 'ultima': None, 'nfotos': 0})

    for ruta, g in enc.groupby('CODIGO RUTA'):
        pdv, fecha = g.iloc[0]['CODIGO PDV'], g['FV'].max()
        d = info[pdv]
        d['visitas'] += 1
        if d['ultima'] is None or (pd.notna(fecha) and fecha > d['ultima']):
            d['ultima'] = fecha
        t = g[g['PREGUNTA'] == '¿TIENE EXHIBICIONES EL PDV?']['R']
        if len(t) and t.iloc[0].strip().upper() == 'SI':
            d['tieneSI'] = True
        for i in range(1, 6):
            tt = g[g['PREGUNTA'] == f'TIPO DE EXHIBICIÓN (Rejilla, Mueble, PDG..) {i}']['R']
            ff = g[g['PREGUNTA'] == f'FOTO DE LA EXHIBICION {i}']['CF']
            crudo = tt.iloc[0] if len(tt) else ''
            cod   = ff.iloc[0] if len(ff) else ''
            if not crudo and not cod:
                continue
            if cod:
                d['nfotos'] += 1
            for tp in (normaliza(crudo) if crudo else ['Sin especificar']):
                pdv_tipos[pdv][tp].append({
                    'cod': cod, 'url': links.get(cod, ''),
                    'fecha': fecha.strftime('%d/%m/%Y') if pd.notna(fecha) else '',
                    'orden': fecha.strftime('%Y%m%d') if pd.notna(fecha) else '',
                    'raw': crudo, 'ruta': str(ruta)})

    sin_link = {x['cod'] for m in pdv_tipos.values() for lista in m.values()
                for x in lista if x['cod'] and not x['url']}
    if sin_link:
        log(f'AVISO: {len(sin_link)} código(s) de foto sin enlace. '
            f'Revisa que {os.path.basename(SRC_FOTOS)} esté al día.')

    pdvs = []
    for _, p in panel.iterrows():
        cod = p['CODIGO PDV']
        cap = cod in info
        d   = info.get(cod, {})
        tipos = []
        if cap:
            for tp, capturas in pdv_tipos.get(cod, {}).items():
                # El mismo mueble se fotografía en cada visita. Se conserva una
                # sola foto —la más reciente— porque lo que importa es qué hay
                # instalado, no cuántas veces se registró.
                con_foto = sorted([x for x in capturas if x['cod']],
                                  key=lambda x: x['orden'], reverse=True)
                foto = con_foto[0] if con_foto else None
                tipos.append({'tipo': tp, 'nCapturas': len(capturas), 'foto': foto})
            tipos.sort(key=lambda x: (x['foto'] is None, x['tipo']))
        pdvs.append({
            'codigo': cod,
            'nombre': str(p.get('NOMBRE FANTASIA') or '').strip(),
            'supervisor': p['NOMBRE SUPERVISOR'],
            'ciudad': str(p.get('CIUDAD') or '').strip(),
            'cadena': str(p.get('SUBCADENA') or '').strip(),
            'regional': str(p.get('REGIONAL V&M') or '').strip(),
            'direccion': str(p.get('DIRECCION') or '').strip(),
            'estado': 'CAPTURADO' if cap else 'PENDIENTE',
            'tieneExh': ('SI' if d.get('tieneSI') else 'NO') if cap else '',
            'visitas': d.get('visitas', 0),
            'nFotos': sum(1 for t in tipos if t['foto']),   # una por tipo
            'nCapturasFoto': d.get('nfotos', 0),            # total registrado en campo
            'ultimaVisita': d['ultima'].strftime('%d/%m/%Y') if cap and pd.notna(d.get('ultima')) else '',
            'tipos': tipos,
            'nTipos': len(tipos)})

    data = {'meta': {'encuesta': 'Exhibiciones CENCOSUD', 'cliente': 'Nestlé Purina',
                     'generado': datetime.now(BOG).strftime('%d/%m/%Y %H:%M'),
                     'panel': len(pdvs),
                     'corte': enc['FV'].max().strftime('%d/%m/%Y') if pd.notna(enc['FV'].max()) else '',
                     'desde': enc['FV'].min().strftime('%d/%m/%Y') if pd.notna(enc['FV'].min()) else ''},
            'pdvs': pdvs}

    cap = [p for p in pdvs if p['estado'] == 'CAPTURADO']
    resumen = (f"{len(cap)}/{len(pdvs)} almacenes visitados, "
               f"{sum(p['nTipos'] for p in cap)} exhibiciones únicas, "
               f"{sum(p['nFotos'] for p in cap)} fotos "
               f"(de {sum(p['nCapturasFoto'] for p in cap)} capturas en campo)")

    # ¿Cambió algo de fondo? Se compara sin el sello de tiempo, porque ese
    # varía en cada corrida y generaría un commit diario sin datos nuevos.
    def contenido(d):
        return json.dumps({**d, 'meta': {k: v for k, v in d['meta'].items() if k != 'generado'}},
                          ensure_ascii=False, sort_keys=True)

    cambio = True
    if os.path.exists(SALIDA):
        try:
            with open(SALIDA, encoding='utf-8') as fh:
                cambio = contenido(json.load(fh)) != contenido(data)
        except Exception:
            cambio = True

    if not cambio:
        log(f'Sin novedades — {resumen}. El archivo queda como estaba.')
        return data, False

    os.makedirs(os.path.dirname(SALIDA), exist_ok=True)
    with open(SALIDA, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(',', ':'))
    log(f'Datos actualizados — {resumen}.')
    return data, True


def publicar(data):
    """Commit + push. Vercel redespliega al detectar el push."""
    def git(*args):
        return subprocess.run(['git', *args], cwd=BASE,
                              capture_output=True, text=True)

    if git('rev-parse', '--git-dir').returncode != 0:
        log('No es un repositorio git. Se guardó el archivo, pero no se publicó.')
        return

    if not git('status', '--porcelain', 'public/data.json').stdout.strip():
        log('Sin cambios frente a lo publicado. No hay nada que subir.')
        return

    git('add', 'public/data.json')
    msg = f"Datos al {data['meta']['corte']} ({data['meta']['generado']})"
    if git('commit', '-m', msg).returncode != 0:
        log('No se pudo crear el commit.')
        return

    r = git('push')
    if r.returncode == 0:
        log('Publicado. Vercel está redesplegando (~40 s).')
    else:
        log(f'El push falló: {r.stderr.strip()}')
        log('Revisa las credenciales de git y vuelve a correr el script.')


if __name__ == '__main__':
    log('Regenerando datos del dashboard…')
    data, cambio = construir()
    if not cambio:
        sys.exit(0)
    if HACER_PUSH:
        publicar(data)
    else:
        log('HACER_PUSH está en False: archivo actualizado sin publicar.')
