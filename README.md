# Dashboard · Exhibiciones CENCOSUD — Nestlé Purina

Informe interactivo de la auditoría de exhibiciones en punto de venta para la cadena
CENCOSUD. Permite al cliente ver qué material de exhibición hay instalado en cada
almacén y abrir la foto que lo respalda.

Construido con React + Vite. Sin backend: los datos viajan en un JSON estático y las
fotos se cargan desde el blob de Visión & Marketing.

---

## Qué muestra

- **Cobertura del panel** — los 83 almacenes como cuadrícula, coloreados por estado
  (con exhibición / visitado sin exhibición / sin visitar).
- **Qué hay instalado** — cuántos almacenes tienen cada tipo de exhibición. Cada tipo
  tiene un color fijo que lo identifica en toda la vista.
- **Ficha por almacén** — tipos presentes, número de visitas, última visita y miniaturas
  de las fotos.
- **Visor de fotos** — pantalla completa, navegable con flechas del teclado, con enlace
  al original.

Filtros disponibles: búsqueda por nombre/código/ciudad, supervisor, ciudad, tipo de
exhibición y estado.

---

## Criterio de deduplicación

El cliente quiere saber **qué hay** en cada punto de venta, no cuántas veces se
fotografió. Por eso:

> Un tipo de exhibición cuenta **una sola vez por almacén**, sin importar cuántas
> visitas lo hayan registrado.

Ejemplo: si en JUMBO RIONEGRO se capturó "Estiba" en cuatro visitas distintas, el
almacén reporta **una** Estiba. Las fotos de todas esas capturas siguen disponibles en
el visor, ordenadas de la más reciente a la más antigua, y el chip del tipo muestra
cuántas fotos hay.

Las respuestas de campo venían en texto libre con 63 variantes distintas (mayúsculas,
plurales, errores de digitación como `valconera` o `estiva`, y marcas pegadas al tipo
como `Rejilla Dog Chow`). Todas se normalizan a 12 tipos:

`Balconera` · `Mueble` · `Ristra` · `Rejilla` · `Estiba` · `PDG` · `Tope` ·
`Chimenea / Columna` · `Isla` · `Metro cuadrado` · `Espacio adicional` · `Sin especificar`

Notas del criterio:
- `PDG` y `punta de góndola` se tratan como el mismo tipo.
- Una respuesta que menciona dos tipos (`rejilla y mueble`) suma a los dos.
- `Sin especificar` son capturas con foto donde el tipo quedó como número o vacío.
- `Ninguna` se descarta: no es una exhibición.

El visor muestra el texto original de cada captura junto a la foto, para poder auditar
la normalización.

---

## Correr en local

Requiere Node 18 o superior.

```bash
npm install
npm run dev
```

Abre la URL que imprime la terminal (por defecto `http://localhost:5173`).

Para generar la versión de producción:

```bash
npm run build      # deja los archivos en dist/
npm run preview    # sirve dist/ para revisarlo
```

---

## Publicar en Vercel

**1. Subir a GitHub**

```bash
git init
git add .
git commit -m "Dashboard exhibiciones CENCOSUD"
git branch -M main
git remote add origin https://github.com/USUARIO/REPO.git
git push -u origin main
```

**2. Importar en Vercel**

En [vercel.com/new](https://vercel.com/new) elige el repositorio. Vercel detecta Vite
solo; la configuración queda así:

| Campo | Valor |
|---|---|
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |

Dale **Deploy**. Cada push a `main` vuelve a desplegar automáticamente.

---

## Actualizar los datos

Los datos viven en `public/data.json`, **fuera del bundle**. El dashboard lo pide al
cargar la página, así que basta con reemplazar ese archivo: no hay que tocar el código.

### Cómo se refresca

**En el navegador.** Una pestaña abierta vuelve a pedir el archivo cada 10 minutos, y
también cada vez que alguien regresa a la pestaña. El encabezado muestra de cuándo son
los datos y hay un enlace *Actualizar ahora* para forzarlo. Sirve para dejarlo puesto en
una pantalla sin que nadie lo recargue a mano.

Para cambiar el intervalo, edita `REFRESCO_MS` al inicio de `src/App.jsx`.

**En el servidor.** Corre el script incluido:

```bash
python actualizar.py
```

Hace tres cosas: lee los Excel de `datos/`, regenera `public/data.json`, y si algo
cambió hace commit y push. Vercel detecta el push y redespliega en unos 40 segundos.

Compara el contenido ignorando el sello de tiempo, así que si la encuesta no trae nada
nuevo no genera un commit vacío. Correrlo dos veces seguidas es inofensivo.

Coloca los archivos fuente en la carpeta `datos/`:

```
datos/
  STATUS_CENCOSUD_BASE.xlsx      ← export de la encuesta (hojas EXHIBICIONES CENCOSUD + PANEL)
  FOTOS_ENCUESTA_NPCC.xlsx       ← enlaces de fotos (COD FOTO → LINK FOTO)
```

Si prefieres revisar antes de publicar, pon `HACER_PUSH = False` en el script: regenera
el archivo y no sube nada.

### Dejarlo automático

En Windows, con el Programador de tareas:

1. **Crear tarea básica** → nombre `Dashboard CENCOSUD`
2. **Desencadenador**: diario, a la hora que convenga (por ejemplo 7:00 a.m.)
3. **Acción**: Iniciar un programa
   - Programa: `python`
   - Argumentos: `actualizar.py`
   - Iniciar en: la carpeta del proyecto
4. Marca *Ejecutar tanto si el usuario inició sesión como si no*

Con esto la cadena queda: exportas la encuesta a `datos/` → la tarea corre → el
dashboard queda al día sin intervención.

**Lo que sigue siendo manual** es dejar el export actualizado en `datos/`. Si la
plataforma de captura expone una API o deja el archivo en una carpeta compartida, se
puede añadir ese paso al inicio de `actualizar.py` y la cadena queda completa de punta a
punta.

### Estructura del JSON

```jsonc
{
  "meta": { "encuesta": "...", "cliente": "...", "panel": 83, "corte": "27/07/2026", "desde": "..." },
  "pdvs": [
    {
      "codigo": "12268", "nombre": "JUMBO RIONEGRO",
      "supervisor": "...", "ciudad": "...", "cadena": "...", "regional": "...", "direccion": "...",
      "estado": "CAPTURADO",        // o "PENDIENTE"
      "tieneExh": "SI",             // "" si no fue visitado
      "visitas": 10, "nFotos": 50, "ultimaVisita": "27/07/2026", "nTipos": 4,
      "tipos": [
        {
          "tipo": "Balconera", "nFotos": 20, "nCapturas": 20,
          "fotos": [ { "cod": "...", "url": "https://...", "fecha": "...", "raw": "balconera", "ruta": "..." } ]
        }
      ]
    }
  ]
}
```

---

## Sobre las fotos

Se sirven directamente desde `visionstandardapp.blob.core.windows.net`. Requisitos:

- El contenedor debe permitir lectura pública, o las imágenes no cargarán en el navegador
  de quien abra el dashboard.
- Si más adelante se restringe el acceso, hay que generar URLs con SAS token y
  regenerar `src/data.json`.

Las miniaturas usan `loading="lazy"`, así que solo se descargan al entrar en pantalla.
