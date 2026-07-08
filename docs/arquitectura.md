# Arquitectura del CRM

## Vision general

El sistema se divide en dos capas:

- `frontend/`: SPA en React consumiendo la API REST
- `backend/`: servidor HTTP en Node.js con servicios de negocio y persistencia

## Flujo de autenticacion

1. El Administrador General crea o habilita la cuenta en el modulo `Usuarios`.
2. El Administrador asigna una contrasena inicial o una nueva contrasena manualmente.
3. El usuario inicia sesion en `POST /api/auth/login` con correo y contrasena asignada.
4. El servidor valida que la cuenta este activa, no bloqueada y tenga contrasena asignada.
5. Se entrega JWT propio y refresh token de sesion.
6. Las rutas protegidas usan `Authorization: Bearer <token>`.

No existe recuperacion de contrasena por correo, enlaces de verificacion ni registro externo. Las credenciales son administradas centralmente.

## Sincronizacion Miembros - Usuarios

- Si un miembro adquiere rol `Mentor`, `Lider`, `Pastor` o `Secretaria`, el backend crea o actualiza su cuenta de usuario usando su correo.
- La cuenta queda activa segun el estado del miembro, pero sin acceso hasta que el Administrador asigne contrasena.
- Si el miembro pierde un rol con acceso, la cuenta no se elimina: queda inactiva para conservar historial.
- Cambios de nombre, correo, estado y rol se reflejan automaticamente en `Usuarios`.

## Reglas de acceso

- `ADMIN`:
  - ve todos los jovenes
  - gestiona usuarios
  - elimina jovenes
  - importa y exporta base de datos
- `PASTOR`:
  - vision global, reportes, estadisticas y seguimiento pastoral
- `SECRETARIA`:
  - gestion administrativa, miembros, asistencia, consolidacion e informes
- `LIDER`:
  - grupos asignados, asistencia, consolidacion y seguimiento
- `MENTOR`:
  - miembros asignados, visitas, llamadas y observaciones

## Persistencia

La informacion se guarda en:

- Supabase remoto en `public.crm_state` cuando `SUPABASE_ENFORCE_REMOTE=true`
- `backend/src/data/database.json` solo como fallback local de desarrollo

Si el archivo local no existe en desarrollo, el sistema lo crea automaticamente con datos semilla.

## Generacion de alertas

Cada vez que se registra una nueva asistencia:

1. se ordenan las sesiones por fecha
2. se revisa el historial por joven
3. si un joven acumula 2 ausencias consecutivas, se crea una alerta pendiente

## Nota tecnica

En este entorno se priorizo una ejecucion inmediata sin pasos de build. Por eso el frontend usa React y Tailwind desde CDN, mientras el backend sirve tanto la SPA como la API.
