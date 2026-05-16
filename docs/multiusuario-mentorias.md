# CRM multiusuario y mentorias

## Alcance implementado

Esta fase convierte el CRM en una base multiusuario con RBAC real, auditoria y mentorias separadas.

Roles de acceso al sistema:

- `ADMIN`
- `PASTOR`
- `LIDER`
- `MENTOR`
- `SECRETARIA`

`Miembro`, `Visitante`, `Nuevo` y `Congregante` quedan como roles ministeriales sin acceso al CRM por defecto.

`SECRETARIA` es un rol administrativo operativo: puede capturar miembros, asistencia, seguimientos e informes, pero no ve auditoria de seguridad ni administra roles criticos.

## Flujo de usuarios

1. El administrador crea o importa miembros.
2. Si un miembro cambia a `Mentor`, `Lider`, `Pastor`, `Secretaria` o `Administrador`, el backend sincroniza una cuenta en `users`.
3. La cuenta queda activa, con `mustChangePassword = true`.
4. Si el miembro cambia a `Miembro`, `Visitante`, `Nuevo`, `Congregante` o queda inactivo, su cuenta vinculada se desactiva y no aparece en el modulo Usuarios.
5. El administrador puede crear usuarios manuales, resetear contrasenas y cambiar roles.

## Asignacion de mentorias

La asignacion se controla con:

- `mentor_assignments` en Supabase
- `assignedUserId` en la API actual para compatibilidad con el frontend existente

Pueden recibir miembros asignados:

- `PASTOR`
- `LIDER`
- `MENTOR`

Un mentor solo puede consultar miembros y seguimientos dentro de su asignacion.

## Endpoints nuevos

- `POST /api/auth/change-password`
- `PATCH /api/youths/:id/assign`
- `GET /api/visits`
- `POST /api/visits`
- `GET /api/calls`
- `POST /api/calls`
- `GET /api/meetings`
- `POST /api/meetings`
- `GET /api/pastoral-notes`
- `POST /api/pastoral-notes`
- `POST /api/users/:id/reset-password`
- `GET /api/activity-logs`
- `GET /api/reports`
- `POST /api/reports`
- `GET /api/reports/export/excel`
- `GET /api/reports/export/pdf`

## Auditoria

Se registra actividad para:

- login
- bootstrap inicial
- creacion, edicion y eliminacion de miembros
- cambios de asignacion
- creacion, edicion y eliminacion de usuarios
- reset de contrasena
- visitas, llamadas, reuniones, notas pastorales y seguimientos

## Supabase

Ejecutar:

- `docs/migrations/001_multiuser_rbac.sql`

Tablas principales:

- `users`
- `members`
- `mentor_assignments`
- `visits`
- `calls`
- `meetings`
- `pastoral_notes`
- `activity_logs`
- `reports`
- `report_downloads`

`docs/supabase-schema.sql` conserva `crm_state` como respaldo de migracion para despliegues antiguos.
