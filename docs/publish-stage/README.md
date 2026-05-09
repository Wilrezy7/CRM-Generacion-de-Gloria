# Generacion de Gloria CRM

Sistema CRM web para el Ministerio Juvenil "Generacion de Gloria" enfocado en:

- gestion de jovenes
- control de asistencia
- seguimiento pastoral
- alertas por ausencias consecutivas
- usuarios con roles `ADMIN` y `ASISTENTE`
- dashboard con metricas visuales

## Stack implementado

- Frontend: React 18 servido como SPA sin bundler local
- UI: TailwindCSS por CDN, modo claro/oscuro, layout responsive
- Backend: Node.js con API REST modular
- Seguridad: autenticacion por token estilo JWT y proteccion por roles
- Persistencia: Supabase como almacenamiento remoto principal

## Estructura

```text
backend/
  src/
    config/
    data/
    repositories/
    services/
    utils/
    server.js
frontend/
  assets/
  app.js
  index.html
  styles.css
docs/
README.md
package.json
```

## Funcionalidades

### 1. Gestion de jovenes

- crear, editar y eliminar jovenes
- filtros por texto y estado
- historial individual con asistencias, seguimientos y alertas

### 2. Asistencia

- crear reuniones o servicios
- marcar asistencia rapida por joven
- historial completo por sesion

### 3. Seguimiento

- registrar llamadas y visitas
- notas pastorales
- actividad reciente en dashboard

### 4. Alertas

- deteccion automatica de 2 ausencias consecutivas
- listado de alertas
- opcion de marcar como atendida

### 5. Usuarios y roles

- `ADMIN`: acceso total, manejo de usuarios, eliminacion y asignaciones
- `ASISTENTE`: solo jovenes asignados, asistencia y seguimiento

### 6. Importacion y exportacion

- exportacion a archivo `.xls` compatible con Excel
- importacion de jovenes mediante CSV con encabezados
- importacion directa desde `.xlsx` tomando la hoja `Base de Datos` o la hoja `Jovenes` de la plantilla
- plantilla Excel de carga masiva sin columna `id`

Columnas soportadas para importacion de jovenes:

- `nombre_completo`
- `cedula`
- `celular`
- `fecha_de_nacimiento`
- `correo`
- `bautizados`
- `rol`
- `estado`
- `notas`

## Credenciales demo

- Admin:
  - correo: `admin@gdg.local`
  - contrasena: `Admin123*`
- Asistente:
  - correo: `asistente@gdg.local`
  - contrasena: `Asistente123*`

## Instalacion y ejecucion

1. Asegura tener Node.js 18+.
2. Desde la raiz del proyecto ejecuta:

```bash
npm run dev
```

3. Si prefieres modo normal sin recarga en caliente:

```bash
npm start
```

4. Abre en el navegador local:

```text
http://localhost:4000
```

Si tu entorno no expone `npm`, tambien puedes iniciar el servidor directamente con:

```bash
node backend/src/server.js
```

En Windows tambien puedes usar el lanzador:

```bat
dev-server.cmd
```

Para trabajar sin conexion remota a Supabase durante desarrollo local:

```bat
dev-server.cmd local
```

## Variables de entorno

- `PORT`: puerto del servidor
- `JWT_SECRET`: secreto del token
- `SUPABASE_URL`: URL base del proyecto Supabase
- `SUPABASE_PUBLISHABLE_KEY`: clave publica del proyecto
- `SUPABASE_SECRET_KEY`: clave segura para backend
- `SUPABASE_TABLE`: tabla remota de almacenamiento agregado
- `SUPABASE_RECORD_ID`: identificador del registro agregado

Ejemplo:

```bash
PORT=4500 JWT_SECRET=mi-secreto node backend/src/server.js
```

## API principal

- `POST /api/auth/login`
- `GET /api/me`
- `GET /api/dashboard`
- `GET|POST /api/youths`
- `PUT|DELETE /api/youths/:id`
- `GET /api/youths/:id/timeline`
- `GET|POST /api/attendance`
- `GET|POST /api/interactions`
- `GET /api/alerts`
- `PATCH /api/alerts/:id/attend`
- `GET|POST /api/users`
- `PUT|DELETE /api/users/:id`
- `GET /api/export/youths`
- `POST /api/import/youths`

## Activacion de Supabase

El proyecto ya esta configurado para funcionar en modo remoto con Supabase:

- `backend/src/repositories/database.js`

Para activarlo por completo:

1. Crea un archivo `.env.local` basado en `.env.example`.
2. En el panel SQL de Supabase ejecuta [docs/supabase-schema.sql](C:\Users\Usuario\Documents\Codex\2026-04-25\desarrolla-un-sistema-crm-web-profesional\docs\supabase-schema.sql).
3. Reinicia el servidor.

Con `SUPABASE_ENFORCE_REMOTE=true`, el backend deja de usar el archivo local como base principal y exigira que Supabase este listo. Si la tabla no existe o la clave falla, la API devolvera un error claro para que no haya datos divididos entre local y remoto.

## Deploy en Railway

El proyecto ya incluye:

- [Dockerfile](C:\Users\Usuario\Documents\Codex\2026-04-25\desarrolla-un-sistema-crm-web-profesional\Dockerfile)
- [railway.toml](C:\Users\Usuario\Documents\Codex\2026-04-25\desarrolla-un-sistema-crm-web-profesional\railway.toml)
- [.dockerignore](C:\Users\Usuario\Documents\Codex\2026-04-25\desarrolla-un-sistema-crm-web-profesional\.dockerignore)

Pasos:

1. Crea un nuevo proyecto en Railway y conecta este repositorio o sube el directorio con `railway up`.
2. En Variables, carga las claves de `.env.local`:
   - `JWT_SECRET`
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY`
   - `SUPABASE_TABLE`
   - `SUPABASE_RECORD_ID`
   - `SUPABASE_ENFORCE_REMOTE=true`
3. Despliega el servicio.
4. En `Networking`, usa `Generate Domain` para obtener la URL publica.

El contenedor escucha en `PORT` y Railway publicara el CRM como un unico servicio web con frontend y API en el mismo dominio. En produccion no necesitas configurar una URL de API con `localhost`: el frontend consume rutas relativas `/api`, asi que funciona desde el dominio publico que entregue Railway.
