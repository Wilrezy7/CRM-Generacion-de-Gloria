# Arquitectura del CRM

## Vision general

El sistema se divide en dos capas desplegables:

- `frontend/`: SPA en React consumiendo la API REST
- `backend/`: servidor HTTP en Node.js con servicios de negocio, RBAC y persistencia Supabase

La evolucion objetivo separa responsabilidades en:

- `controllers/`: adaptadores HTTP por modulo
- `services/`: reglas de negocio, RBAC, mentorias y auditoria
- `repositories/`: acceso a Supabase y normalizacion de datos
- `middleware/`: autenticacion JWT y autorizacion
- `routes/`: tabla de rutas REST
- `utils/`: seguridad, JWT, fechas y respuestas HTTP
- `validators/`: validaciones de entrada

## Flujo de autenticacion

1. El usuario inicia sesion en `POST /api/auth/login`.
2. El servidor valida credenciales contra `users`.
3. Se actualiza `last_login` y se registra auditoria.
4. Se entrega un JWT firmado con expiracion.
5. El frontend guarda el token en `localStorage`.
6. Las rutas protegidas usan `Authorization: Bearer <token>`.

## Reglas de acceso

El control de acceso esta centralizado en `backend/src/services/rbac.js`.

Roles de usuario del CRM:

- `ADMIN`
- `PASTOR`
- `LIDER`
- `MENTOR`
- `SECRETARIA`

Roles ministeriales en miembros:

- `Pastor`
- `Lider`
- `Mentor`
- `Miembro`

Cuando un miembro cambia a `Administrador`, `Pastor`, `Lider`, `Mentor` o `Secretaria`, el backend crea o activa su usuario con `mustChangePassword = true`. Si cambia a `Miembro`, `Visitante`, `Nuevo`, `Congregante` o queda inactivo, pierde acceso al CRM y se oculta del modulo Usuarios. Ver [rbac.md](rbac.md).

`SECRETARIA` se crea desde administracion de usuarios y tiene permisos operativos para captura e informes, sin acceso a auditoria ni gestion de permisos.

## Persistencia

La persistencia profesional vive en Supabase con tablas normalizadas:

- `users`
- `members`
- `mentor_assignments`
- `visits`
- `calls`
- `meetings`
- `pastoral_notes`
- `attendance_sessions`
- `attendance_records`
- `alerts`
- `activity_logs`
- `reports`
- `report_downloads`

El SQL completo esta en `docs/migrations/001_multiuser_rbac.sql`. `crm_state` queda como respaldo de migracion para no romper despliegues existentes antes de ejecutar la migracion.

## Mentorias

La relacion mentor -> miembro se expresa como `mentor_assignments` y se refleja en `members.assignedUserId` para compatibilidad API. Mentores, lideres y pastores asignados solo ven los miembros de su alcance; administradores, pastores y lideres tienen vision global segun RBAC.

Los seguimientos especializados se registran en:

- `visits`: fecha, ubicacion, observaciones y resultado
- `calls`: fecha, duracion y observaciones
- `meetings`: fecha, tipo y notas
- `pastoral_notes`: notas privadas o compartidas

## Generacion de alertas

Cada vez que se registra una nueva asistencia:

1. se ordenan las sesiones por fecha
2. se revisa el historial por joven
3. si un joven acumula 2 ausencias consecutivas, se crea una alerta pendiente

## Nota tecnica

En este entorno se priorizo una ejecucion inmediata sin pasos de build. Por eso el frontend usa React y Tailwind desde CDN, mientras el backend sirve tanto la SPA como la API.
