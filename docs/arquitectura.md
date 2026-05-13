# Arquitectura del CRM

## Vision general

El sistema se divide en dos capas:

- `frontend/`: SPA en React consumiendo la API REST
- `backend/`: servidor HTTP en Node.js con servicios de negocio y persistencia

## Flujo de autenticacion

1. El usuario inicia sesion en `POST /api/auth/login`.
2. El servidor valida credenciales contra la base local.
3. Se entrega un token firmado.
4. El frontend guarda el token en `localStorage`.
5. Las rutas protegidas usan `Authorization: Bearer <token>`.

## Reglas de acceso

El control de acceso esta centralizado en `backend/src/services/rbac.js`.

La fuente principal de roles es el modulo Miembros:

- `Administrador`
- `Pastor`
- `Lider`
- `Mentor`
- `Miembro`

Los usuarios se sincronizan automaticamente desde miembros con correo. Cuando el rol de un miembro cambia, el usuario vinculado cambia sus permisos reales. Ver [rbac.md](rbac.md).

## Persistencia

La informacion se guarda en:

- `backend/src/data/database.json`

Si el archivo no existe, el sistema lo crea automaticamente con datos semilla.

## Generacion de alertas

Cada vez que se registra una nueva asistencia:

1. se ordenan las sesiones por fecha
2. se revisa el historial por joven
3. si un joven acumula 2 ausencias consecutivas, se crea una alerta pendiente

## Nota tecnica

En este entorno se priorizo una ejecucion inmediata sin pasos de build. Por eso el frontend usa React y Tailwind desde CDN, mientras el backend sirve tanto la SPA como la API.
